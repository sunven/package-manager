use super::scan_support::{
    empty_snapshot, expand_tilde, finish, home_dir, json_string, package_row, push_signal,
    split_package_version, trimmed,
};
use crate::command::{command_failure, envelope_owned, parse_failure, push_command, run_command};
use crate::disk_usage::path_info;
use crate::types::{
    AsyncStatus, CommandFailure, CommandRun, FailureKind, MaintenanceRunPreview, ManagerId,
    ManagerSnapshot, ManagerStatus, NpmMaintenanceOperation, PackageKind, PackageRow,
    PackageSignal, PathKind, PnpmMaintenanceOperation,
};
use serde_json::Value;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(super) fn scan_npm() -> ManagerSnapshot {
    scan_npm_with_runner(&run_command)
}

fn scan_npm_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Npm, "npm");

    let version = match runner("npm", &["--version"], Duration::from_secs(5)) {
        Ok(run) if run.exit_code == Some(0) => Some(trimmed(run.stdout)),
        Ok(run) => {
            snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                "npm version probe failed",
                run,
            ));
            return finish(snapshot);
        }
        Err(failure) => {
            snapshot.failures.push(failure);
            return finish(snapshot);
        }
    };

    snapshot.version = version;
    push_command(
        &mut snapshot,
        "npm",
        &["ls", "-g", "--depth=0", "--json"],
        15,
    );
    push_command(&mut snapshot, "npm", &["config", "get", "cache"], 5);
    push_command(&mut snapshot, "npm", &["root", "-g"], 5);

    match runner(
        "npm",
        &["ls", "-g", "--depth=0", "--json"],
        Duration::from_secs(15),
    ) {
        Ok(run) if run.exit_code == Some(0) => match parse_npm_packages(&run.stdout) {
            Ok(packages) => snapshot.packages = packages,
            Err(message) => snapshot.failures.push(parse_failure(message, run)),
        },
        Ok(run) => snapshot.failures.push(command_failure(
            FailureKind::CommandFailed,
            "npm global package list failed",
            run,
        )),
        Err(failure) => snapshot.failures.push(failure),
    }

    if let Some(path) =
        command_stdout_with_runner("npm", &["config", "get", "cache"], 5, &mut snapshot, runner)
    {
        let npx_path = npx_cache_path(&path);
        snapshot
            .paths
            .push(path_info("Cache", PathKind::Cache, path));
        snapshot
            .paths
            .push(path_info("npx cache", PathKind::NpxCache, npx_path));
    }

    if let Some(path) = command_stdout_with_runner("npm", &["root", "-g"], 5, &mut snapshot, runner)
    {
        attach_missing_paths(&mut snapshot.packages, &path);
        snapshot
            .paths
            .push(path_info("Global modules", PathKind::GlobalModules, path));
    }

    finish(snapshot)
}

pub(super) fn scan_pnpm() -> ManagerSnapshot {
    scan_pnpm_with_runner(&run_command)
}

fn scan_pnpm_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Pnpm, "pnpm");

    let version = match runner("pnpm", &["--version"], Duration::from_secs(5)) {
        Ok(run) if run.exit_code == Some(0) => Some(trimmed(run.stdout)),
        Ok(run) => {
            snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                "pnpm version probe failed",
                run,
            ));
            return finish(snapshot);
        }
        Err(failure) => {
            snapshot.failures.push(failure);
            return finish(snapshot);
        }
    };

    snapshot.version = version;
    push_command(
        &mut snapshot,
        "pnpm",
        &["list", "-g", "--depth=0", "--json"],
        15,
    );
    push_command(&mut snapshot, "pnpm", &["store", "path"], 5);
    push_command(&mut snapshot, "pnpm", &["root", "-g"], 5);

    match runner(
        "pnpm",
        &["list", "-g", "--depth=0", "--json"],
        Duration::from_secs(15),
    ) {
        Ok(run) if run.exit_code == Some(0) => match parse_pnpm_packages(&run.stdout) {
            Ok(packages) => snapshot.packages = packages,
            Err(message) => snapshot.failures.push(parse_failure(message, run)),
        },
        Ok(run) => snapshot.failures.push(command_failure(
            FailureKind::CommandFailed,
            "pnpm global package list failed",
            run,
        )),
        Err(failure) => snapshot.failures.push(failure),
    }

    if let Some(path) =
        command_stdout_with_runner("pnpm", &["store", "path"], 5, &mut snapshot, runner)
    {
        snapshot
            .paths
            .push(path_info("Store", PathKind::Store, path));
    }

    if let Some(path) =
        command_stdout_with_runner("pnpm", &["root", "-g"], 5, &mut snapshot, runner)
    {
        attach_missing_paths(&mut snapshot.packages, &path);
        snapshot
            .paths
            .push(path_info("Global modules", PathKind::GlobalModules, path));
    }

    finish(snapshot)
}

