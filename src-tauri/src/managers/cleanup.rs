use super::pip::resolve_python_for_cleanup;
use crate::command::{command_failure, envelope_owned};
use crate::types::{
    CacheCleanupRun, CleanupOutcome, CleanupStepResult, CleanupStepState, CommandEnvelope,
    CommandFailure, CommandRun, FailureKind, ManagerId,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Cleanup deletes potentially large caches, so it gets a far more generous
/// budget than scans (5–15s) or uninstall (30s). A timeout kills the child
/// mid-deletion, and "the cache was big" must not present as "it timed out".
pub(crate) const CLEANUP_TIMEOUT_SECS: u64 = 300;

/// One step of a cleanup plan.
///
/// Deletion is normally delegated to the manager's own CLI — this crate does not
/// delete files. See `docs/adr/0001-delegated-cache-cleanup.md`.
pub(crate) enum CleanupStep {
    Command {
        program: &'static str,
        args: &'static [&'static str],
    },
    /// pip has no fixed program: every pip invocation is `<python> -m pip …`, and
    /// the interpreter is resolved at run time. The frontend never supplies it.
    PipCommand { args: &'static [&'static str] },
    /// The one exception to delegated cleanup. Requires path-identity assertions.
    GuardedDeletion(GuardedTarget),
}

/// Directories this crate is permitted to delete itself.
///
/// A target belongs here only when the owning manager ships no command that can
/// clean it. Adding one needs the same strength of identity proof as
/// `NpmNpxCache` — see ADR-0001.
pub(crate) enum GuardedTarget {
    /// `npm cache clean --force` clears `_cacache` but leaves `_npx`, and npm
    /// offers no command for it.
    NpmNpxCache,
}

impl GuardedTarget {
    fn label(&self) -> &'static str {
        match self {
            GuardedTarget::NpmNpxCache => "remove the npm _npx cache directory",
        }
    }
}

/// The manager → cleanup plan mapping.
///
/// This table is the entire allowlist. `run_cache_cleanup` accepts only a
/// `ManagerId`, so nothing outside this table is reachable from the frontend.
///
/// `Nvm`, `Maven`, and `Cargo` are absent on purpose: none of them ships a
/// command that cleans its own cache, and cleaning them would mean deleting
/// directories ourselves. See ADR-0001 before adding them.
pub(crate) fn cleanup_plan(manager: ManagerId) -> &'static [CleanupStep] {
    match manager {
        // `npm cache clean --force` does not touch `_npx`, hence the second step.
        ManagerId::Npm => &[
            CleanupStep::Command {
                program: "npm",
                args: &["cache", "clean", "--force"],
            },
            CleanupStep::GuardedDeletion(GuardedTarget::NpmNpxCache),
        ],
        // `prune`, not a full store wipe: prune drops only content no project
        // references any more.
        ManagerId::Pnpm => &[CleanupStep::Command {
            program: "pnpm",
            args: &["store", "prune"],
        }],
        ManagerId::Yarn => &[CleanupStep::Command {
            program: "yarn",
            args: &["cache", "clean"],
        }],
        ManagerId::Bun => &[CleanupStep::Command {
            program: "bun",
            args: &["pm", "cache", "rm"],
        }],
        // `prune`, not `clean`: prune removes only unreachable objects and keeps
        // entries existing environments still reference. Never `--force` — that
        // bypasses uv's own in-use check.
        ManagerId::Uv => &[CleanupStep::Command {
            program: "uv",
            args: &["cache", "prune"],
        }],
        // Plain `brew cleanup`. This also removes old versions of installed
        // formulae, which exceeds the cache-only scope knowingly — see
        // `docs/adr/0002-homebrew-cleanup-exceeds-cache-scope.md`.
        ManagerId::Homebrew => &[CleanupStep::Command {
            program: "brew",
            args: &["cleanup"],
        }],
        // Build cache, then dangling images only. Never `-a` (that removes
        // tagged images), never `system prune`, never `--volumes`.
        ManagerId::Docker => &[
            CleanupStep::Command {
                program: "docker",
                args: &["builder", "prune", "-f"],
            },
            CleanupStep::Command {
                program: "docker",
                args: &["image", "prune", "-f"],
            },
        ],
        ManagerId::Pip => &[CleanupStep::PipCommand {
            args: &["cache", "purge"],
        }],
        ManagerId::Nvm | ManagerId::Maven | ManagerId::Cargo => &[],
    }
}

