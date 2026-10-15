use serde_json::Value;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(crate) static OPERATIONS: Mutex<()> = Mutex::new(());

pub(crate) struct Output {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

pub(crate) type Runner = dyn Fn(&Path, &[&str], Duration) -> Result<Output, String>;

pub(crate) fn resolve_home() -> Result<PathBuf, String> {
    let path = match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        Some(value) => PathBuf::from(value),
        None => {
            PathBuf::from(std::env::var_os("HOME").ok_or("无法确定用户主目录。")?).join(".claude")
        }
    };
    if !path.is_absolute() {
        return Err("CLAUDE_CONFIG_DIR 必须是绝对路径。".into());
    }
    match path.canonicalize() {
        Ok(path) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(path),
        Err(e) => Err(format!("无法访问 Claude Code 目录：{e}")),
    }
}

struct Process(Child);

impl Drop for Process {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.0.id() as i32), libc::SIGKILL);
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn read_output(file: &mut File) -> Result<String, String> {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut text = String::new();
    file.take(8 * 1024 * 1024)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    Ok(text)
}

pub(crate) fn run(home: &Path, args: &[&str], timeout: Duration) -> Result<Output, String> {
    let mut stdout = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut stderr = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut command = Command::new("claude");
    command
        .args(args)
        .current_dir("/")
        .env("CLAUDE_CONFIG_DIR", home)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .stdin(Stdio::null())
        .stdout(stdout.try_clone().map_err(|e| e.to_string())?)
        .stderr(stderr.try_clone().map_err(|e| e.to_string())?);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut process = Process(command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "未找到 Claude CLI，请确认应用 PATH 中有 claude。".into()
        } else {
            format!("无法运行 Claude CLI：{e}")
        }
    })?);
    let started = Instant::now();
    loop {
        if let Some(status) = process.0.try_wait().map_err(|e| e.to_string())? {
            return Ok(Output {
                success: status.success(),
                stdout: read_output(&mut stdout)?,
                stderr: read_output(&mut stderr)?,
            });
        }
        if started.elapsed() >= timeout {
            return Err("Claude 操作超时，结果尚未确认。请重新读取清单核对；需要认证时先在 Claude CLI 完成。".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

pub(crate) fn json_output(output: &Output) -> Result<Value, String> {
    // Lists are pretty-printed JSON; mutations put one JSON object on the final line.
    serde_json::from_str(output.stdout.trim())
        .or_else(|_| {
            serde_json::from_str(
                output
                    .stdout
                    .lines()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                    .unwrap_or(""),
            )
        })
        .map_err(|_| {
            "Claude CLI 未返回兼容的 JSON，不能确认结果。请重新读取并检查 CLI 版本。".into()
        })
}

pub(crate) fn version(home: &Path, runner: &Runner) -> Result<String, String> {
    let output = runner(home, &["--version"], Duration::from_secs(10))?;
    let version = output.stdout.split_whitespace().next().unwrap_or("");
    if !output.success
        || !version.split('.').all(|part| part.parse::<u32>().is_ok())
        || version.split('.').count() != 3
    {
        return Err("无法识别 Claude CLI 版本，当前仅供查看。".into());
    }
    Ok(version.into())
}

pub(crate) fn write_blocked(version: &str) -> Option<String> {
    // Lifecycle/market JSON and Hook field combinations were verified together at this version.
    (version != "2.1.300").then(|| {
        format!("当前 Claude CLI {version} 的写入行为尚未验证；本版已验证 2.1.300，当前仅供查看。")
    })
}

pub(crate) fn diagnostic(output: &Output) -> String {
    if let Ok(value) = json_output(output) {
        if value["outcome"] == "needs-approval" || value.get("shownCommand").is_some() {
            return "此插件需要确认安装命令。请先在 Claude CLI 中审查并完成安装，然后重新读取。"
                .into();
        }
        if let Some(message) = value["message"].as_str() {
            return message.chars().take(3000).collect();
        }
    }
    let text = output.stderr.to_lowercase();
    if text.contains("unknown option") || text.contains("unknown command") {
        "Claude CLI 不支持所需命令，请检查版本后重新读取。".into()
    } else {
        "Claude CLI 未完成操作。请检查来源、依赖、权限与认证，然后重新读取核对结果。".into()
    }
}