pub(super) fn scan_yarn() -> ManagerSnapshot {
    scan_yarn_with_runner(&run_command)
}

fn scan_yarn_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Yarn, "Yarn");

    let version = match runner("yarn", &["--version"], Duration::from_secs(5)) {
        Ok(run) if run.exit_code == Some(0) => trimmed(run.stdout),
        Ok(run) => {
            snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                "Yarn version probe failed",
                run,
            ));
            return finish(snapshot);
        }
        Err(failure) => {
            snapshot.failures.push(failure);
            return finish(snapshot);
        }
    };

    snapshot.version = Some(version.clone());
    let major = version
        .split('.')
        .next()
        .and_then(|part| part.parse::<u64>().ok());

    match major {
        Some(1) => scan_yarn_classic(&mut snapshot, runner),
        Some(_) => scan_yarn_modern(&mut snapshot, runner),
        None => {
            snapshot.failures.push(CommandFailure {
                kind: FailureKind::ParseFailure,
                message: format!("Could not parse Yarn version: {version}"),
                command: None,
                stdout: version,
                stderr: String::new(),
            });
        }
    }

    finish(snapshot)
}

fn scan_yarn_classic<F>(snapshot: &mut ManagerSnapshot, runner: &F)
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    push_command(snapshot, "yarn", &["global", "list", "--json"], 15);
    push_command(snapshot, "yarn", &["cache", "dir"], 5);
    push_command(snapshot, "yarn", &["global", "dir"], 5);

    match runner(
        "yarn",
        &["global", "list", "--json"],
        Duration::from_secs(15),
    ) {
        Ok(run) if run.exit_code == Some(0) => match parse_yarn_classic_packages(&run.stdout) {
            Ok(packages) => snapshot.packages = packages,
            Err(message) => snapshot.failures.push(parse_failure(message, run)),
        },
        Ok(run) => snapshot.failures.push(command_failure(
            FailureKind::CommandFailed,
            "Yarn global package list failed",
            run,
        )),
        Err(failure) => snapshot.failures.push(failure),
    }

    if let Some(path) = command_stdout_with_runner("yarn", &["cache", "dir"], 5, snapshot, runner) {
        snapshot
            .paths
            .push(path_info("Cache", PathKind::Cache, path));
    }

    if let Some(path) = command_stdout_with_runner("yarn", &["global", "dir"], 5, snapshot, runner)
    {
        snapshot
            .paths
            .push(path_info("Global dir", PathKind::GlobalDir, path));
    }
}

fn scan_yarn_modern<F>(snapshot: &mut ManagerSnapshot, runner: &F)
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    snapshot.status = ManagerStatus::Unsupported;
    snapshot.unsupported_reason = Some(
        "Yarn 2+ does not expose a global package list equivalent to npm, pnpm, or Yarn Classic."
            .to_string(),
    );
    push_command(snapshot, "yarn", &["config", "get", "cacheFolder"], 5);

    if let Some(path) = command_stdout_with_runner(
        "yarn",
        &["config", "get", "cacheFolder"],
        5,
        snapshot,
        runner,
    ) {
        snapshot
            .paths
            .push(path_info("Cache folder", PathKind::Cache, path));
    }
}