pub(crate) fn run_cache_cleanup_with_runner<F>(manager: ManagerId, runner: &F) -> CacheCleanupRun
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    run_cache_cleanup_with_runner_and_deleter(manager, runner, &remove_dir_all_if_exists)
}

pub(crate) fn run_cache_cleanup_with_runner_and_deleter<F, D>(
    manager: ManagerId,
    runner: &F,
    deleter: &D,
) -> CacheCleanupRun
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
    D: Fn(&Path) -> Result<(), String>,
{
    let plan = cleanup_plan(manager);
    if plan.is_empty() {
        return CacheCleanupRun {
            manager,
            outcome: CleanupOutcome::NoPlan,
            steps: Vec::new(),
            message: Some("This package manager has no cleanup plan.".to_string()),
        };
    }

    let mut steps = Vec::with_capacity(plan.len());
    let mut stopped = false;

    for step in plan {
        match step {
            CleanupStep::Command { program, args } => {
                let owned_args = args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
                let result = execute_command_step(program, owned_args, runner, stopped);
                stopped = stopped || result.state == CleanupStepState::Failed;
                steps.push(result);
            }
            CleanupStep::PipCommand { args } => {
                let mut owned_args = vec!["-m".to_string(), "pip".to_string()];
                owned_args.extend(args.iter().map(|arg| arg.to_string()));

                if stopped {
                    steps.push(CleanupStepResult::skipped(
                        pip_step_label(&owned_args),
                        None,
                    ));
                    continue;
                }

                match resolve_python_for_cleanup(runner) {
                    Ok(python) => {
                        let result = execute_command_step(&python, owned_args, runner, false);
                        stopped = result.state == CleanupStepState::Failed;
                        steps.push(result);
                    }
                    Err(message) => {
                        steps.push(CleanupStepResult::failed(
                            pip_step_label(&owned_args),
                            None,
                            CommandFailure {
                                kind: FailureKind::MissingBinary,
                                message,
                                command: None,
                                stdout: String::new(),
                                stderr: String::new(),
                            },
                        ));
                        stopped = true;
                    }
                }
            }
            CleanupStep::GuardedDeletion(target) => {
                let label = target.label().to_string();

                if stopped {
                    steps.push(CleanupStepResult::skipped(label, None));
                    continue;
                }

                match run_guarded_deletion(target, runner, deleter) {
                    Ok(()) => steps.push(CleanupStepResult::succeeded(
                        label,
                        None,
                        String::new(),
                        String::new(),
                    )),
                    Err(message) => {
                        steps.push(CleanupStepResult::failed(
                            label,
                            None,
                            CommandFailure {
                                kind: FailureKind::MissingPath,
                                message,
                                command: None,
                                stdout: String::new(),
                                stderr: String::new(),
                            },
                        ));
                        stopped = true;
                    }
                }
            }
        }
    }

    CacheCleanupRun {
        outcome: outcome_for(&steps),
        message: cleanup_message(&steps),
        manager,
        steps,
    }
}

/// Runs one allowlisted command, or records it as skipped when an earlier step
/// already failed.
fn execute_command_step<F>(
    program: &str,
    owned_args: Vec<String>,
    runner: &F,
    stopped: bool,
) -> CleanupStepResult
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let command = envelope_owned(program, owned_args.clone(), CLEANUP_TIMEOUT_SECS * 1000);
    let label = command.preview.clone();

    if stopped {
        return CleanupStepResult::skipped(label, Some(command));
    }

    match runner(
        program,
        &owned_args,
        Duration::from_secs(CLEANUP_TIMEOUT_SECS),
    ) {
        Ok(run) if run.exit_code == Some(0) => {
            CleanupStepResult::succeeded(label, Some(command), run.stdout, run.stderr)
        }
        Ok(run) => {
            let failure =
                command_failure(FailureKind::CommandFailed, &format!("{label} failed"), run);
            CleanupStepResult::failed(label, Some(command), failure)
        }
        Err(failure) => CleanupStepResult::failed(label, Some(command), failure),
    }
}

/// Describes a pip step before the interpreter is known.
fn pip_step_label(args: &[String]) -> String {
    format!("<python> {}", args.join(" "))
}

