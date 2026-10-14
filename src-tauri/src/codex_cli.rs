use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

// Codex settings and marketplace commands share one home and must not race each other.
pub(crate) static OPERATIONS: Mutex<()> = Mutex::new(());

pub(crate) struct Output {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

struct Process {
    child: Child,
    stdout: File,
    stderr: File,
}

impl Drop for Process {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            // Stop Git/SSH descendants too, including when authentication or network I/O hangs.
            libc::kill(-(self.child.id() as i32), libc::SIGKILL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start(home: &Path, args: &[&str], input: bool) -> Result<Process, String> {
    let stdout = tempfile::tempfile().map_err(|e| e.to_string())?;
    let stderr = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut command = Command::new("codex");
    command
        .args(args)
        .current_dir("/")
        .env("CODEX_HOME", home)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .stdin(if input { Stdio::piped() } else { Stdio::null() })
        .stdout(stdout.try_clone().map_err(|e| e.to_string())?)
        .stderr(stderr.try_clone().map_err(|e| e.to_string())?);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "未找到 Codex CLI，请确认应用的 PATH 中有 codex。".to_string()
        } else {
            format!("无法运行 Codex CLI：{e}")
        }
    })?;
    Ok(Process {
        child,
        stdout,
        stderr,
    })
}

fn read_output(file: &mut File) -> Result<String, String> {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub(crate) fn run(home: &Path, args: &[&str], timeout: Duration) -> Result<Output, String> {
    let mut process = start(home, args, false)?;
    let started = Instant::now();
    loop {
        match process.child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                return Ok(Output {
                    success: status.success(),
                    stdout: read_output(&mut process.stdout)?,
                    stderr: read_output(&mut process.stderr)?,
                })
            }
            None if started.elapsed() >= timeout => {
                return Err(
                    "Codex 操作超时。请检查网络和本机 Git 认证，再重新读取清单核对结果。".into(),
                )
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
}

#[derive(Debug, PartialEq)]
pub(crate) enum RpcErrorKind {
    MissingCli,
    Incompatible,
    Conflict,
    Failed,
}

#[derive(Debug)]
pub(crate) struct RpcError {
    pub kind: RpcErrorKind,
    pub message: String,
}

impl RpcError {
    fn transport(message: String) -> Self {
        Self {
            kind: if message.starts_with("未找到 Codex CLI") {
                RpcErrorKind::MissingCli
            } else {
                RpcErrorKind::Failed
            },
            message,
        }
    }

    pub(crate) fn incompatible() -> Self {
        Self {
            kind: RpcErrorKind::Incompatible,
            message: "Codex CLI 未提供兼容的响应，请更新 CLI 后重新读取。".into(),
        }
    }
}

// Only backend-owned methods use this connection. No thread/turn is started.
pub(crate) struct AppServer {
    process: Process,
    sequence: u64,
}

impl AppServer {
    pub(crate) fn start(home: &Path) -> Result<Self, RpcError> {
        let mut server = Self {
            process: start(home, &["app-server"], true).map_err(RpcError::transport)?,
            sequence: 0,
        };
        server.request(
            "initialize",
            json!({
                "clientInfo": {"name": "package_manager", "version": "0.1.0"}
            }),
        )?;
        server.send(json!({"method":"initialized"}))?;
        Ok(server)
    }

    fn send(&mut self, message: Value) -> Result<(), RpcError> {
        let input = self
            .process
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| RpcError::transport("无法连接 Codex CLI。".into()))?;
        writeln!(input, "{message}")
            .and_then(|_| input.flush())
            .map_err(|e| RpcError::transport(e.to_string()))
    }

    pub(crate) fn request(&mut self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.sequence += 1;
        let id = self.sequence;
        self.send(json!({"id":id,"method":method,"params":params}))?;
        let started = Instant::now();
        loop {
            let output = read_output(&mut self.process.stdout).map_err(RpcError::transport)?;
            for line in output.lines() {
                let Ok(message) = serde_json::from_str::<Value>(line) else {
                    continue;
                };
                if message["id"].as_u64() != Some(id) {
                    continue;
                }
                if let Some(result) = message.get("result") {
                    return Ok(result.clone());
                }
                let error = &message["error"];
                if error["data"]["config_write_error_code"] == "configVersionConflict" {
                    return Err(RpcError {
                        kind: RpcErrorKind::Conflict,
                        message: "用户配置已被外部修改，请重新读取并确认。".into(),
                    });
                }
                if error["code"] == -32601 {
                    return Err(RpcError::incompatible());
                }
                return Err(RpcError::transport(format!(
                    "Codex 未能完成 {method}，请检查用户配置、访问权限和 CLI 兼容性后重新读取。"
                )));
            }
            if self
                .process
                .child
                .try_wait()
                .map_err(|e| RpcError::transport(e.to_string()))?
                .is_some()
                || started.elapsed() > Duration::from_secs(15)
            {
                return Err(RpcError::transport(format!(
                    "无法确认 Codex {method} 的结果。请检查 CLI 和用户配置后重新读取。"
                )));
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}

// Never send configuration contents back to the UI.
pub(crate) fn config(home: &Path) -> Result<Value, String> {
    AppServer::start(home)
        .and_then(|mut server| {
            server.request("config/read", json!({"includeLayers":true,"cwd":"/"}))
        })
        .map_err(|error| error.message)
}

pub(crate) fn diagnostic(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("unrecognized subcommand") || lower.contains("unexpected argument") {
        return "当前 Codex CLI 不支持所需市场命令，请更新 CLI 后重新读取。".into();
    }
    if lower.contains("already added from a different source") {
        return "已有同名市场使用不同来源。请先明确移除旧来源，再添加新来源。".into();
    }
    if lower.contains("permission denied")
        || lower.contains("authentication")
        || lower.contains("terminal prompts disabled")
        || lower.contains("could not read username")
    {
        return "Git 认证或访问权限不足。请在本机配置 SSH 或 Git 凭据后重试；应用不保存凭据。"
            .into();
    }
    // Keep CLI diagnostics useful without exposing credentials embedded in repository URLs.
    let mut message = stderr
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(1600)
        .collect::<String>();
    let mut offset = 0;
    while let Some(start) = message[offset..].find("://").map(|i| offset + i + 3) {
        let end = message[start..]
            .find(|c: char| c == '/' || c.is_whitespace())
            .map(|i| start + i)
            .unwrap_or(message.len());
        if let Some(at) = message[start..end].rfind('@').map(|i| start + i) {
            message.replace_range(start..at, "[已隐藏]");
        }
        offset = start;
    }
    if message.trim().is_empty() {
        "Codex 命令未完成，请核对来源和用户配置后重新读取清单。".into()
    } else {
        message.trim().into()
    }
}