fn command_stdout_with_runner<F>(
    program: &str,
    args: &[&str],
    timeout_secs: u64,
    snapshot: &mut ManagerSnapshot,
    runner: &F,
) -> Option<String>
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    match runner(program, args, Duration::from_secs(timeout_secs)) {
        Ok(run) if run.exit_code == Some(0) => Some(run.stdout.trim().to_string()),
        Ok(run) => {
            let message = format!("{} failed", run.envelope.preview);
            snapshot
                .failures
                .push(command_failure(FailureKind::CommandFailed, &message, run));
            None
        }
        Err(failure) => {
            snapshot.failures.push(failure);
            None
        }
    }
}

pub(super) fn scan_nvm() -> ManagerSnapshot {
    scan_nvm_with_dir(resolve_nvm_dir_from_env())
}

fn scan_nvm_with_dir(nvm_dir: PathBuf) -> ManagerSnapshot {
    scan_nvm_with_context(nvm_dir, env::var("NVM_BIN").ok())
}

fn scan_nvm_with_context(nvm_dir: PathBuf, nvm_bin: Option<String>) -> ManagerSnapshot {
    let mut snapshot = empty_snapshot(ManagerId::Nvm, "nvm");
    let node_versions_dir = nvm_dir.join("versions/node");

    snapshot.paths.push(path_info(
        "NVM dir",
        PathKind::NvmDir,
        nvm_dir.display().to_string(),
    ));

    if !nvm_dir.is_dir() {
        snapshot.failures.push(CommandFailure {
            kind: FailureKind::MissingPath,
            message: format!("nvm directory was not found at {}", nvm_dir.display()),
            command: None,
            stdout: String::new(),
            stderr: String::new(),
        });
        return finish(snapshot);
    }

    snapshot.paths.push(path_info(
        "Node versions",
        PathKind::NvmNodeVersions,
        node_versions_dir.display().to_string(),
    ));

    let current_version = current_nvm_node_version(&nvm_dir, nvm_bin.as_deref());
    snapshot.packages = scan_nvm_node_versions(&node_versions_dir, current_version.as_deref());
    finish(snapshot)
}

fn resolve_nvm_dir_from_env() -> PathBuf {
    let nvm_dir = env::var("NVM_DIR").ok();
    resolve_nvm_dir(nvm_dir.as_deref(), home_dir().as_deref())
}

fn resolve_nvm_dir(nvm_dir: Option<&str>, home: Option<&Path>) -> PathBuf {
    if let Some(value) = nvm_dir.map(str::trim).filter(|value| !value.is_empty()) {
        return expand_tilde(value, home);
    }

    home.map(|home| home.join(".nvm"))
        .unwrap_or_else(|| PathBuf::from(".nvm"))
}

fn scan_nvm_node_versions(
    node_versions_dir: &Path,
    current_version: Option<&str>,
) -> Vec<PackageRow> {
    let entries = match fs::read_dir(node_versions_dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut packages = entries
        .flatten()
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() {
                return None;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            let version = parse_nvm_node_version_dir(&name)?;
            let mut row = package_row(
                "node".to_string(),
                version.clone(),
                Some(entry.path().display().to_string()),
                "nvm versions directory",
                PackageKind::Generic,
            );
            if current_version == Some(version.as_str()) {
                push_signal(&mut row, PackageSignal::Current);
            }
            attach_nvm_actions(&mut row, &version);
            Some(row)
        })
        .collect::<Vec<_>>();

    packages.sort_by(|a, b| compare_semver_desc(&a.version, &b.version));
    packages
}

fn current_nvm_node_version(nvm_dir: &Path, nvm_bin: Option<&str>) -> Option<String> {
    nvm_bin
        .and_then(current_nvm_node_version_from_bin)
        .or_else(|| current_nvm_node_version_from_symlink(nvm_dir))
}