/// Deletes a guarded target, but only after proving the path is the one intended.
///
/// The app derives this path itself, so a derivation bug is the whole risk. The
/// assertions below are what make the exception to ADR-0001 narrow enough to
/// trust: a path that cannot be proven is refused, never deleted.
fn run_guarded_deletion<F, D>(target: &GuardedTarget, runner: &F, deleter: &D) -> Result<(), String>
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
    D: Fn(&Path) -> Result<(), String>,
{
    match target {
        GuardedTarget::NpmNpxCache => {
            let root = npm_cache_root(runner)?;
            let path = root.join("_npx");
            assert_guarded_path(&path, &root, "_npx")?;
            deleter(&path)
        }
    }
}

fn npm_cache_root<F>(runner: &F) -> Result<PathBuf, String>
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let args = vec!["config".to_string(), "get".to_string(), "cache".to_string()];
    let run = runner("npm", &args, Duration::from_secs(5)).map_err(|failure| {
        format!(
            "Could not resolve the npm cache directory: {}",
            failure.message
        )
    })?;

    if run.exit_code != Some(0) {
        return Err("npm config get cache did not succeed, so _npx was left alone".to_string());
    }

    let root = run.stdout.trim();
    // An empty value would make `join("_npx")` yield the relative path `_npx`,
    // which would delete whatever sits under the process working directory.
    if root.is_empty() {
        return Err("npm reported an empty cache directory, so _npx was left alone".to_string());
    }

    Ok(PathBuf::from(root))
}

fn assert_guarded_path(path: &Path, root: &Path, expected_name: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!(
            "Refusing to delete {} because it is not an absolute path",
            path.display()
        ));
    }

    if !path.starts_with(root) {
        return Err(format!(
            "Refusing to delete {} because it is outside {}",
            path.display(),
            root.display()
        ));
    }

    if path.file_name().and_then(|name| name.to_str()) != Some(expected_name) {
        return Err(format!(
            "Refusing to delete {} because it is not named {expected_name}",
            path.display()
        ));
    }

    Ok(())
}

pub(crate) fn remove_dir_all_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    fs::remove_dir_all(path).map_err(|err| format!("Could not remove {}: {err}", path.display()))
}

/// A plan that partly ran is reported as partly run. Collapsing that into
/// "failed" tells the user to retry work that already happened.
fn outcome_for(steps: &[CleanupStepResult]) -> CleanupOutcome {
    let succeeded = steps
        .iter()
        .filter(|step| step.state == CleanupStepState::Succeeded)
        .count();
    let failed = steps
        .iter()
        .filter(|step| step.state == CleanupStepState::Failed)
        .count();

    match (succeeded, failed) {
        (_, 0) => CleanupOutcome::Succeeded,
        (0, _) => CleanupOutcome::Failed,
        _ => CleanupOutcome::PartiallyCompleted,
    }
}

fn cleanup_message(steps: &[CleanupStepResult]) -> Option<String> {
    steps
        .iter()
        .find(|step| step.state == CleanupStepState::Failed)
        .and_then(|step| step.failure.as_ref())
        .map(|failure| failure.message.clone())
}

impl CleanupStepResult {
    fn succeeded(
        label: String,
        command: Option<CommandEnvelope>,
        stdout: String,
        stderr: String,
    ) -> Self {
        Self {
            label,
            command,
            state: CleanupStepState::Succeeded,
            stdout,
            stderr,
            failure: None,
        }
    }

    fn failed(label: String, command: Option<CommandEnvelope>, failure: CommandFailure) -> Self {
        Self {
            label,
            command,
            state: CleanupStepState::Failed,
            stdout: failure.stdout.clone(),
            stderr: failure.stderr.clone(),
            failure: Some(failure),
        }
    }

