use crate::types::{CommandEnvelope, CommandFailure, CommandRun, FailureKind, ManagerSnapshot};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug)]
pub(crate) enum ProcessStartError {
    Capture(std::io::Error),
    CaptureClone(std::io::Error),
    Spawn(std::io::Error),
}

#[derive(Debug)]
pub(crate) enum ProcessOutcome {
    Exited(ExitStatus),
    TimedOut,
    WaitFailed(std::io::Error),
}

#[derive(Clone, Copy)]
pub(crate) enum ProcessCleanup {
    OnWaitFailure,
    Always,
}

struct Process {
    child: Child,
    cleanup_on_drop: bool,
}

impl Process {
    fn stop(&mut self) {
        stop_child(&mut self.child);
        self.cleanup_on_drop = false;
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            self.stop();
        }
    }
}

// Collect output before normal-exit cleanup; failed waits stop writers before collection.
// A supplied start time includes capture and spawn in the caller's timeout.
pub(crate) fn run_process<T>(
    command: &mut Command,
    timeout: Duration,
    started: Option<Instant>,
    cleanup: ProcessCleanup,
    collect: impl FnOnce(ProcessOutcome, &mut File, &mut File) -> T,
) -> Result<T, ProcessStartError> {
    let mut stdout = tempfile::tempfile().map_err(ProcessStartError::Capture)?;
    let mut stderr = tempfile::tempfile().map_err(ProcessStartError::Capture)?;
    let stdout_sink = stdout
        .try_clone()
        .map_err(ProcessStartError::CaptureClone)?;
    let stderr_sink = stderr
        .try_clone()
        .map_err(ProcessStartError::CaptureClone)?;
    command
        .stdin(Stdio::null())
        .stdout(stdout_sink)
        .stderr(stderr_sink);
    #[cfg(unix)]
    command.process_group(0);

    let child = command.spawn().map_err(ProcessStartError::Spawn)?;
    let started = started.unwrap_or_else(Instant::now);
    let mut process = Process {
        child,
        cleanup_on_drop: true,
    };
    let outcome = loop {
        match process.child.try_wait() {
            Ok(Some(status)) => {
                process.cleanup_on_drop = matches!(cleanup, ProcessCleanup::Always);
                break ProcessOutcome::Exited(status);
            }
            Ok(None) if started.elapsed() >= timeout => {
                process.stop();
                break ProcessOutcome::TimedOut;
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                process.stop();
                break ProcessOutcome::WaitFailed(error);
            }
        }
    };
    Ok(collect(outcome, &mut stdout, &mut stderr))
}

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
    let failure = |kind, message, stdout, stderr| CommandFailure {
        kind,
        message,
        command: Some(envelope.clone()),
        stdout,
        stderr,
    };
    let mut command = Command::new(program);
    command.args(args);
    if program == "brew" {
        command
            .env("HOMEBREW_NO_AUTO_UPDATE", "1")
            .env("HOMEBREW_NO_ENV_HINTS", "1");
    }

    run_process(
        &mut command,
        timeout,
        Some(started),
        ProcessCleanup::OnWaitFailure,
        |outcome, stdout, stderr| match outcome {
            ProcessOutcome::Exited(status) => {
                let (stdout, stderr) = read_output(stdout)
                    .and_then(|stdout| read_output(stderr).map(|stderr| (stdout, stderr)))
                    .map_err(|error| {
                        failure(
                            FailureKind::CommandFailed,
                            format!("Could not read output from {}", envelope.preview),
                            String::new(),
                            error.to_string(),
                        )
                    })?;
                Ok(CommandRun {
                    envelope: envelope.clone(),
                    stdout,
                    stderr,
                    exit_code: status.code(),
                    duration_ms: started.elapsed().as_millis(),
                })
            }
            ProcessOutcome::TimedOut => Err(failure(
                FailureKind::Timeout,
                format!("{} exceeded the configured timeout", envelope.preview),
                read_output(stdout).unwrap_or_default(),
                read_output(stderr).unwrap_or_default(),
            )),
            ProcessOutcome::WaitFailed(error) => Err(failure(
                FailureKind::CommandFailed,
                format!("Could not wait for {}", envelope.preview),
                String::new(),
                error.to_string(),
            )),
        },
    )
    .map_err(|error| {
        let (kind, message, error) = match error {
            ProcessStartError::Capture(error) | ProcessStartError::CaptureClone(error) => (
                FailureKind::CommandFailed,
                format!("Could not capture output from {}", envelope.preview),
                error,
            ),
            ProcessStartError::Spawn(error) => {
                let (kind, message) = match error.kind() {
                    std::io::ErrorKind::NotFound => (
                        FailureKind::MissingBinary,
                        format!("{program} is not installed or is not on PATH"),
                    ),
                    std::io::ErrorKind::PermissionDenied => (
                        FailureKind::PermissionDenied,
                        format!("Permission denied while running {}", envelope.preview),
                    ),
                    _ => (
                        FailureKind::CommandFailed,
                        format!("Could not run {}", envelope.preview),
                    ),
                };
                (kind, message, error)
            }
        };
        failure(kind, message, String::new(), error.to_string())
    })?
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
    fn normal_exits_leave_descendants_running() {
        let directory = tempfile::tempdir().unwrap();
        for exit_code in ["0", "7"] {
            let marker = directory.path().join(exit_code);
            let run = run_command(
                "/bin/sh",
                &[
                    "-c",
                    "printf started; (sleep 1; touch \"$1\") & exit \"$2\"",
                    "probe",
                    marker.to_str().unwrap(),
                    exit_code,
                ],
                Duration::from_secs(2),
            )
            .unwrap();
            assert_eq!(run.exit_code, exit_code.parse().ok());
            assert_eq!(run.stdout, "started");
        }
        thread::sleep(Duration::from_millis(1200));
        assert!(directory.path().join("0").exists());
        assert!(directory.path().join("7").exists());
    }

    #[test]
    fn signal_exit_and_spawn_failures_keep_their_classification() {
        use std::os::unix::fs::PermissionsExt;

        let run = run_command(
            "/bin/sh",
            &["-c", "printf '\\377'; printf '\\377' >&2; kill -TERM $$"],
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(run.exit_code, None);
        assert_eq!(run.stdout, "\u{fffd}");
        assert_eq!(run.stderr, "\u{fffd}");

        let directory = tempfile::tempdir().unwrap();
        let binary = directory.path().join("cli");
        let missing =
            run_command(binary.to_str().unwrap(), &[], Duration::from_secs(2)).unwrap_err();
        assert!(matches!(missing.kind, FailureKind::MissingBinary));
        std::fs::write(&binary, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o644)).unwrap();
        let denied =
            run_command(binary.to_str().unwrap(), &[], Duration::from_secs(2)).unwrap_err();
        assert!(matches!(denied.kind, FailureKind::PermissionDenied));
    }

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