fn current_nvm_node_version_from_symlink(nvm_dir: &Path) -> Option<String> {
    let target = fs::read_link(nvm_dir.join("current")).ok()?;
    target
        .file_name()
        .and_then(|name| parse_nvm_node_version_dir(&name.to_string_lossy()))
}

fn current_nvm_node_version_from_bin(path: &str) -> Option<String> {
    let mut components = Path::new(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>();

    if components
        .last()
        .is_some_and(|component| component == "bin")
    {
        components.pop();
    }

    components
        .last()
        .and_then(|name| parse_nvm_node_version_dir(name))
}

fn parse_nvm_node_version_dir(name: &str) -> Option<String> {
    let version = name.strip_prefix('v')?;
    if version.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        Some(version.to_string())
    } else {
        None
    }
}

fn compare_semver_desc(left: &str, right: &str) -> std::cmp::Ordering {
    semver_sort_key(right)
        .cmp(&semver_sort_key(left))
        .then_with(|| right.cmp(left))
}

fn semver_sort_key(version: &str) -> (u64, u64, u64) {
    let mut parts = version.split('.');
    (
        parts.next().and_then(|part| part.parse().ok()).unwrap_or(0),
        parts.next().and_then(|part| part.parse().ok()).unwrap_or(0),
        parts
            .next()
            .and_then(|part| part.split('-').next())
            .and_then(|part| part.parse().ok())
            .unwrap_or(0),
    )
}

fn attach_nvm_actions(row: &mut PackageRow, version: &str) {
    row.actions.push(envelope_owned(
        "nvm",
        vec!["use".to_string(), version.to_string()],
        0,
    ));
}

pub(crate) fn run_npm_maintenance_with_runner<F>(
    operation: NpmMaintenanceOperation,
    runner: &F,
) -> MaintenanceRunPreview
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let args = match operation {
        NpmMaintenanceOperation::UninstallGlobalPackage { package_name } => {
            vec!["uninstall".to_string(), "-g".to_string(), package_name]
        }
    };
    let command = envelope_owned("npm", args.clone(), 30_000);

    match runner("npm", &args, Duration::from_secs(30)) {
        Ok(run) if run.exit_code == Some(0) => MaintenanceRunPreview {
            status: AsyncStatus::Ready,
            command,
            stdout: run.stdout,
            stderr: run.stderr,
            message: None,
            failure: None,
        },
        Ok(run) => {
            let failure =
                command_failure(FailureKind::CommandFailed, "npm maintenance failed", run);
            MaintenanceRunPreview {
                status: AsyncStatus::Failed,
                command,
                stdout: failure.stdout.clone(),
                stderr: failure.stderr.clone(),
                message: Some(failure.message.clone()),
                failure: Some(failure),
            }
        }
        Err(failure) => MaintenanceRunPreview {
            status: AsyncStatus::Failed,
            command,
            stdout: failure.stdout.clone(),
            stderr: failure.stderr.clone(),
            message: Some(failure.message.clone()),
            failure: Some(failure),
        },
    }
}

pub(crate) fn run_pnpm_maintenance_with_runner<F>(
    operation: PnpmMaintenanceOperation,
    runner: &F,
) -> MaintenanceRunPreview
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let args = match operation {
        PnpmMaintenanceOperation::UninstallGlobalPackage { package_name } => {
            vec!["remove".to_string(), "--global".to_string(), package_name]
        }
    };
    let command = envelope_owned("pnpm", args.clone(), 30_000);

    match runner("pnpm", &args, Duration::from_secs(30)) {
        Ok(run) if run.exit_code == Some(0) => MaintenanceRunPreview {
            status: AsyncStatus::Ready,
            command,
            stdout: run.stdout,
            stderr: run.stderr,
            message: None,
            failure: None,
        },
        Ok(run) => {
            let failure =
                command_failure(FailureKind::CommandFailed, "pnpm maintenance failed", run);
            MaintenanceRunPreview {
                status: AsyncStatus::Failed,
                command,
                stdout: failure.stdout.clone(),
                stderr: failure.stderr.clone(),
                message: Some(failure.message.clone()),
                failure: Some(failure),
            }
        }
        Err(failure) => MaintenanceRunPreview {
            status: AsyncStatus::Failed,
            command,
            stdout: failure.stdout.clone(),
            stderr: failure.stderr.clone(),
            message: Some(failure.message.clone()),
            failure: Some(failure),
        },
    }
}

