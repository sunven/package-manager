use crate::types::{CommandEnvelope, CommandFailure, CommandRun, FailureKind, ManagerSnapshot};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub(crate) fn run_recorded_stdout<F>(
    snapshot: &mut ManagerSnapshot,
    runner: &F,
    program: &str,
    args: &[&str],
    timeout_secs: u64,
    failure_message: &str,
) -> Option<String>
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    run_recorded_command(
        snapshot,
        runner,
        program,
        args,
        timeout_secs,
        failure_message,
    )
    .map(|run| run.stdout.trim().to_string())
}

pub(crate) fn run_recorded_command<F>(
    snapshot: &mut ManagerSnapshot,
    runner: &F,
    program: &str,
    args: &[&str],
    timeout_secs: u64,
    failure_message: &str,
) -> Option<CommandRun>
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    push_command(snapshot, program, args, timeout_secs);
    match runner(program, args, Duration::from_secs(timeout_secs)) {
        Ok(run) if run.exit_code == Some(0) => Some(run),
        Ok(run) => {
            snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                failure_message,
                run,
            ));
            None
        }
        Err(failure) => {
            snapshot.failures.push(failure);
            None
        }
    }
}

pub(crate) fn run_command(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<CommandRun, CommandFailure> {
    let envelope = envelope(program, args, timeout.as_millis() as u64);
    let started = Instant::now();
    let capture = (|| -> std::io::Result<_> {
        let stdout = tempfile::tempfile()?;
        let stderr = tempfile::tempfile()?;
        let outputs = (stdout.try_clone()?, stderr.try_clone()?);
        Ok((stdout, stderr, outputs))
    })();
    let (mut stdout, mut stderr, (stdout_sink, stderr_sink)) =
        capture.map_err(|err| CommandFailure {
            kind: FailureKind::CommandFailed,
            message: format!("Could not capture output from {}", envelope.preview),
            command: Some(envelope.clone()),
            stdout: String::new(),
            stderr: err.to_string(),
        })?;
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(stdout_sink)
        .stderr(stderr_sink);
    #[cfg(unix)]
    command.process_group(0);

    if program == "brew" {
        command
            .env("HOMEBREW_NO_AUTO_UPDATE", "1")
            .env("HOMEBREW_NO_ENV_HINTS", "1");
    }

    let child = command.spawn();

    match child {
        Ok(mut child) => loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let output = match read_output(&mut stdout)
                        .and_then(|stdout| read_output(&mut stderr).map(|stderr| (stdout, stderr)))
                    {
                        Ok(output) => output,
                        Err(err) => {
                            return Err(CommandFailure {
                                kind: FailureKind::CommandFailed,
                                message: format!("Could not read output from {}", envelope.preview),
                                command: Some(envelope),
                                stdout: String::new(),
                                stderr: err.to_string(),
                            })
                        }
                    };

                    return Ok(CommandRun {
                        envelope,
                        stdout: output.0,
                        stderr: output.1,
                        exit_code: status.code(),
                        duration_ms: started.elapsed().as_millis(),
                    });
                }
                Ok(None) if started.elapsed() >= timeout => {
                    stop_child(&mut child);

                    return Err(CommandFailure {
                        kind: FailureKind::Timeout,
                        message: format!("{} exceeded the configured timeout", envelope.preview),
                        command: Some(envelope),
                        stdout: read_output(&mut stdout).unwrap_or_default(),
                        stderr: read_output(&mut stderr).unwrap_or_default(),
                    });
                }
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(err) => {
                    stop_child(&mut child);
                    return Err(CommandFailure {
                        kind: FailureKind::CommandFailed,
                        message: format!("Could not wait for {}", envelope.preview),
                        command: Some(envelope),
                        stdout: String::new(),
                        stderr: err.to_string(),
                    })
                }
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Err(CommandFailure {
            kind: FailureKind::MissingBinary,
            message: format!("{program} is not installed or is not on PATH"),
            command: Some(envelope),
            stdout: String::new(),
            stderr: err.to_string(),
        }),
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => Err(CommandFailure {
            kind: FailureKind::PermissionDenied,
            message: format!("Permission denied while running {}", envelope.preview),
            command: Some(envelope),
            stdout: String::new(),
            stderr: err.to_string(),
        }),
        Err(err) => Err(CommandFailure {
            kind: FailureKind::CommandFailed,
            message: format!("Could not run {}", envelope.preview),
            command: Some(envelope),
            stdout: String::new(),
            stderr: err.to_string(),
        }),
    }
}

fn read_output(file: &mut File) -> std::io::Result<String> {
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn stop_child(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn run_command_owned(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<CommandRun, CommandFailure> {
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_command(program, &refs, timeout)
}

pub(crate) fn command_failure(kind: FailureKind, message: &str, run: CommandRun) -> CommandFailure {
    CommandFailure {
        kind,
        message: message.to_string(),
        command: Some(run.envelope),
        stdout: run.stdout,
        stderr: run.stderr,
    }
}

pub(crate) fn parse_failure(message: String, run: CommandRun) -> CommandFailure {
    CommandFailure {
        kind: FailureKind::ParseFailure,
        message,
        command: Some(run.envelope),
        stdout: run.stdout,
        stderr: run.stderr,
    }
}

pub(crate) fn push_command(
    snapshot: &mut ManagerSnapshot,
    program: &str,
    args: &[&str],
    timeout_secs: u64,
) {
    snapshot
        .commands
        .push(envelope(program, args, timeout_secs * 1000));
}

pub(crate) fn envelope(program: &str, args: &[&str], timeout_ms: u64) -> CommandEnvelope {
    CommandEnvelope {
        program: program.to_string(),
        args: args.iter().map(|arg| arg.to_string()).collect(),
        preview: envelope_preview(program, args),
        timeout_ms,
    }
}

pub(crate) fn envelope_owned(program: &str, args: Vec<String>, timeout_ms: u64) -> CommandEnvelope {
    CommandEnvelope {
        program: program.to_string(),
        preview: envelope_preview_owned(program, &args),
        args,
        timeout_ms,
    }
}

pub(crate) fn envelope_preview(program: &str, args: &[&str]) -> String {
    std::iter::once(program)
        .chain(args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn envelope_preview_owned(program: &str, args: &[String]) -> String {
    std::iter::once(program.to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn drains_large_stdout_and_stderr_without_timing_out() {
        let run = run_command(
            "/bin/sh",
            &[
                "-c",
                "head -c 2097152 /dev/zero; head -c 2097152 /dev/zero >&2",
            ],
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(run.exit_code, Some(0));
        assert_eq!(run.stdout.len(), 2_097_152);
        assert_eq!(run.stderr.len(), 2_097_152);
    }

    #[test]
    fn timeout_stops_descendants_and_preserves_output() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("continued");
        let started = Instant::now();
        let failure = run_command(
            "/bin/sh",
            &[
                "-c",
                "printf started; (sleep 1; touch \"$1\"; sleep 2) & wait",
                "probe",
                marker.to_str().unwrap(),
            ],
            Duration::from_millis(100),
        )
        .unwrap_err();
        assert!(matches!(failure.kind, FailureKind::Timeout));
        assert_eq!(failure.stdout, "started");
        assert!(started.elapsed() < Duration::from_secs(2));
        thread::sleep(Duration::from_millis(1200));
        assert!(
            !marker.exists(),
            "the descendant kept running after timeout"
        );
    }
}
