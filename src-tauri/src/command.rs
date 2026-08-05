use crate::types::{CommandEnvelope, CommandFailure, CommandRun, FailureKind, ManagerSnapshot};
use std::process::{Command, Stdio};
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
    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if program == "brew" {
        command
            .env("HOMEBREW_NO_AUTO_UPDATE", "1")
            .env("HOMEBREW_NO_ENV_HINTS", "1");
    }

    let child = command.spawn();

    match child {
        Ok(mut child) => loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    let output = match child.wait_with_output() {
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
                        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                        exit_code: output.status.code(),
                        duration_ms: started.elapsed().as_millis(),
                    });
                }
                Ok(None) if started.elapsed() >= timeout => {
                    let _ = child.kill();
                    let output = child.wait_with_output().ok();
                    let stdout = output
                        .as_ref()
                        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
                        .unwrap_or_default();
                    let stderr = output
                        .as_ref()
                        .map(|output| String::from_utf8_lossy(&output.stderr).to_string())
                        .unwrap_or_default();

                    return Err(CommandFailure {
                        kind: FailureKind::Timeout,
                        message: format!("{} exceeded the configured timeout", envelope.preview),
                        command: Some(envelope),
                        stdout,
                        stderr,
                    });
                }
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(err) => {
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