fn parse_npm_packages(stdout: &str) -> Result<Vec<PackageRow>, String> {
    let value: Value = serde_json::from_str(stdout).map_err(|err| err.to_string())?;
    let Some(dependencies) = value.get("dependencies").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };

    let mut packages = dependencies
        .iter()
        .map(|(name, package)| {
            package_row(
                name.to_string(),
                json_string(package.get("version")).unwrap_or_else(|| "unknown".to_string()),
                json_string(package.get("path")),
                "npm ls -g --depth=0 --json",
                PackageKind::Generic,
            )
        })
        .collect::<Vec<_>>();
    packages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packages)
}

fn parse_pnpm_packages(stdout: &str) -> Result<Vec<PackageRow>, String> {
    let value: Value = serde_json::from_str(stdout).map_err(|err| err.to_string())?;
    let workspaces = value
        .as_array()
        .ok_or_else(|| "pnpm output was not an array".to_string())?;
    let mut packages = Vec::new();

    for workspace in workspaces {
        let Some(dependencies) = workspace.get("dependencies").and_then(Value::as_object) else {
            continue;
        };

        for (name, package) in dependencies {
            packages.push(package_row(
                name.to_string(),
                json_string(package.get("version")).unwrap_or_else(|| "unknown".to_string()),
                json_string(package.get("path")),
                "pnpm list -g --depth=0 --json",
                PackageKind::Generic,
            ));
        }
    }

    packages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packages)
}

fn parse_yarn_classic_packages(stdout: &str) -> Result<Vec<PackageRow>, String> {
    let mut packages = Vec::new();

    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => return Ok(parse_yarn_human_list(stdout)),
        };
        if value.get("type").and_then(Value::as_str) != Some("tree") {
            continue;
        }

        if let Some(trees) = value
            .get("data")
            .and_then(|data| data.get("trees"))
            .and_then(Value::as_array)
        {
            for node in trees {
                if let Some(name) = node.get("name").and_then(Value::as_str) {
                    packages.push(yarn_package_row(name));
                }
            }
        }
    }

    if packages.is_empty() {
        packages = parse_yarn_human_list(stdout);
    }

    packages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packages)
}

fn parse_yarn_human_list(stdout: &str) -> Vec<PackageRow> {
    stdout
        .lines()
        .flat_map(str::split_whitespace)
        .map(trim_yarn_token)
        .filter(|token| token.contains('@'))
        .map(|token| yarn_package_row(&token))
        .collect()
}

fn trim_yarn_token(token: &str) -> String {
    token
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | ',' | ':' | ';' | '(' | ')' | '[' | ']'))
        .to_string()
}

fn yarn_package_row(raw: &str) -> PackageRow {
    let (name, version) = split_package_version(raw);
    package_row(
        name,
        version,
        None,
        "yarn global list --json",
        PackageKind::Generic,
    )
}

fn npx_cache_path(cache_path: &str) -> String {
    Path::new(cache_path).join("_npx").display().to_string()
}

