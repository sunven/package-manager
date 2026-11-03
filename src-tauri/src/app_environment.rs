use std::ffi::{OsStr, OsString};
use std::io::{self, Read, Seek, SeekFrom};
use std::os::unix::ffi::OsStringExt;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const PATH_MARKER: &[u8] = b"\0CLEAN_UP_PATH\0";

// Run before Tauri starts any threads so every command and PATH inspection sees
// the same environment, including scripts that resolve Node through /usr/bin/env.
pub(crate) fn initialize() {
    let shell = std::env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/zsh"));
    match shell_path(&shell, Duration::from_secs(5)) {
        Ok(path) => std::env::set_var("PATH", path),
        Err(error) => eprintln!("Could not load the user shell PATH: {error}"),
    }
}

fn shell_path(shell: &OsStr, timeout: Duration) -> io::Result<OsString> {
    // A file keeps verbose startup scripts from filling a pipe and blocking the
    // timeout. Only the marked PATH is imported; startup output is never logged.
    let mut output = tempfile::tempfile()?;
    let mut command = Command::new(shell);
    command
        .args(["-ilc", r#"command printf '\0CLEAN_UP_PATH\0%s\0' "$PATH""#])
        .stdin(Stdio::null())
        .stdout(output.try_clone()?)
        .stderr(Stdio::null());
    if let Some(home) = std::env::var_os("HOME") {
        command.current_dir(home);
    }
    let mut child = command.spawn()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return Err(io::Error::other("shell PATH probe failed")),
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(25)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result {
                    Err(error) => error,
                    _ => io::Error::new(io::ErrorKind::TimedOut, "shell PATH probe timed out"),
                });
            }
        }
    }

    output.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    output.read_to_end(&mut bytes)?;
    let path = bytes
        .windows(PATH_MARKER.len())
        .rposition(|window| window == PATH_MARKER)
        .map(|start| &bytes[start + PATH_MARKER.len()..])
        .and_then(|rest| {
            rest.iter()
                .position(|byte| *byte == 0)
                .map(|end| &rest[..end])
        })
        .filter(|path| !path.is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "shell did not return a PATH"))?;
    Ok(OsString::from_vec(path.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::run_command;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    const CHILD_PROBE: &str = "CLEAN_UP_ENVIRONMENT_TEST";

    fn probe(home: &Path, shell: &Path, scenario: &str) {
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "app_environment::tests::gui_launch_child_probe",
                "--nocapture",
            ])
            .env(CHILD_PROBE, scenario)
            .env("HOME", home)
            .env("ZDOTDIR", home)
            .env("SHELL", shell)
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "GUI launch probe failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }

    fn write_shell(home: &Path, script: &str) -> std::path::PathBuf {
        let shell = home.join("test-shell");
        fs::write(&shell, format!("#!/bin/sh\n{script}\n")).unwrap();
        fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();
        shell
    }

    #[test]
    fn gui_launch_finds_npm_and_its_node_interpreter_from_zshrc() {
        let home = tempfile::tempdir().unwrap();
        let tools = home.path().join("node tools");
        fs::create_dir(&tools).unwrap();
        for (name, contents) in [
            ("npm", "#!/usr/bin/env node\n"),
            ("node", "#!/bin/sh\nprintf '11.0.0\\n'\n"),
        ] {
            let path = tools.join(name);
            fs::write(&path, contents).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        fs::write(
            home.path().join(".zshrc"),
            "printf 'shell startup output\\n'\nexport PATH=\"$HOME/node tools:$PATH\"\n",
        )
        .unwrap();

        probe(home.path(), Path::new("/bin/zsh"), "npm");
    }

    #[test]
    fn failed_missing_or_empty_shell_output_preserves_inherited_path() {
        let home = tempfile::tempdir().unwrap();
        probe(home.path(), &home.path().join("missing-shell"), "fallback");
        for script in [
            "printf '\\0CLEAN_UP_PATH\\0/stale/path\\0'; exit 1",
            "printf '\\0CLEAN_UP_PATH\\0\\0'",
            "printf 'unrelated shell output\\n'",
        ] {
            let shell = write_shell(home.path(), script);
            probe(home.path(), &shell, "fallback");
        }
    }

    #[test]
    fn hanging_shell_startup_is_bounded() {
        let home = tempfile::tempdir().unwrap();
        let shell = write_shell(home.path(), "while :; do :; done");
        let started = Instant::now();
        let error = shell_path(shell.as_os_str(), Duration::from_millis(50)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn gui_launch_child_probe() {
        let Some(scenario) = std::env::var_os(CHILD_PROBE) else {
            return;
        };
        let missing = run_command("npm", &["--version"], Duration::from_secs(1)).unwrap_err();
        assert_eq!(missing.message, "npm is not installed or is not on PATH");

        initialize();

        if scenario == "fallback" {
            assert_eq!(
                std::env::var("PATH").unwrap(),
                "/usr/bin:/bin:/usr/sbin:/sbin"
            );
            return;
        }

        let run = run_command("npm", &["--version"], Duration::from_secs(1))
            .expect("npm installed through the user's shell must be discoverable");
        assert_eq!(run.exit_code, Some(0), "{}", run.stderr);
        assert_eq!(run.stdout.trim(), "11.0.0");
        let first_path = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .next()
            .unwrap();
        assert_eq!(
            first_path,
            std::path::PathBuf::from(std::env::var_os("HOME").unwrap()).join("node tools")
        );
    }
}
