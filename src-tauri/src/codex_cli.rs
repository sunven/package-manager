use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

// Plugin settings and marketplace commands share one home and must not race each other.
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

// config/read exposes the authoritative field origins; marketplace list does not.
// Never send configuration contents back to the UI.
pub(crate) fn config(home: &Path) -> Result<Value, String> {
    let mut process = start(home, &["app-server"], true)?;
    let messages = [
        json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"package_manager","version":"0.1.0"}}}),
        json!({"method":"initialized"}),
        json!({"id":2,"method":"config/read","params":{"includeLayers":true,"cwd":"/"}}),
    ];
    let input = process
        .child
        .stdin
        .as_mut()
        .ok_or("无法读取 Codex 配置来源")?;
    for message in messages {
        writeln!(input, "{message}").map_err(|e| e.to_string())?;
    }
    input.flush().map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        let output = read_output(&mut process.stdout)?;
        for line in output.lines() {
            let Ok(message) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if message["id"] == 2 {
                return message.get("result").cloned().ok_or_else(|| {
                    "无法读取 Codex 配置来源；请检查用户配置和 CLI 兼容性。".into()
                });
            }
            if message["id"] == 1 && message.get("error").is_some() {
                return Err("当前 CLI 无法提供配置来源信息，市场暂时只读。".into());
            }
        }
        if process
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
            || started.elapsed() > Duration::from_secs(15)
        {
            return Err("无法核实 Codex 配置来源，市场暂时只读。请检查 CLI 后重新读取。".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
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