fn attach_missing_paths(packages: &mut [PackageRow], root: &str) {
    for package in packages {
        if package.path.is_none() {
            package.path = Some(Path::new(root).join(&package.name).display().to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        npx_cache_path, parse_npm_packages, parse_pnpm_packages, parse_yarn_classic_packages,
        resolve_nvm_dir, run_npm_maintenance_with_runner, run_pnpm_maintenance_with_runner,
        scan_npm_with_runner, scan_nvm_with_context, scan_nvm_with_dir,
    };
    use crate::managers::test_support::{fake_failed_run, fake_run, temp_dir};
    use crate::types::{
        AsyncStatus, CommandFailure, CommandRun, FailureKind, ManagerId, ManagerStatus,
        NpmMaintenanceOperation, PackageSignal, PathKind, PnpmMaintenanceOperation,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    #[test]
    fn parse_npm_packages_returns_empty_vec_when_dependencies_missing() {
        let packages =
            parse_npm_packages(r#"{"name":"npm","version":"10.0.0"}"#).expect("parse npm output");

        assert!(packages.is_empty());
    }

    #[test]
    fn parse_npm_packages_sorts_and_keeps_paths() {
        let packages = parse_npm_packages(
            r#"{
                "dependencies": {
                    "zeta": {"version": "2.0.0", "path": "/tmp/zeta"},
                    "alpha": {"version": "1.0.0", "path": "/tmp/alpha"}
                }
            }"#,
        )
        .expect("parse npm output");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "alpha");
        assert_eq!(packages[0].version, "1.0.0");
        assert_eq!(packages[0].path.as_deref(), Some("/tmp/alpha"));
        assert_eq!(packages[1].name, "zeta");
        assert_eq!(packages[1].version, "2.0.0");
        assert_eq!(packages[1].path.as_deref(), Some("/tmp/zeta"));
    }

    #[test]
    fn npx_cache_path_uses_npm_cache_subdirectory() {
        assert_eq!(npx_cache_path("/tmp/npm-cache"), "/tmp/npm-cache/_npx");
    }

    #[test]
    fn scan_npm_collects_packages_paths_and_commands() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "npm");
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "10.8.2\n")),
                ["ls", "-g", "--depth=0", "--json"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    r#"{"dependencies":{"prettier":{"version":"3.5.3"}}}"#,
                )),
                ["config", "get", "cache"] => {
                    Ok(fake_run(program, args, timeout, "/Users/sunven/.npm\n"))
                }
                ["root", "-g"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "/opt/homebrew/lib/node_modules\n",
                )),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot = scan_npm_with_runner(&runner);

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.version.as_deref(), Some("10.8.2"));
        assert_eq!(snapshot.packages.len(), 1);
        assert_eq!(snapshot.packages[0].name, "prettier");
        assert_eq!(
            snapshot.packages[0].path.as_deref(),
            Some("/opt/homebrew/lib/node_modules/prettier")
        );
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::NpxCache));
        assert!(snapshot
            .commands
            .iter()
            .any(|command| command.preview == "npm ls -g --depth=0 --json"));
    }

    #[test]
    fn resolve_nvm_dir_uses_env_or_home_fallback() {
        assert_eq!(
            resolve_nvm_dir(Some("~/node/nvm"), Some(Path::new("/Users/sunven"))),
            PathBuf::from("/Users/sunven/node/nvm")
        );
        assert_eq!(
            resolve_nvm_dir(None, Some(Path::new("/Users/sunven"))),
            PathBuf::from("/Users/sunven/.nvm")
        );
        assert_eq!(resolve_nvm_dir(None, None), PathBuf::from(".nvm"));
    }

    #[test]
    fn scan_nvm_reads_installed_node_versions_from_nvm_dir() {
        let root = temp_dir("nvm");
        fs::create_dir_all(root.path().join("versions/node/v20.11.1/bin"))
            .expect("create node version");
        fs::create_dir_all(root.path().join("versions/node/v18.19.0/bin"))
            .expect("create node version");
        fs::create_dir_all(root.path().join("versions/node/not-a-version"))
            .expect("create ignored dir");

        let snapshot = scan_nvm_with_context(root.path().to_path_buf(), None);

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.id, ManagerId::Nvm);
        assert!(snapshot.paths.iter().any(|path| {
            path.kind == PathKind::NvmDir && path.path == root.path().display().to_string()
        }));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::NvmNodeVersions));
        assert_eq!(snapshot.packages.len(), 2);
        assert_eq!(snapshot.packages[0].name, "node");
        assert_eq!(snapshot.packages[0].version, "20.11.1");
        assert_eq!(snapshot.packages[1].version, "18.19.0");
        assert!(snapshot.packages[0]
            .actions
            .iter()
            .any(|action| action.preview == "nvm use 20.11.1"));
    }

    #[cfg(unix)]
    #[test]
    fn scan_nvm_marks_current_node_version() {
        let root = temp_dir("nvm-current");
        fs::create_dir_all(root.path().join("versions/node/v20.11.1/bin"))
            .expect("create node version");
        fs::create_dir_all(root.path().join("versions/node/v18.19.0/bin"))
            .expect("create node version");
        std::os::unix::fs::symlink(
            root.path().join("versions/node/v18.19.0"),
            root.path().join("current"),
        )
        .expect("create symlink");

        let snapshot = scan_nvm_with_context(root.path().to_path_buf(), None);
        let current = snapshot
            .packages
            .iter()
            .find(|package| package.version == "18.19.0")
            .expect("current package");

        assert!(current.signals.contains(&PackageSignal::Current));
    }

    #[test]
    fn scan_nvm_marks_current_node_version_from_nvm_bin() {
        let root = temp_dir("nvm-current-bin");
        fs::create_dir_all(root.path().join("versions/node/v20.11.1/bin"))
            .expect("create node version");
        fs::create_dir_all(root.path().join("versions/node/v18.19.0/bin"))
            .expect("create node version");
        let nvm_bin = root
            .path()
            .join("versions/node/v20.11.1/bin")
            .display()
            .to_string();

        let snapshot = scan_nvm_with_context(root.path().to_path_buf(), Some(nvm_bin));

        assert!(snapshot
            .packages
            .iter()
            .find(|package| package.version == "20.11.1")
            .expect("current package")
            .signals
            .contains(&PackageSignal::Current));
    }

    #[test]
    fn scan_nvm_reports_missing_when_nvm_dir_does_not_exist() {
        let root = temp_dir("missing-nvm");
        let missing = root.path().join("absent");

        let snapshot = scan_nvm_with_dir(missing);

        assert_eq!(snapshot.status, ManagerStatus::Missing);
        assert!(snapshot.packages.is_empty());
        assert!(matches!(
            snapshot.failures[0].kind,
            FailureKind::MissingPath
        ));
    }

    #[test]
    fn parse_pnpm_packages_reads_array_entries() {
        let packages = parse_pnpm_packages(
            r#"[
                {
                    "dependencies": {
                        "beta": {"version": "2.1.0", "path": "/tmp/beta"}
                    }
                },
                {
                    "dependencies": {
                        "alpha": {"version": "1.3.0", "path": "/tmp/alpha"}
                    }
                }
            ]"#,
        )
        .expect("parse pnpm output");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "alpha");
        assert_eq!(packages[0].version, "1.3.0");
        assert_eq!(packages[0].path.as_deref(), Some("/tmp/alpha"));
        assert_eq!(packages[1].name, "beta");
        assert_eq!(packages[1].version, "2.1.0");
        assert_eq!(packages[1].path.as_deref(), Some("/tmp/beta"));
    }

    #[test]
    fn parse_yarn_classic_packages_reads_tree_lines() {
        let packages = parse_yarn_classic_packages(
            r#"{"type":"tree","data":{"trees":[{"name":"@scope/tool@2.0.0"},{"name":"alpha@1.0.0"}]}}
{"type":"success","data":"Done"}"#,
        )
        .expect("parse yarn output");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "@scope/tool");
        assert_eq!(packages[0].version, "2.0.0");
        assert_eq!(packages[1].name, "alpha");
        assert_eq!(packages[1].version, "1.0.0");
    }

    #[test]
    fn parse_yarn_classic_packages_falls_back_to_human_list() {
        let packages = parse_yarn_classic_packages(
            r#"info "@scope/tool@2.0.0" has binaries:
  - tool
info "alpha@1.0.0" has binaries:
  - alpha
"#,
        )
        .expect("parse yarn fallback");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "@scope/tool");
        assert_eq!(packages[0].version, "2.0.0");
        assert_eq!(packages[1].name, "alpha");
        assert_eq!(packages[1].version, "1.0.0");
    }

    #[test]
    fn run_npm_maintenance_uninstalls_scoped_package_with_structured_args() {
        let result = run_npm_maintenance_with_runner(
            NpmMaintenanceOperation::UninstallGlobalPackage {
                package_name: "@scope/tool".to_string(),
            },
            &|program, args, timeout| {
                assert_eq!(program, "npm");
                assert_eq!(
                    args,
                    &[
                        "uninstall".to_string(),
                        "-g".to_string(),
                        "@scope/tool".to_string()
                    ]
                );
                Ok(fake_run(
                    program,
                    &["uninstall", "-g", "@scope/tool"],
                    timeout,
                    "removed 1 package",
                ))
            },
        );

        assert_eq!(result.status, AsyncStatus::Ready);
        assert_eq!(result.command.preview, "npm uninstall -g @scope/tool");
    }

    #[test]
    fn run_npm_maintenance_reports_failed_uninstall() {
        let result = run_npm_maintenance_with_runner(
            NpmMaintenanceOperation::UninstallGlobalPackage {
                package_name: "missing-tool".to_string(),
            },
            &|program, args, timeout| {
                assert_eq!(program, "npm");
                assert_eq!(
                    args,
                    &[
                        "uninstall".to_string(),
                        "-g".to_string(),
                        "missing-tool".to_string()
                    ]
                );
                Ok(fake_failed_run(
                    "npm",
                    &["uninstall", "-g", "missing-tool"],
                    timeout,
                    "not installed",
                ))
            },
        );

        assert_eq!(result.status, AsyncStatus::Failed);
        assert_eq!(result.stderr, "not installed");
        assert!(result.failure.is_some());
    }

    #[test]
    fn run_pnpm_maintenance_uninstalls_scoped_package_with_structured_args() {
        let result = run_pnpm_maintenance_with_runner(
            PnpmMaintenanceOperation::UninstallGlobalPackage {
                package_name: "@scope/tool".to_string(),
            },
            &|program, args, timeout| {
                assert_eq!(program, "pnpm");
                assert_eq!(
                    args,
                    &[
                        "remove".to_string(),
                        "--global".to_string(),
                        "@scope/tool".to_string()
                    ]
                );
                Ok(fake_run(
                    program,
                    &["remove", "--global", "@scope/tool"],
                    timeout,
                    "removed 1 package",
                ))
            },
        );

        assert_eq!(result.status, AsyncStatus::Ready);
        assert_eq!(result.command.preview, "pnpm remove --global @scope/tool");
    }

    #[test]
    fn run_pnpm_maintenance_reports_failed_uninstall() {
        let result = run_pnpm_maintenance_with_runner(
            PnpmMaintenanceOperation::UninstallGlobalPackage {
                package_name: "missing-tool".to_string(),
            },
            &|program, args, timeout| {
                assert_eq!(program, "pnpm");
                assert_eq!(
                    args,
                    &[
                        "remove".to_string(),
                        "--global".to_string(),
                        "missing-tool".to_string()
                    ]
                );
                Ok(fake_failed_run(
                    "pnpm",
                    &["remove", "--global", "missing-tool"],
                    timeout,
                    "not installed",
                ))
            },
        );

        assert_eq!(result.status, AsyncStatus::Failed);
        assert_eq!(result.stderr, "not installed");
        assert!(result.failure.is_some());
    }
}