    fn skipped(label: String, command: Option<CommandEnvelope>) -> Self {
        Self {
            label,
            command,
            state: CleanupStepState::Skipped,
            stdout: String::new(),
            stderr: String::new(),
            failure: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        assert_guarded_path, cleanup_plan, run_cache_cleanup_with_runner,
        run_cache_cleanup_with_runner_and_deleter, CleanupStep,
    };
    use crate::command::{envelope, envelope_owned};
    use crate::types::{
        CleanupOutcome, CleanupStepState, CommandFailure, CommandRun, FailureKind, ManagerId,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    fn plan_commands(manager: ManagerId) -> Vec<(&'static str, Vec<&'static str>)> {
        cleanup_plan(manager)
            .iter()
            .filter_map(|step| match step {
                CleanupStep::Command { program, args } => Some((*program, args.to_vec())),
                CleanupStep::PipCommand { .. } | CleanupStep::GuardedDeletion(_) => None,
            })
            .collect()
    }

    fn npm_runner(
        cache_root: String,
    ) -> impl Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure> {
        move |program: &str, args: &[String], timeout: Duration| match args
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice()
        {
            ["config", "get", "cache"] => {
                Ok(fake_run(program, args, timeout, &format!("{cache_root}\n")))
            }
            ["cache", "clean", "--force"] => {
                Ok(fake_run(program, args, timeout, "npm cache cleaned"))
            }
            other => panic!("unexpected npm args: {other:?}"),
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "pmcc-cleanup-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    struct TempRootGuard(PathBuf);

    impl Drop for TempRootGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[allow(clippy::ptr_arg)]
    fn fake_run(program: &str, args: &[String], timeout: Duration, stdout: &str) -> CommandRun {
        let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        CommandRun {
            envelope: envelope(program, &refs, timeout.as_millis() as u64),
            stdout: stdout.to_string(),
            stderr: String::new(),
            exit_code: Some(0),
            duration_ms: 1,
        }
    }

    fn fake_failed_run(
        program: &str,
        args: &[String],
        timeout: Duration,
        stderr: &str,
    ) -> CommandRun {
        let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        CommandRun {
            envelope: envelope(program, &refs, timeout.as_millis() as u64),
            stdout: String::new(),
            stderr: stderr.to_string(),
            exit_code: Some(1),
            duration_ms: 1,
        }
    }

    #[test]
    fn cleanup_plans_use_the_expected_structured_commands() {
        assert_eq!(
            plan_commands(ManagerId::Pnpm),
            vec![("pnpm", vec!["store", "prune"])]
        );
        assert_eq!(
            plan_commands(ManagerId::Yarn),
            vec![("yarn", vec!["cache", "clean"])]
        );
        assert_eq!(
            plan_commands(ManagerId::Bun),
            vec![("bun", vec!["pm", "cache", "rm"])]
        );
        assert_eq!(
            plan_commands(ManagerId::Uv),
            vec![("uv", vec!["cache", "prune"])]
        );
        assert_eq!(
            plan_commands(ManagerId::Homebrew),
            vec![("brew", vec!["cleanup"])]
        );
        assert_eq!(
            plan_commands(ManagerId::Docker),
            vec![
                ("docker", vec!["builder", "prune", "-f"]),
                ("docker", vec!["image", "prune", "-f"]),
            ]
        );
    }

    #[test]
    fn nvm_maven_and_cargo_have_no_cleanup_plan() {
        for manager in [ManagerId::Nvm, ManagerId::Maven, ManagerId::Cargo] {
            assert!(
                cleanup_plan(manager).is_empty(),
                "{manager:?} must have no cleanup plan — see ADR-0001"
            );
        }
    }

    #[test]
    fn uv_cleanup_never_bypasses_the_in_use_check() {
        let args = plan_commands(ManagerId::Uv)
            .into_iter()
            .flat_map(|(_, args)| args)
            .collect::<Vec<_>>();

        assert!(!args.contains(&"--force"));
        assert!(!args.contains(&"clean"));
        assert!(!args.contains(&"--ci"));
    }

    #[test]
    fn docker_cleanup_never_prunes_all_images_containers_or_volumes() {
        let args = plan_commands(ManagerId::Docker)
            .into_iter()
            .flat_map(|(_, args)| args)
            .collect::<Vec<_>>();

        assert!(!args.contains(&"-a"));
        assert!(!args.contains(&"--all"));
        assert!(!args.contains(&"system"));
        assert!(!args.contains(&"--volumes"));
        assert!(!args.contains(&"container"));
        assert!(!args.contains(&"volume"));
    }

    #[test]
    fn homebrew_cleanup_uses_no_extra_prune_flags() {
        let args = plan_commands(ManagerId::Homebrew)
            .into_iter()
            .flat_map(|(_, args)| args)
            .collect::<Vec<_>>();

        assert_eq!(args, vec!["cleanup"]);
    }

    #[test]
    fn managers_without_a_plan_report_no_plan_without_running_commands() {
        let result = run_cache_cleanup_with_runner(ManagerId::Cargo, &|program, args, _| {
            panic!("no command may run: {program} {args:?}")
        });

        assert_eq!(result.outcome, CleanupOutcome::NoPlan);
        assert!(result.steps.is_empty());
    }

    #[test]
    fn multi_step_plan_succeeds_when_every_step_succeeds() {
        let result = run_cache_cleanup_with_runner(ManagerId::Docker, &|program, args, timeout| {
            Ok(fake_run(program, args, timeout, "reclaimed 1GB"))
        });

        assert_eq!(result.outcome, CleanupOutcome::Succeeded);
        assert_eq!(result.steps.len(), 2);
        assert!(result
            .steps
            .iter()
            .all(|step| step.state == CleanupStepState::Succeeded));
        assert_eq!(result.message, None);
    }

    #[test]
    fn first_step_failing_stops_the_plan_and_reports_outright_failure() {
        let result =
            run_cache_cleanup_with_runner(ManagerId::Docker, &|program, args, timeout| match args
                .first()
                .map(String::as_str)
            {
                Some("builder") => Ok(fake_failed_run(
                    program,
                    args,
                    timeout,
                    "Cannot connect to the Docker daemon",
                )),
                other => panic!("later steps must not run, got {other:?}"),
            });

        assert_eq!(result.outcome, CleanupOutcome::Failed);
        assert_eq!(result.steps[0].state, CleanupStepState::Failed);
        assert_eq!(result.steps[1].state, CleanupStepState::Skipped);
        assert!(result
            .message
            .expect("failure message")
            .contains("docker builder prune -f"));
    }

    #[test]
    fn later_step_failing_reports_partial_completion_not_failure() {
        let result =
            run_cache_cleanup_with_runner(ManagerId::Docker, &|program, args, timeout| match args
                .first()
                .map(String::as_str)
            {
                Some("builder") => Ok(fake_run(program, args, timeout, "reclaimed 1GB")),
                Some("image") => Ok(fake_failed_run(program, args, timeout, "image is in use")),
                other => panic!("unexpected docker args: {other:?}"),
            });

        assert_eq!(result.outcome, CleanupOutcome::PartiallyCompleted);
        assert_eq!(result.steps[0].state, CleanupStepState::Succeeded);
        assert_eq!(result.steps[1].state, CleanupStepState::Failed);
        assert_eq!(result.steps[0].stdout, "reclaimed 1GB");
    }

    #[test]
    fn missing_binary_failures_are_reported_not_swallowed() {
        let result = run_cache_cleanup_with_runner(ManagerId::Yarn, &|program, args, timeout| {
            Err(CommandFailure {
                kind: FailureKind::MissingBinary,
                message: format!("{program} is not installed or is not on PATH"),
                command: Some(envelope_owned(
                    program,
                    args.to_vec(),
                    timeout.as_millis() as u64,
                )),
                stdout: String::new(),
                stderr: String::new(),
            })
        });

        assert_eq!(result.outcome, CleanupOutcome::Failed);
        assert!(matches!(
            result.steps[0]
                .failure
                .as_ref()
                .expect("failure recorded")
                .kind,
            FailureKind::MissingBinary
        ));
    }

    #[test]
    fn cleanup_steps_use_the_cleanup_timeout_not_the_scan_timeout() {
        let result = run_cache_cleanup_with_runner(ManagerId::Yarn, &|program, args, timeout| {
            assert_eq!(timeout, Duration::from_secs(300));
            Ok(fake_run(program, args, timeout, ""))
        });

        assert_eq!(
            result.steps[0]
                .command
                .as_ref()
                .expect("command envelope")
                .timeout_ms,
            300_000
        );
    }

    #[test]
    fn npm_plan_cleans_the_cache_then_removes_the_npx_directory() {
        let root = temp_root("npm-happy");
        let _guard = TempRootGuard(root.clone());
        let npx = root.join("_npx");
        fs::create_dir_all(npx.join("tool")).expect("create npx cache");

        let result =
            run_cache_cleanup_with_runner(ManagerId::Npm, &npm_runner(root.display().to_string()));

        assert_eq!(result.outcome, CleanupOutcome::Succeeded);
        assert_eq!(result.steps.len(), 2);
        assert_eq!(
            result.steps[0]
                .command
                .as_ref()
                .expect("command envelope")
                .preview,
            "npm cache clean --force"
        );
        assert!(result.steps[1].command.is_none());
        assert!(!npx.exists(), "the _npx directory should be gone");
    }

    #[test]
    fn npx_deletion_failing_after_the_cache_was_cleaned_reports_partial_completion() {
        let result = run_cache_cleanup_with_runner_and_deleter(
            ManagerId::Npm,
            &npm_runner("/tmp/pmcc-npm-cache".to_string()),
            &|path| Err(format!("Could not remove {}", path.display())),
        );

        // The cache really was cleaned. Reporting outright failure would send the
        // user back to retry work that already happened.
        assert_eq!(result.outcome, CleanupOutcome::PartiallyCompleted);
        assert_eq!(result.steps[0].state, CleanupStepState::Succeeded);
        assert_eq!(result.steps[1].state, CleanupStepState::Failed);
    }

    #[test]
    fn npx_deletion_is_refused_when_npm_reports_an_empty_cache_directory() {
        let result = run_cache_cleanup_with_runner_and_deleter(
            ManagerId::Npm,
            &|program: &str, args: &[String], timeout: Duration| match args
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .as_slice()
            {
                ["config", "get", "cache"] => Ok(fake_run(program, args, timeout, "\n")),
                ["cache", "clean", "--force"] => {
                    Ok(fake_run(program, args, timeout, "npm cache cleaned"))
                }
                other => panic!("unexpected npm args: {other:?}"),
            },
            &|path: &Path| panic!("the deleter must never be called, got {}", path.display()),
        );

        assert_eq!(result.outcome, CleanupOutcome::PartiallyCompleted);
        assert_eq!(result.steps[1].state, CleanupStepState::Failed);
        assert!(result
            .message
            .expect("failure message")
            .contains("empty cache directory"));
    }

    #[test]
    fn an_empty_npm_cache_value_never_reaches_the_deleter() {
        // The regression this guards: `Path::new("").join("_npx")` is the relative
        // path `_npx`, which would delete a directory under the process cwd.
        let result = run_cache_cleanup_with_runner_and_deleter(
            ManagerId::Npm,
            &|program: &str, args: &[String], timeout: Duration| match args
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .as_slice()
            {
                ["config", "get", "cache"] => Ok(fake_run(program, args, timeout, "")),
                _ => Ok(fake_run(program, args, timeout, "npm cache cleaned")),
            },
            &|path: &Path| panic!("the deleter must never be called, got {}", path.display()),
        );

        assert_eq!(result.steps[1].state, CleanupStepState::Failed);
    }

    #[test]
    fn npx_deletion_is_refused_for_a_relative_cache_directory() {
        let result = run_cache_cleanup_with_runner_and_deleter(
            ManagerId::Npm,
            &npm_runner("relative/npm-cache".to_string()),
            &|path: &Path| panic!("the deleter must never be called, got {}", path.display()),
        );

        assert_eq!(result.steps[1].state, CleanupStepState::Failed);
        assert!(result
            .message
            .expect("failure message")
            .contains("not an absolute path"));
    }

    #[test]
    fn npx_deletion_is_refused_when_npm_cannot_report_its_cache_directory() {
        let result = run_cache_cleanup_with_runner_and_deleter(
            ManagerId::Npm,
            &|program: &str, args: &[String], timeout: Duration| match args
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .as_slice()
            {
                ["config", "get", "cache"] => Ok(fake_failed_run(program, args, timeout, "ENOENT")),
                _ => Ok(fake_run(program, args, timeout, "npm cache cleaned")),
            },
            &|path: &Path| panic!("the deleter must never be called, got {}", path.display()),
        );

        assert_eq!(result.steps[1].state, CleanupStepState::Failed);
    }

    #[test]
    fn guarded_path_assertions_accept_only_the_intended_directory() {
        let root = Path::new("/tmp/npm-cache");

        assert!(assert_guarded_path(&root.join("_npx"), root, "_npx").is_ok());
        assert!(assert_guarded_path(Path::new("_npx"), Path::new(""), "_npx").is_err());
        assert!(assert_guarded_path(&root.join("_cacache"), root, "_npx").is_err());
        assert!(assert_guarded_path(Path::new("/etc/_npx"), root, "_npx").is_err());
        assert!(assert_guarded_path(root, root, "_npx").is_err());
    }

    #[test]
    fn a_failed_npm_cache_clean_skips_the_npx_deletion_entirely() {
        let result = run_cache_cleanup_with_runner_and_deleter(
            ManagerId::Npm,
            &|program: &str, args: &[String], timeout: Duration| match args
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .as_slice()
            {
                ["cache", "clean", "--force"] => {
                    Ok(fake_failed_run(program, args, timeout, "EACCES"))
                }
                other => panic!("unexpected npm args: {other:?}"),
            },
            &|path: &Path| panic!("the deleter must never be called, got {}", path.display()),
        );

        assert_eq!(result.outcome, CleanupOutcome::Failed);
        assert_eq!(result.steps[0].state, CleanupStepState::Failed);
        assert_eq!(result.steps[1].state, CleanupStepState::Skipped);
    }

    #[test]
    fn pip_cleanup_resolves_its_own_interpreter_and_purges_the_cache() {
        let result = run_cache_cleanup_with_runner(
            ManagerId::Pip,
            &|program: &str, args: &[String], timeout: Duration| match (
                program,
                args.iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>()
                    .as_slice(),
            ) {
                ("python3", ["--version"]) => Ok(fake_run(program, args, timeout, "Python 3.13.0")),
                ("python3", ["-m", "pip", "cache", "purge"]) => {
                    Ok(fake_run(program, args, timeout, "Files removed: 120"))
                }
                other => panic!("unexpected pip cleanup call: {other:?}"),
            },
        );

        assert_eq!(result.outcome, CleanupOutcome::Succeeded);
        assert_eq!(
            result.steps[0]
                .command
                .as_ref()
                .expect("command envelope")
                .preview,
            "python3 -m pip cache purge"
        );
    }

    #[test]
    fn pip_cleanup_falls_back_to_python_when_python3_is_absent() {
        let result = run_cache_cleanup_with_runner(
            ManagerId::Pip,
            &|program: &str, args: &[String], timeout: Duration| {
                if program == "python3" {
                    return Err(CommandFailure {
                        kind: FailureKind::MissingBinary,
                        message: "python3 is not installed or is not on PATH".to_string(),
                        command: None,
                        stdout: String::new(),
                        stderr: String::new(),
                    });
                }
                Ok(fake_run(program, args, timeout, "ok"))
            },
        );

        assert_eq!(result.outcome, CleanupOutcome::Succeeded);
        assert_eq!(
            result.steps[0]
                .command
                .as_ref()
                .expect("command envelope")
                .preview,
            "python -m pip cache purge"
        );
    }

    #[test]
    fn pip_cleanup_reports_a_failure_when_no_interpreter_can_be_resolved() {
        let result = run_cache_cleanup_with_runner(
            ManagerId::Pip,
            &|program: &str, args: &[String], timeout: Duration| {
                if args.iter().any(|arg| arg == "purge") {
                    panic!("pip must not run without a resolved interpreter");
                }
                Ok(fake_failed_run(program, args, timeout, "command not found"))
            },
        );

        assert_eq!(result.outcome, CleanupOutcome::Failed);
        assert!(result
            .message
            .expect("failure message")
            .contains("python3 and python are not installed"));
    }

    #[test]
    fn pip_cleanup_never_takes_an_interpreter_from_the_caller() {
        // `run_cache_cleanup` accepts only a ManagerId. If an interpreter could be
        // passed in, the API would accept an arbitrary program path and the
        // allowlist guarantee in ADR-0001 would be gone.
        let plan = cleanup_plan(ManagerId::Pip);

        assert!(matches!(plan[0], CleanupStep::PipCommand { args } if args == ["cache", "purge"]));
    }

    #[test]
    fn the_runner_receives_structured_args_never_a_shell_string() {
        run_cache_cleanup_with_runner(ManagerId::Bun, &|program, args, timeout| {
            assert_eq!(program, "bun");
            assert_eq!(
                args,
                &["pm".to_string(), "cache".to_string(), "rm".to_string()]
            );
            assert!(args.iter().all(|arg| !arg.contains(' ')));
            Ok(fake_run(program, args, timeout, ""))
        });
    }
}
