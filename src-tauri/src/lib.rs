use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandEnvelope {
    program: String,
    args: Vec<String>,
    preview: String,
    timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandRun {
    envelope: CommandEnvelope,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    duration_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandFailure {
    kind: FailureKind,
    message: String,
    command: Option<CommandEnvelope>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Clone, Serialize)]
enum FailureKind {
    MissingBinary,
    CommandFailed,
    ParseFailure,
    PermissionDenied,
    Timeout,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PackageRow {
    name: String,
    version: String,
    path: Option<String>,
    source: String,
    kind: PackageKind,
    signals: Vec<PackageSignal>,
    actions: Vec<CommandEnvelope>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum PackageKind {
    Generic,
    Formula,
    Cask,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum PackageSignal {
    Outdated,
    Leaf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathInfo {
    label: String,
    kind: PathKind,
    path: String,
    size: DiskUsage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum PathKind {
    Cache,
    Store,
    GlobalModules,
    GlobalDir,
    Prefix,
    Cellar,
    Caskroom,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskUsage {
    status: DiskUsageStatus,
    bytes: Option<u64>,
    human: Option<String>,
    files: u64,
    directories: u64,
    skipped: u64,
    message: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
enum DiskUsageStatus {
    Pending,
    Ready,
    Missing,
    PermissionDenied,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerSnapshot {
    id: ManagerId,
    label: String,
    status: ManagerStatus,
    version: Option<String>,
    packages: Vec<PackageRow>,
    paths: Vec<PathInfo>,
    commands: Vec<CommandEnvelope>,
    failures: Vec<CommandFailure>,
    unsupported_reason: Option<String>,
    homebrew: Option<HomebrewMaintenance>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HomebrewMaintenance {
    formula_count: usize,
    cask_count: usize,
    outdated_count: usize,
    leaf_count: usize,
    outdated: Vec<String>,
    leaves: Vec<String>,
    cleanup: HomebrewCleanupPreview,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HomebrewCleanupPreview {
    status: AsyncStatus,
    command: CommandEnvelope,
    raw_output: String,
    reclaimed_bytes: Option<u64>,
    reclaimed_human: Option<String>,
    message: Option<String>,
    failure: Option<CommandFailure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum AsyncStatus {
    Pending,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
enum ManagerId {
    Npm,
    Pnpm,
    Yarn,
    Homebrew,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
enum ManagerStatus {
    Ready,
    Missing,
    Unsupported,
    Partial,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerScanSnapshot {
    scan_duration_ms: u128,
    manager: ManagerSnapshot,
}

#[tauri::command]
async fn scan_manager(manager: ManagerId) -> Result<ManagerScanSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || scan_manager_snapshot(manager))
        .await
        .map_err(|err| format!("Package manager scan failed: {err}"))
}

#[tauri::command]
async fn measure_path_size(path: String) -> Result<DiskUsage, String> {
    tauri::async_runtime::spawn_blocking(move || disk_usage(Path::new(&path)))
        .await
        .map_err(|err| format!("Size scan failed: {err}"))
}

#[tauri::command]
async fn hydrate_homebrew_cleanup() -> Result<HomebrewCleanupPreview, String> {
    tauri::async_runtime::spawn_blocking(move || hydrate_homebrew_cleanup_with_runner(&run_command))
        .await
        .map_err(|err| format!("Homebrew cleanup dry-run failed: {err}"))
}

fn scan_manager_snapshot(manager: ManagerId) -> ManagerScanSnapshot {
    let started = Instant::now();
    let manager = scan_single_manager(manager);

    ManagerScanSnapshot {
        scan_duration_ms: started.elapsed().as_millis(),
        manager,
    }
}

fn scan_single_manager(manager: ManagerId) -> ManagerSnapshot {
    match manager {
        ManagerId::Npm => scan_npm(),
        ManagerId::Pnpm => scan_pnpm(),
        ManagerId::Yarn => scan_yarn(),
        ManagerId::Homebrew => scan_homebrew(),
    }
}

fn scan_npm() -> ManagerSnapshot {
    let mut snapshot = empty_snapshot(ManagerId::Npm, "npm");

    let version = match run_command("npm", &["--version"], Duration::from_secs(5)) {
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

    match run_command(
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

    if let Some(path) = command_stdout("npm", &["config", "get", "cache"], 5, &mut snapshot) {
        snapshot
            .paths
            .push(path_info("Cache", PathKind::Cache, path));
    }

    if let Some(path) = command_stdout("npm", &["root", "-g"], 5, &mut snapshot) {
        attach_missing_paths(&mut snapshot.packages, &path);
        snapshot
            .paths
            .push(path_info("Global modules", PathKind::GlobalModules, path));
    }

    finish(snapshot)
}

fn scan_pnpm() -> ManagerSnapshot {
    let mut snapshot = empty_snapshot(ManagerId::Pnpm, "pnpm");

    let version = match run_command("pnpm", &["--version"], Duration::from_secs(5)) {
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

    match run_command(
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

    if let Some(path) = command_stdout("pnpm", &["store", "path"], 5, &mut snapshot) {
        snapshot
            .paths
            .push(path_info("Store", PathKind::Store, path));
    }

    if let Some(path) = command_stdout("pnpm", &["root", "-g"], 5, &mut snapshot) {
        attach_missing_paths(&mut snapshot.packages, &path);
        snapshot
            .paths
            .push(path_info("Global modules", PathKind::GlobalModules, path));
    }

    finish(snapshot)
}

fn scan_yarn() -> ManagerSnapshot {
    let mut snapshot = empty_snapshot(ManagerId::Yarn, "Yarn");

    let version = match run_command("yarn", &["--version"], Duration::from_secs(5)) {
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
        Some(1) => scan_yarn_classic(&mut snapshot),
        Some(_) => scan_yarn_modern(&mut snapshot),
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

fn scan_yarn_classic(snapshot: &mut ManagerSnapshot) {
    push_command(snapshot, "yarn", &["global", "list", "--json"], 15);
    push_command(snapshot, "yarn", &["cache", "dir"], 5);
    push_command(snapshot, "yarn", &["global", "dir"], 5);

    match run_command(
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

    if let Some(path) = command_stdout("yarn", &["cache", "dir"], 5, snapshot) {
        snapshot
            .paths
            .push(path_info("Cache", PathKind::Cache, path));
    }

    if let Some(path) = command_stdout("yarn", &["global", "dir"], 5, snapshot) {
        snapshot
            .paths
            .push(path_info("Global dir", PathKind::GlobalDir, path));
    }
}

fn scan_yarn_modern(snapshot: &mut ManagerSnapshot) {
    snapshot.status = ManagerStatus::Unsupported;
    snapshot.unsupported_reason = Some(
        "Yarn 2+ does not expose a global package list equivalent to npm, pnpm, or Yarn Classic."
            .to_string(),
    );
    push_command(snapshot, "yarn", &["config", "get", "cacheFolder"], 5);

    if let Some(path) = command_stdout("yarn", &["config", "get", "cacheFolder"], 5, snapshot) {
        snapshot
            .paths
            .push(path_info("Cache folder", PathKind::Cache, path));
    }
}

fn scan_homebrew() -> ManagerSnapshot {
    scan_homebrew_with_runner(&run_command)
}

fn scan_homebrew_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Homebrew, "Homebrew");

    let version = match runner("brew", &["--version"], Duration::from_secs(5)) {
        Ok(run) if run.exit_code == Some(0) => Some(parse_homebrew_version(&run.stdout)),
        Ok(run) => {
            snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                "Homebrew version probe failed",
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

    let mut installed_failed = false;
    let mut formula_count = 0;
    let mut cask_count = 0;
    let mut packages = Vec::new();

    if let Some(run) = run_recorded_command(
        &mut snapshot,
        runner,
        "brew",
        &["list", "--formula", "--versions"],
        10,
        "Homebrew formula list failed",
    ) {
        let mut formulae = parse_homebrew_list_versions(
            &run.stdout,
            PackageKind::Formula,
            "brew list --formula --versions",
        );
        formula_count = formulae.len();
        packages.append(&mut formulae);
    } else {
        installed_failed = true;
    }

    if let Some(run) = run_recorded_command(
        &mut snapshot,
        runner,
        "brew",
        &["list", "--cask", "--versions"],
        10,
        "Homebrew cask list failed",
    ) {
        let mut casks = parse_homebrew_list_versions(
            &run.stdout,
            PackageKind::Cask,
            "brew list --cask --versions",
        );
        cask_count = casks.len();
        packages.append(&mut casks);
    } else {
        installed_failed = true;
    }

    packages.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then_with(|| kind_rank(a.kind).cmp(&kind_rank(b.kind)))
    });

    let outdated = run_recorded_command(
        &mut snapshot,
        runner,
        "brew",
        &["outdated", "--json=v2"],
        20,
        "Homebrew outdated scan failed",
    )
    .and_then(|run| match parse_homebrew_outdated(&run.stdout) {
        Ok(outdated) => Some(outdated),
        Err(message) => {
            snapshot.failures.push(parse_failure(message, run));
            None
        }
    })
    .unwrap_or_default();

    let leaves = run_recorded_command(
        &mut snapshot,
        runner,
        "brew",
        &["leaves"],
        10,
        "Homebrew leaves scan failed",
    )
    .map(|run| parse_homebrew_leaves(&run.stdout))
    .unwrap_or_default();

    let prefix = run_recorded_stdout(
        &mut snapshot,
        runner,
        "brew",
        &["--prefix"],
        5,
        "Homebrew prefix lookup failed",
    );
    let cache = run_recorded_stdout(
        &mut snapshot,
        runner,
        "brew",
        &["--cache"],
        5,
        "Homebrew cache lookup failed",
    );
    let cellar = run_recorded_stdout(
        &mut snapshot,
        runner,
        "brew",
        &["--cellar"],
        5,
        "Homebrew cellar lookup failed",
    );

    if let Some(path) = prefix.as_ref() {
        snapshot
            .paths
            .push(path_info("Prefix", PathKind::Prefix, path.clone()));
    }
    if let Some(path) = cache.as_ref() {
        snapshot
            .paths
            .push(path_info("Cache", PathKind::Cache, path.clone()));
    }
    if let Some(path) = cellar.as_ref() {
        snapshot
            .paths
            .push(path_info("Cellar", PathKind::Cellar, path.clone()));
    }

    let caskroom = prefix
        .as_ref()
        .map(|path| Path::new(path).join("Caskroom").display().to_string())
        .filter(|path| Path::new(path).exists());

    if let Some(path) = caskroom.as_ref() {
        snapshot
            .paths
            .push(path_info("Caskroom", PathKind::Caskroom, path.clone()));
    }

    attach_homebrew_paths(&mut packages, cellar.as_deref(), caskroom.as_deref());
    merge_homebrew_outdated(&mut packages, &outdated);
    merge_homebrew_leaves(&mut packages, &leaves);
    attach_homebrew_actions(&mut packages);

    let mut outdated_list = outdated.into_iter().collect::<Vec<_>>();
    outdated_list.sort();
    let mut leaf_list = leaves.into_iter().collect::<Vec<_>>();
    leaf_list.sort();

    snapshot.packages = packages;
    snapshot.homebrew = Some(HomebrewMaintenance {
        formula_count,
        cask_count,
        outdated_count: outdated_list.len(),
        leaf_count: leaf_list.len(),
        outdated: outdated_list,
        leaves: leaf_list,
        cleanup: pending_homebrew_cleanup_preview(),
    });

    if installed_failed && snapshot.packages.is_empty() {
        snapshot.status = ManagerStatus::Failed;
        return snapshot;
    }

    finish(snapshot)
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

fn split_package_version(raw: &str) -> (String, String) {
    if let Some(index) = raw.rfind('@') {
        if index > 0 && index + 1 < raw.len() {
            return (raw[..index].to_string(), raw[index + 1..].to_string());
        }
    }

    (raw.to_string(), "unknown".to_string())
}

fn package_row(
    name: String,
    version: String,
    path: Option<String>,
    source: &str,
    kind: PackageKind,
) -> PackageRow {
    PackageRow {
        name,
        version,
        path,
        source: source.to_string(),
        kind,
        signals: Vec::new(),
        actions: Vec::new(),
    }
}

fn parse_homebrew_version(stdout: &str) -> String {
    stdout
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .strip_prefix("Homebrew ")
        .unwrap_or_else(|| stdout.lines().next().unwrap_or("").trim())
        .to_string()
}

fn parse_homebrew_list_versions(stdout: &str, kind: PackageKind, source: &str) -> Vec<PackageRow> {
    stdout
        .lines()
        .filter_map(|line| parse_homebrew_list_versions_line(line, kind, source))
        .collect()
}

fn parse_homebrew_list_versions_line(
    line: &str,
    kind: PackageKind,
    source: &str,
) -> Option<PackageRow> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    let name = parts.next()?.to_string();
    let version = parts.collect::<Vec<_>>().join(" ");
    Some(package_row(
        name,
        if version.is_empty() {
            "unknown".to_string()
        } else {
            version
        },
        None,
        source,
        kind,
    ))
}

fn parse_homebrew_outdated(stdout: &str) -> Result<HashSet<String>, String> {
    let value: Value = serde_json::from_str(stdout).map_err(|err| err.to_string())?;
    let mut names = HashSet::new();

    if let Some(formulae) = value.get("formulae").and_then(Value::as_array) {
        for formula in formulae {
            if let Some(name) = homebrew_formula_name(formula) {
                names.insert(name);
            }
        }
    }

    if let Some(casks) = value.get("casks").and_then(Value::as_array) {
        for cask in casks {
            if let Some(name) = homebrew_cask_name(cask) {
                names.insert(name);
            }
        }
    }

    Ok(names)
}

fn parse_homebrew_leaves(stdout: &str) -> HashSet<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn homebrew_formula_name(value: &Value) -> Option<String> {
    json_string(value.get("full_name"))
        .or_else(|| json_string(value.get("name")))
        .filter(|name| !name.is_empty())
}

fn homebrew_cask_name(value: &Value) -> Option<String> {
    json_string(value.get("token"))
        .or_else(|| json_string(value.get("name")))
        .filter(|name| !name.is_empty())
}

fn attach_homebrew_paths(
    packages: &mut [PackageRow],
    cellar: Option<&str>,
    caskroom: Option<&str>,
) {
    for package in packages {
        if package.path.is_some() {
            continue;
        }

        match package.kind {
            PackageKind::Formula => {
                if let Some(cellar) = cellar {
                    package.path = Some(
                        Path::new(cellar)
                            .join(&package.name)
                            .join(&package.version)
                            .display()
                            .to_string(),
                    );
                }
            }
            PackageKind::Cask => {
                if let Some(caskroom) = caskroom {
                    package.path = Some(
                        Path::new(caskroom)
                            .join(&package.name)
                            .display()
                            .to_string(),
                    );
                }
            }
            PackageKind::Generic => {}
        }
    }
}

fn merge_homebrew_outdated(packages: &mut [PackageRow], outdated: &HashSet<String>) {
    for package in packages {
        if outdated.contains(&package.name) {
            push_signal(package, PackageSignal::Outdated);
        }
    }
}

fn merge_homebrew_leaves(packages: &mut [PackageRow], leaves: &HashSet<String>) {
    for package in packages {
        if package.kind == PackageKind::Formula && leaves.contains(&package.name) {
            push_signal(package, PackageSignal::Leaf);
        }
    }
}

fn attach_homebrew_actions(packages: &mut [PackageRow]) {
    for package in packages {
        match package.kind {
            PackageKind::Formula => {
                package.actions.push(envelope_owned(
                    "brew",
                    vec!["info".to_string(), package.name.clone()],
                    0,
                ));
                if package.signals.contains(&PackageSignal::Outdated) {
                    package.actions.push(envelope_owned(
                        "brew",
                        vec!["upgrade".to_string(), package.name.clone()],
                        0,
                    ));
                }
                if package.signals.contains(&PackageSignal::Leaf) {
                    package.actions.push(envelope_owned(
                        "brew",
                        vec![
                            "uses".to_string(),
                            "--installed".to_string(),
                            package.name.clone(),
                        ],
                        0,
                    ));
                }
            }
            PackageKind::Cask => {
                package.actions.push(envelope_owned(
                    "brew",
                    vec![
                        "info".to_string(),
                        "--cask".to_string(),
                        package.name.clone(),
                    ],
                    0,
                ));
                if package.signals.contains(&PackageSignal::Outdated) {
                    package.actions.push(envelope_owned(
                        "brew",
                        vec![
                            "upgrade".to_string(),
                            "--cask".to_string(),
                            package.name.clone(),
                        ],
                        0,
                    ));
                }
            }
            PackageKind::Generic => {}
        }
    }
}

fn push_signal(package: &mut PackageRow, signal: PackageSignal) {
    if !package.signals.contains(&signal) {
        package.signals.push(signal);
    }
}

fn kind_rank(kind: PackageKind) -> u8 {
    match kind {
        PackageKind::Generic => 0,
        PackageKind::Formula => 1,
        PackageKind::Cask => 2,
    }
}

fn json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
}

fn run_recorded_stdout<F>(
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
    .map(|run| trimmed(run.stdout))
}

fn run_recorded_command<F>(
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

fn command_stdout(
    program: &str,
    args: &[&str],
    timeout_secs: u64,
    snapshot: &mut ManagerSnapshot,
) -> Option<String> {
    match run_command(program, args, Duration::from_secs(timeout_secs)) {
        Ok(run) if run.exit_code == Some(0) => Some(trimmed(run.stdout)),
        Ok(run) => {
            snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                format!("{} failed", envelope_preview(program, args)).as_str(),
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

fn run_command(
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

fn command_failure(kind: FailureKind, message: &str, run: CommandRun) -> CommandFailure {
    CommandFailure {
        kind,
        message: message.to_string(),
        command: Some(run.envelope),
        stdout: run.stdout,
        stderr: run.stderr,
    }
}

fn parse_failure(message: String, run: CommandRun) -> CommandFailure {
    CommandFailure {
        kind: FailureKind::ParseFailure,
        message,
        command: Some(run.envelope),
        stdout: run.stdout,
        stderr: run.stderr,
    }
}

fn push_command(snapshot: &mut ManagerSnapshot, program: &str, args: &[&str], timeout_secs: u64) {
    snapshot
        .commands
        .push(envelope(program, args, timeout_secs * 1000));
}

fn envelope(program: &str, args: &[&str], timeout_ms: u64) -> CommandEnvelope {
    CommandEnvelope {
        program: program.to_string(),
        args: args.iter().map(|arg| arg.to_string()).collect(),
        preview: envelope_preview(program, args),
        timeout_ms,
    }
}

fn envelope_owned(program: &str, args: Vec<String>, timeout_ms: u64) -> CommandEnvelope {
    CommandEnvelope {
        program: program.to_string(),
        preview: envelope_preview_owned(program, &args),
        args,
        timeout_ms,
    }
}

fn envelope_preview(program: &str, args: &[&str]) -> String {
    std::iter::once(program)
        .chain(args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ")
}

fn envelope_preview_owned(program: &str, args: &[String]) -> String {
    std::iter::once(program.to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ")
}

fn pending_homebrew_cleanup_preview() -> HomebrewCleanupPreview {
    HomebrewCleanupPreview {
        status: AsyncStatus::Pending,
        command: homebrew_cleanup_command(),
        raw_output: String::new(),
        reclaimed_bytes: None,
        reclaimed_human: None,
        message: Some("Cleanup dry-run pending".to_string()),
        failure: None,
    }
}

fn hydrate_homebrew_cleanup_with_runner<F>(runner: &F) -> HomebrewCleanupPreview
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    match runner("brew", &["cleanup", "--dry-run"], Duration::from_secs(30)) {
        Ok(run) if run.exit_code == Some(0) => ready_homebrew_cleanup_preview(run.stdout),
        Ok(run) => failed_homebrew_cleanup_preview(command_failure(
            FailureKind::CommandFailed,
            "Homebrew cleanup dry-run failed",
            run,
        )),
        Err(failure) => failed_homebrew_cleanup_preview(failure),
    }
}

fn ready_homebrew_cleanup_preview(raw_output: String) -> HomebrewCleanupPreview {
    let reclaimed_bytes = extract_cleanup_reclaimed_bytes(&raw_output);
    HomebrewCleanupPreview {
        status: AsyncStatus::Ready,
        command: homebrew_cleanup_command(),
        raw_output,
        reclaimed_bytes,
        reclaimed_human: reclaimed_bytes.map(format_bytes),
        message: None,
        failure: None,
    }
}

fn failed_homebrew_cleanup_preview(failure: CommandFailure) -> HomebrewCleanupPreview {
    HomebrewCleanupPreview {
        status: AsyncStatus::Failed,
        command: homebrew_cleanup_command(),
        raw_output: failure.stdout.clone(),
        reclaimed_bytes: None,
        reclaimed_human: None,
        message: Some(failure.message.clone()),
        failure: Some(failure),
    }
}

fn homebrew_cleanup_command() -> CommandEnvelope {
    envelope("brew", &["cleanup", "--dry-run"], 30_000)
}

fn extract_cleanup_reclaimed_bytes(output: &str) -> Option<u64> {
    for line in output.lines().rev() {
        if line.to_lowercase().contains("free") {
            if let Some(bytes) = first_size_in_line(line) {
                return Some(bytes);
            }
        }
    }

    let mut total = 0_u64;
    for line in output.lines() {
        if line.to_lowercase().contains("would remove") {
            if let Some(bytes) = first_size_in_line(line) {
                total = total.saturating_add(bytes);
            }
        }
    }

    (total > 0).then_some(total)
}

fn first_size_in_line(line: &str) -> Option<u64> {
    let chars = line.chars().collect::<Vec<_>>();
    let mut index = 0;

    while index < chars.len() {
        if !chars[index].is_ascii_digit() {
            index += 1;
            continue;
        }

        let start = index;
        index += 1;
        while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == '.') {
            index += 1;
        }

        let number = chars[start..index].iter().collect::<String>();
        while index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }

        let unit_start = index;
        while index < chars.len() && chars[index].is_ascii_alphabetic() {
            index += 1;
        }
        let unit = chars[unit_start..index].iter().collect::<String>();

        if let Some(bytes) = parse_size(number.as_str(), unit.as_str()) {
            return Some(bytes);
        }
    }

    None
}

fn parse_size(number: &str, unit: &str) -> Option<u64> {
    let value = number.parse::<f64>().ok()?;
    let multiplier = match unit.to_ascii_lowercase().as_str() {
        "b" | "byte" | "bytes" => 1_f64,
        "k" | "kb" | "kib" => 1024_f64,
        "m" | "mb" | "mib" => 1024_f64.powi(2),
        "g" | "gb" | "gib" => 1024_f64.powi(3),
        "t" | "tb" | "tib" => 1024_f64.powi(4),
        _ => return None,
    };

    Some((value * multiplier).round() as u64)
}

fn path_info(label: &str, kind: PathKind, path: String) -> PathInfo {
    PathInfo {
        label: label.to_string(),
        kind,
        path,
        size: pending_disk_usage(),
    }
}

fn pending_disk_usage() -> DiskUsage {
    DiskUsage {
        status: DiskUsageStatus::Pending,
        bytes: None,
        human: None,
        files: 0,
        directories: 0,
        skipped: 0,
        message: Some("Size scan pending".to_string()),
    }
}

fn disk_usage(path: &Path) -> DiskUsage {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return DiskUsage {
                status: DiskUsageStatus::Missing,
                bytes: None,
                human: None,
                files: 0,
                directories: 0,
                skipped: 0,
                message: Some("Path does not exist".to_string()),
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            return DiskUsage {
                status: DiskUsageStatus::PermissionDenied,
                bytes: None,
                human: None,
                files: 0,
                directories: 0,
                skipped: 0,
                message: Some(err.to_string()),
            }
        }
        Err(err) => {
            return DiskUsage {
                status: DiskUsageStatus::Error,
                bytes: None,
                human: None,
                files: 0,
                directories: 0,
                skipped: 0,
                message: Some(err.to_string()),
            }
        }
    };

    let mut stats = UsageStats::default();
    let mut seen = HashSet::new();

    if metadata.is_file() {
        add_file(&mut stats, &mut seen, &metadata);
    } else if metadata.is_dir() {
        walk_dir(path, &mut stats, &mut seen);
    }

    DiskUsage {
        status: DiskUsageStatus::Ready,
        bytes: Some(stats.bytes),
        human: Some(format_bytes(stats.bytes)),
        files: stats.files,
        directories: stats.directories,
        skipped: stats.skipped,
        message: None,
    }
}

#[derive(Default)]
struct UsageStats {
    bytes: u64,
    files: u64,
    directories: u64,
    skipped: u64,
}

fn walk_dir(path: &Path, stats: &mut UsageStats, seen: &mut HashSet<(u64, u64)>) {
    stats.directories += 1;
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => {
            stats.skipped += 1;
            return;
        }
    };

    for entry in entries.flatten() {
        let entry_path: PathBuf = entry.path();
        let metadata = match fs::symlink_metadata(&entry_path) {
            Ok(metadata) => metadata,
            Err(_) => {
                stats.skipped += 1;
                continue;
            }
        };

        if metadata.file_type().is_symlink() {
            stats.skipped += 1;
            continue;
        }

        if metadata.is_dir() {
            walk_dir(&entry_path, stats, seen);
        } else if metadata.is_file() {
            add_file(stats, seen, &metadata);
        }
    }
}

#[cfg(unix)]
fn add_file(stats: &mut UsageStats, seen: &mut HashSet<(u64, u64)>, metadata: &fs::Metadata) {
    let key = (metadata.dev(), metadata.ino());
    if seen.insert(key) {
        stats.files += 1;
        stats.bytes += metadata.blocks().saturating_mul(512);
    } else {
        stats.skipped += 1;
    }
}

#[cfg(not(unix))]
fn add_file(stats: &mut UsageStats, _seen: &mut HashSet<(u64, u64)>, metadata: &fs::Metadata) {
    stats.files += 1;
    stats.bytes += metadata.len();
}

fn attach_missing_paths(packages: &mut [PackageRow], root: &str) {
    for package in packages {
        if package.path.is_none() {
            package.path = Some(Path::new(root).join(&package.name).display().to_string());
        }
    }
}

fn finish(mut snapshot: ManagerSnapshot) -> ManagerSnapshot {
    if matches!(snapshot.status, ManagerStatus::Unsupported) {
        return snapshot;
    }

    if snapshot.version.is_none()
        && snapshot
            .failures
            .iter()
            .any(|failure| matches!(failure.kind, FailureKind::MissingBinary))
    {
        snapshot.status = ManagerStatus::Missing;
    } else if !snapshot.packages.is_empty() || !snapshot.paths.is_empty() {
        if snapshot.failures.is_empty() {
            snapshot.status = ManagerStatus::Ready;
        } else {
            snapshot.status = ManagerStatus::Partial;
        }
    } else if snapshot.failures.is_empty() {
        snapshot.status = ManagerStatus::Ready;
    } else {
        snapshot.status = ManagerStatus::Failed;
    }

    snapshot
}

fn empty_snapshot(id: ManagerId, label: &str) -> ManagerSnapshot {
    ManagerSnapshot {
        id,
        label: label.to_string(),
        status: ManagerStatus::Failed,
        version: None,
        packages: Vec::new(),
        paths: Vec::new(),
        commands: Vec::new(),
        failures: Vec::new(),
        unsupported_reason: None,
        homebrew: None,
    }
}

fn trimmed(value: String) -> String {
    value.trim().to_string()
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;

    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }

    if unit == 0 {
        format!("{} {}", bytes, UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

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
    fn split_package_version_handles_scoped_packages() {
        let (name, version) = split_package_version("@scope/tool@2.0.0");

        assert_eq!(name, "@scope/tool");
        assert_eq!(version, "2.0.0");
    }

    #[test]
    fn parse_homebrew_list_versions_reads_names_and_versions() {
        let packages = parse_homebrew_list_versions(
            "node 24.1.0\npostgresql@16 16.8\nmulti-version 1.0 1.1\nnoversion\n",
            PackageKind::Formula,
            "brew list --formula --versions",
        );

        assert_eq!(packages.len(), 4);
        assert_eq!(packages[0].name, "node");
        assert_eq!(packages[0].version, "24.1.0");
        assert_eq!(packages[1].name, "postgresql@16");
        assert_eq!(packages[1].version, "16.8");
        assert_eq!(packages[2].name, "multi-version");
        assert_eq!(packages[2].version, "1.0 1.1");
        assert_eq!(packages[3].name, "noversion");
        assert_eq!(packages[3].version, "unknown");
    }

    #[test]
    fn scan_homebrew_merges_outdated_leaves_paths_and_actions() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "Homebrew 4.4.0\n")),
                ["list", "--formula", "--versions"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "node 24.1.0\nripgrep 14.1.1\n",
                )),
                ["list", "--cask", "--versions"] => {
                    Ok(fake_run(program, args, timeout, "docker 4.39.0\n"))
                }
                ["outdated", "--json=v2"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    r#"{
                        "formulae": [{"name": "node"}],
                        "casks": [{"token": "docker"}]
                    }"#,
                )),
                ["leaves"] => Ok(fake_run(program, args, timeout, "node\n")),
                ["--prefix"] => Ok(fake_run(program, args, timeout, "/opt/homebrew\n")),
                ["--cache"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "/Users/sunven/Library/Caches/Homebrew\n",
                )),
                ["--cellar"] => Ok(fake_run(program, args, timeout, "/opt/homebrew/Cellar\n")),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot = scan_homebrew_with_runner(&runner);

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.version.as_deref(), Some("4.4.0"));
        assert_eq!(snapshot.packages.len(), 3);
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::Cache));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::Cellar));

        let node = snapshot
            .packages
            .iter()
            .find(|package| package.name == "node")
            .expect("node row");
        assert!(node.signals.contains(&PackageSignal::Outdated));
        assert!(node.signals.contains(&PackageSignal::Leaf));
        assert!(node
            .actions
            .iter()
            .any(|action| action.preview == "brew upgrade node"));
        assert!(node
            .actions
            .iter()
            .any(|action| action.preview == "brew uses --installed node"));

        let docker = snapshot
            .packages
            .iter()
            .find(|package| package.name == "docker")
            .expect("docker row");
        assert_eq!(docker.kind, PackageKind::Cask);
        assert!(docker.signals.contains(&PackageSignal::Outdated));
        assert!(!docker.signals.contains(&PackageSignal::Leaf));
        assert!(docker
            .actions
            .iter()
            .any(|action| action.preview == "brew upgrade --cask docker"));

        let maintenance = snapshot.homebrew.expect("homebrew maintenance");
        assert_eq!(maintenance.formula_count, 2);
        assert_eq!(maintenance.cask_count, 1);
        assert_eq!(maintenance.outdated_count, 2);
        assert_eq!(maintenance.leaf_count, 1);
        assert_eq!(maintenance.cleanup.status, AsyncStatus::Pending);
    }

    #[test]
    fn scan_homebrew_reports_partial_when_optional_command_fails() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "Homebrew 4.4.0\n")),
                ["list", "--formula", "--versions"] => {
                    Ok(fake_run(program, args, timeout, "node 24.1.0\n"))
                }
                ["list", "--cask", "--versions"] => Ok(fake_run(program, args, timeout, "")),
                ["outdated", "--json=v2"] => {
                    Ok(fake_failed_run(program, args, timeout, "outdated failed"))
                }
                ["leaves"] => Ok(fake_run(program, args, timeout, "")),
                ["--prefix"] => Ok(fake_run(program, args, timeout, "/opt/homebrew\n")),
                ["--cache"] => Ok(fake_run(program, args, timeout, "/tmp/homebrew-cache\n")),
                ["--cellar"] => Ok(fake_run(program, args, timeout, "/opt/homebrew/Cellar\n")),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot = scan_homebrew_with_runner(&runner);

        assert_eq!(snapshot.status, ManagerStatus::Partial);
        assert_eq!(snapshot.packages.len(), 1);
        assert_eq!(snapshot.failures.len(), 1);
        assert!(matches!(
            snapshot.failures[0].kind,
            FailureKind::CommandFailed
        ));
    }

    #[test]
    fn scan_homebrew_reports_missing_when_brew_cannot_spawn() {
        let runner = |program: &str,
                      args: &[&str],
                      _timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "brew");
            assert_eq!(args, ["--version"]);
            Err(CommandFailure {
                kind: FailureKind::MissingBinary,
                message: "brew is not installed or is not on PATH".to_string(),
                command: Some(envelope("brew", &["--version"], 5_000)),
                stdout: String::new(),
                stderr: "not found".to_string(),
            })
        };

        let snapshot = scan_homebrew_with_runner(&runner);

        assert_eq!(snapshot.status, ManagerStatus::Missing);
        assert!(snapshot.packages.is_empty());
        assert!(snapshot.homebrew.is_none());
    }

    #[test]
    fn hydrate_homebrew_cleanup_preserves_raw_output_and_size() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "brew");
            assert_eq!(args, ["cleanup", "--dry-run"]);
            Ok(fake_run(
                program,
                args,
                timeout,
                "Would remove: /tmp/a (10MB)\nWould remove: /tmp/b (1.5MB)\n",
            ))
        };

        let preview = hydrate_homebrew_cleanup_with_runner(&runner);

        assert_eq!(preview.status, AsyncStatus::Ready);
        assert!(preview.raw_output.contains("/tmp/a"));
        assert_eq!(preview.reclaimed_bytes, Some(12_058_624));
        assert_eq!(preview.command.preview, "brew cleanup --dry-run");
    }

    #[test]
    fn hydrate_homebrew_cleanup_failure_returns_failed_preview() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            Ok(fake_failed_run(program, args, timeout, "cleanup failed"))
        };

        let preview = hydrate_homebrew_cleanup_with_runner(&runner);

        assert_eq!(preview.status, AsyncStatus::Failed);
        assert!(preview.failure.is_some());
        assert_eq!(preview.raw_output, "");
    }

    #[test]
    fn path_info_defers_size_scan() {
        let info = path_info("Store", PathKind::Store, "/tmp/package-store".to_string());

        assert_eq!(info.size.status, DiskUsageStatus::Pending);
        assert_eq!(info.size.bytes, None);
        assert_eq!(info.size.files, 0);
        assert_eq!(info.size.directories, 0);
    }

    #[cfg(unix)]
    #[test]
    fn disk_usage_dedupes_hardlinks() {
        let root = temp_dir("disk-usage");
        let _guard = TempDirGuard(root.clone());
        let file_a = root.join("alpha.txt");
        let file_b = root.join("beta.txt");
        write_file(&file_a, b"package manager");
        fs::hard_link(&file_a, &file_b).expect("create hard link");

        let usage = disk_usage(&root);
        let metadata = fs::metadata(&file_a).expect("metadata");

        assert_eq!(usage.status, DiskUsageStatus::Ready);
        assert_eq!(usage.files, 1);
        assert_eq!(usage.skipped, 1);
        assert_eq!(usage.bytes, Some(metadata.blocks().saturating_mul(512)));
    }

    fn temp_dir(label: &str) -> PathBuf {
        let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "package-manager-control-center-{label}-{stamp}-{suffix}"
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn write_file(path: &Path, contents: &[u8]) {
        let mut file = fs::File::create(path).expect("create file");
        file.write_all(contents).expect("write file");
    }

    fn fake_run(program: &str, args: &[&str], timeout: Duration, stdout: &str) -> CommandRun {
        CommandRun {
            envelope: envelope(program, args, timeout.as_millis() as u64),
            stdout: stdout.to_string(),
            stderr: String::new(),
            exit_code: Some(0),
            duration_ms: 1,
        }
    }

    fn fake_failed_run(
        program: &str,
        args: &[&str],
        timeout: Duration,
        stderr: &str,
    ) -> CommandRun {
        CommandRun {
            envelope: envelope(program, args, timeout.as_millis() as u64),
            stdout: String::new(),
            stderr: stderr.to_string(),
            exit_code: Some(1),
            duration_ms: 1,
        }
    }

    struct TempDirGuard(PathBuf);

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_manager,
            measure_path_size,
            hydrate_homebrew_cleanup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
