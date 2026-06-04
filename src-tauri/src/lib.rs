use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::env;
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
    MissingPath,
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
    MavenArtifact,
    PythonDistribution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum PackageSignal {
    Outdated,
    Leaf,
    DuplicateVersions,
    Snapshot,
    Editable,
    UserSite,
    DirectUrl,
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
    NpxCache,
    Store,
    GlobalModules,
    GlobalDir,
    NvmDir,
    NvmNodeVersions,
    CargoBin,
    CargoRegistryCache,
    CargoRegistrySource,
    CargoGitCache,
    CargoGitCheckouts,
    Prefix,
    Cellar,
    Caskroom,
    LocalRepository,
    SitePackages,
    UserSite,
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
    maven: Option<MavenRepositoryHealth>,
    pip: Option<PipEnvironmentHealth>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MavenRepositoryHealth {
    local_repository: String,
    artifact_count: usize,
    version_count: usize,
    snapshot_count: usize,
    duplicate_artifact_count: usize,
    top_duplicate_artifacts: Vec<MavenDuplicateArtifact>,
    repository_scan_status: RepositoryScanStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MavenDuplicateArtifact {
    coordinate: String,
    version_count: usize,
    versions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryScanStatus {
    partial: bool,
    scanned_version_dirs: usize,
    skipped: usize,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PipEnvironmentHealth {
    python_version: String,
    python_executable: String,
    pip_version: String,
    environment_kind: PipEnvironmentKind,
    site_packages: Option<String>,
    user_site: Option<String>,
    installed_count: usize,
    outdated_count: usize,
    editable_count: usize,
    direct_url_count: usize,
    cache: PipCacheInfo,
    inspect_status: AsyncStatus,
    outdated_status: AsyncStatus,
    outdated_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum PipEnvironmentKind {
    System,
    User,
    VirtualEnv,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PipCacheInfo {
    dir: Option<String>,
    raw_info: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PipOutdatedPreview {
    status: AsyncStatus,
    command: CommandEnvelope,
    outdated: Vec<String>,
    message: Option<String>,
    failure: Option<CommandFailure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum AsyncStatus {
    Pending,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
enum ManagerId {
    Npm,
    Pnpm,
    Yarn,
    Nvm,
    Homebrew,
    Maven,
    Pip,
    Cargo,
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

#[tauri::command]
async fn hydrate_pip_outdated(python_executable: String) -> Result<PipOutdatedPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        hydrate_pip_outdated_with_runner(&python_executable, &run_command_owned)
    })
    .await
    .map_err(|err| format!("pip outdated hydration failed: {err}"))
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
        ManagerId::Nvm => scan_nvm(),
        ManagerId::Homebrew => scan_homebrew(),
        ManagerId::Maven => scan_maven(),
        ManagerId::Pip => scan_pip(),
        ManagerId::Cargo => scan_cargo(),
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
        let npx_path = npx_cache_path(&path);
        snapshot
            .paths
            .push(path_info("Cache", PathKind::Cache, path));
        snapshot
            .paths
            .push(path_info("npx cache", PathKind::NpxCache, npx_path));
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

fn scan_nvm() -> ManagerSnapshot {
    scan_nvm_with_dir(resolve_nvm_dir_from_env())
}

fn scan_nvm_with_dir(nvm_dir: PathBuf) -> ManagerSnapshot {
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

    snapshot.packages = scan_nvm_node_versions(&node_versions_dir);
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

fn scan_nvm_node_versions(node_versions_dir: &Path) -> Vec<PackageRow> {
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
            attach_nvm_actions(&mut row, &version);
            Some(row)
        })
        .collect::<Vec<_>>();

    packages.sort_by(|a, b| compare_semver_desc(&a.version, &b.version));
    packages
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

fn scan_homebrew() -> ManagerSnapshot {
    scan_homebrew_with_runner(&run_command)
}

fn scan_maven() -> ManagerSnapshot {
    scan_maven_with_runner(&run_command)
}

fn scan_maven_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Maven, "Maven");

    let version_run = match runner("mvn", &["--version"], Duration::from_secs(5)) {
        Ok(run) if run.exit_code == Some(0) => run,
        Ok(run) => {
            snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                "Maven version probe failed",
                run,
            ));
            return finish(snapshot);
        }
        Err(failure) => {
            snapshot.failures.push(failure);
            return finish(snapshot);
        }
    };

    push_command(&mut snapshot, "mvn", &["--version"], 5);
    snapshot.version = Some(parse_maven_version(&version_run.stdout));

    let maven_home = parse_maven_home(&version_run.stdout);
    let resolution = resolve_maven_local_repository(maven_home.as_deref());
    if let Some(message) = resolution.message.as_ref() {
        snapshot.failures.push(CommandFailure {
            kind: FailureKind::ParseFailure,
            message: message.clone(),
            command: None,
            stdout: String::new(),
            stderr: String::new(),
        });
    }

    snapshot.paths.push(path_info(
        "Local repository",
        PathKind::LocalRepository,
        resolution.path.display().to_string(),
    ));
    snapshot.commands.push(envelope(
        "mvn",
        &["dependency:purge-local-repository", "-DreResolve=false"],
        0,
    ));
    snapshot.commands.push(envelope(
        "mvn",
        &[
            "dependency:purge-local-repository",
            "-DactTransitively=false",
            "-DreResolve=false",
        ],
        0,
    ));

    let scan = scan_maven_repository(&resolution.path, MavenScanLimits::default());
    snapshot.packages = scan.packages;
    snapshot.maven = Some(scan.health);

    finish(snapshot)
}

fn scan_pip() -> ManagerSnapshot {
    scan_pip_with_runner(&run_command_owned)
}

fn scan_cargo() -> ManagerSnapshot {
    scan_cargo_with_runner(&run_command)
}

fn scan_cargo_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    scan_cargo_with_runner_and_home(runner, resolve_cargo_home_from_env())
}

fn scan_cargo_with_runner_and_home<F>(runner: &F, cargo_home: PathBuf) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Cargo, "Cargo");
    let cargo_bin = cargo_home.join("bin");

    snapshot.paths.push(path_info(
        "Cargo bin",
        PathKind::CargoBin,
        cargo_bin.display().to_string(),
    ));
    snapshot.paths.push(path_info(
        "Cargo registry cache",
        PathKind::CargoRegistryCache,
        cargo_home.join("registry/cache").display().to_string(),
    ));
    snapshot.paths.push(path_info(
        "Cargo registry source",
        PathKind::CargoRegistrySource,
        cargo_home.join("registry/src").display().to_string(),
    ));
    snapshot.paths.push(path_info(
        "Cargo git cache",
        PathKind::CargoGitCache,
        cargo_home.join("git/db").display().to_string(),
    ));
    snapshot.paths.push(path_info(
        "Cargo git checkouts",
        PathKind::CargoGitCheckouts,
        cargo_home.join("git/checkouts").display().to_string(),
    ));

    let version_run = match run_recorded_command(
        &mut snapshot,
        runner,
        "cargo",
        &["--version"],
        5,
        "Cargo version probe failed",
    ) {
        Some(run) => run,
        None => return finish(snapshot),
    };
    snapshot.version = Some(parse_cargo_version(&version_run.stdout));

    let Some(list_run) = run_recorded_command(
        &mut snapshot,
        runner,
        "cargo",
        &["install", "--list"],
        15,
        "Cargo installed binary crate list failed",
    ) else {
        return finish(snapshot);
    };

    match parse_cargo_install_list(&list_run.stdout, &cargo_bin) {
        Ok(packages) => snapshot.packages = packages,
        Err(message) => snapshot.failures.push(parse_failure(message, list_run)),
    }

    finish(snapshot)
}

fn scan_pip_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Pip, "pip");

    let Some(python) = detect_python(runner, &mut snapshot) else {
        return finish(snapshot);
    };

    let python_version = command_stdout_owned(
        python.as_str(),
        vec!["--version".to_string()],
        5,
        &mut snapshot,
        runner,
        "Python version probe failed",
    )
    .unwrap_or_else(|| "unknown".to_string());

    let python_executable = command_stdout_owned(
        python.as_str(),
        vec![
            "-c".to_string(),
            "import sys; print(sys.executable)".to_string(),
        ],
        5,
        &mut snapshot,
        runner,
        "Python executable probe failed",
    )
    .unwrap_or_else(|| python.clone());

    let pip_version = match command_stdout_owned(
        python_executable.as_str(),
        vec!["-m".to_string(), "pip".to_string(), "--version".to_string()],
        5,
        &mut snapshot,
        runner,
        "pip version probe failed",
    ) {
        Some(version) => version,
        None => return finish(snapshot),
    };

    snapshot.version = Some(pip_version.clone());
    snapshot.commands.push(envelope_owned(
        python_executable.as_str(),
        vec![
            "-m".to_string(),
            "pip".to_string(),
            "list".to_string(),
            "--format=json".to_string(),
        ],
        15_000,
    ));
    snapshot.commands.push(envelope_owned(
        python_executable.as_str(),
        vec![
            "-m".to_string(),
            "pip".to_string(),
            "cache".to_string(),
            "dir".to_string(),
        ],
        5_000,
    ));
    snapshot.commands.push(envelope_owned(
        python_executable.as_str(),
        vec![
            "-m".to_string(),
            "pip".to_string(),
            "cache".to_string(),
            "info".to_string(),
        ],
        5_000,
    ));
    snapshot.commands.push(envelope_owned(
        python_executable.as_str(),
        vec![
            "-m".to_string(),
            "pip".to_string(),
            "inspect".to_string(),
            "--local".to_string(),
        ],
        15_000,
    ));

    match runner(
        python_executable.as_str(),
        &[
            "-m".to_string(),
            "pip".to_string(),
            "list".to_string(),
            "--format=json".to_string(),
        ],
        Duration::from_secs(15),
    ) {
        Ok(run) if run.exit_code == Some(0) => {
            match parse_pip_list(&run.stdout, &python_executable) {
                Ok(packages) => snapshot.packages = packages,
                Err(message) => snapshot.failures.push(parse_failure(message, run)),
            }
        }
        Ok(run) => snapshot.failures.push(command_failure(
            FailureKind::CommandFailed,
            "pip package list failed",
            run,
        )),
        Err(failure) => snapshot.failures.push(failure),
    }

    let cache_dir = command_stdout_owned(
        python_executable.as_str(),
        vec![
            "-m".to_string(),
            "pip".to_string(),
            "cache".to_string(),
            "dir".to_string(),
        ],
        5,
        &mut snapshot,
        runner,
        "pip cache dir failed",
    );
    let cache_info = command_stdout_owned(
        python_executable.as_str(),
        vec![
            "-m".to_string(),
            "pip".to_string(),
            "cache".to_string(),
            "info".to_string(),
        ],
        5,
        &mut snapshot,
        runner,
        "pip cache info failed",
    )
    .unwrap_or_default();

    if let Some(path) = cache_dir.as_ref() {
        snapshot
            .paths
            .push(path_info("pip cache", PathKind::Cache, path.clone()));
    }

    let mut inspect_status = AsyncStatus::Ready;
    let mut site_packages = None;
    let mut user_site = None;
    match runner(
        python_executable.as_str(),
        &[
            "-m".to_string(),
            "pip".to_string(),
            "inspect".to_string(),
            "--local".to_string(),
        ],
        Duration::from_secs(15),
    ) {
        Ok(run) if run.exit_code == Some(0) => {
            match enrich_pip_from_inspect(&mut snapshot.packages, &run.stdout) {
                Ok(enrichment) => {
                    site_packages = enrichment.site_packages;
                    user_site = enrichment.user_site;
                }
                Err(message) => {
                    inspect_status = AsyncStatus::Failed;
                    snapshot.failures.push(parse_failure(message, run));
                }
            }
        }
        Ok(run) => {
            inspect_status = AsyncStatus::Failed;
            snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                "pip inspect failed",
                run,
            ));
        }
        Err(failure) => {
            inspect_status = AsyncStatus::Failed;
            snapshot.failures.push(failure);
        }
    }

    if let Some(path) = site_packages.as_ref() {
        snapshot.paths.push(path_info(
            "site-packages",
            PathKind::SitePackages,
            path.clone(),
        ));
    }
    if let Some(path) = user_site.as_ref() {
        snapshot
            .paths
            .push(path_info("User site", PathKind::UserSite, path.clone()));
    }

    attach_pip_actions(&mut snapshot.packages, &python_executable);
    let editable_count = snapshot
        .packages
        .iter()
        .filter(|pkg| pkg.signals.contains(&PackageSignal::Editable))
        .count();
    let direct_url_count = snapshot
        .packages
        .iter()
        .filter(|pkg| pkg.signals.contains(&PackageSignal::DirectUrl))
        .count();

    snapshot.pip = Some(PipEnvironmentHealth {
        python_version,
        python_executable: python_executable.clone(),
        pip_version,
        environment_kind: detect_pip_environment(&python_executable, site_packages.as_deref()),
        site_packages,
        user_site,
        installed_count: snapshot.packages.len(),
        outdated_count: 0,
        editable_count,
        direct_url_count,
        cache: PipCacheInfo {
            dir: cache_dir,
            raw_info: cache_info,
        },
        inspect_status,
        outdated_status: AsyncStatus::Pending,
        outdated_message: Some("Outdated scan pending".to_string()),
    });

    finish(snapshot)
}

fn parse_cargo_version(stdout: &str) -> String {
    let line = stdout.lines().next().unwrap_or("").trim();
    line.strip_prefix("cargo ")
        .and_then(|value| value.split_whitespace().next())
        .filter(|value| !value.is_empty())
        .unwrap_or(line)
        .to_string()
}

fn resolve_cargo_home_from_env() -> PathBuf {
    let cargo_home = env::var("CARGO_HOME").ok();
    resolve_cargo_home(cargo_home.as_deref(), home_dir().as_deref())
}

fn resolve_cargo_home(cargo_home: Option<&str>, home: Option<&Path>) -> PathBuf {
    if let Some(value) = cargo_home.map(str::trim).filter(|value| !value.is_empty()) {
        return expand_tilde(value, home);
    }

    home.map(|home| home.join(".cargo"))
        .unwrap_or_else(|| PathBuf::from(".cargo"))
}

#[derive(Debug)]
struct CargoInstallEntry {
    name: String,
    version: String,
    binaries: Vec<String>,
}

fn parse_cargo_install_list(stdout: &str, bin_dir: &Path) -> Result<Vec<PackageRow>, String> {
    let mut entries: Vec<CargoInstallEntry> = Vec::new();
    let mut current_index: Option<usize> = None;
    let mut saw_content = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        saw_content = true;

        if line.chars().next().is_some_and(char::is_whitespace) {
            if let Some(index) = current_index {
                if let Some(binary) = trimmed.split_whitespace().next() {
                    entries[index].binaries.push(binary.to_string());
                }
            }
            continue;
        }

        let Some(entry) = parse_cargo_install_header(trimmed) else {
            return Err(format!(
                "Could not parse cargo install list line: {trimmed}"
            ));
        };
        entries.push(entry);
        current_index = Some(entries.len() - 1);
    }

    if saw_content && entries.is_empty() {
        return Err("cargo install list output did not contain package headers".to_string());
    }

    let mut packages = entries
        .into_iter()
        .map(|entry| {
            let path = entry
                .binaries
                .first()
                .map(|binary| bin_dir.join(binary).display().to_string());
            let mut row = package_row(
                entry.name,
                entry.version,
                path,
                "cargo install --list",
                PackageKind::Generic,
            );
            attach_cargo_actions(&mut row);
            row
        })
        .collect::<Vec<_>>();
    packages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packages)
}

fn parse_cargo_install_header(line: &str) -> Option<CargoInstallEntry> {
    let header = line.strip_suffix(':')?.trim();
    let (name, version) = header.rsplit_once(' ')?;
    let name = name.trim();
    let version = version.trim().strip_prefix('v')?;

    if name.is_empty()
        || version.is_empty()
        || !version.chars().next().is_some_and(|ch| ch.is_ascii_digit())
    {
        return None;
    }

    Some(CargoInstallEntry {
        name: name.to_string(),
        version: version.to_string(),
        binaries: Vec::new(),
    })
}

fn attach_cargo_actions(row: &mut PackageRow) {
    row.actions.push(envelope_owned(
        "cargo",
        vec!["install".to_string(), row.name.clone()],
        0,
    ));
    row.actions.push(envelope_owned(
        "cargo",
        vec!["uninstall".to_string(), row.name.clone()],
        0,
    ));
}

#[derive(Debug)]
struct MavenLocalRepositoryResolution {
    path: PathBuf,
    message: Option<String>,
}

#[derive(Clone, Copy)]
struct MavenScanLimits {
    max_scan_ms: u128,
    max_version_dirs: usize,
    max_rows_returned: usize,
}

impl Default for MavenScanLimits {
    fn default() -> Self {
        Self {
            max_scan_ms: 5_000,
            max_version_dirs: 100_000,
            max_rows_returned: 2_000,
        }
    }
}

struct MavenRepositoryScan {
    packages: Vec<PackageRow>,
    health: MavenRepositoryHealth,
}

#[derive(Default)]
struct MavenArtifactAccumulator {
    versions: BTreeSet<String>,
    path: Option<String>,
    file_count: usize,
    snapshot_count: usize,
}

fn parse_maven_version(stdout: &str) -> String {
    stdout
        .lines()
        .find(|line| line.trim_start().starts_with("Apache Maven"))
        .map(str::trim)
        .unwrap_or_else(|| stdout.lines().next().unwrap_or("unknown").trim())
        .to_string()
}

fn parse_maven_home(stdout: &str) -> Option<String> {
    stdout.lines().find_map(|line| {
        line.trim()
            .strip_prefix("Maven home:")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn resolve_maven_local_repository(maven_home: Option<&str>) -> MavenLocalRepositoryResolution {
    let home = home_dir();
    let user_settings = home.as_ref().map(|home| home.join(".m2/settings.xml"));
    let global_settings = maven_home.map(|home| Path::new(home).join("conf/settings.xml"));
    let fallback = home
        .as_ref()
        .map(|home| home.join(".m2/repository"))
        .unwrap_or_else(|| PathBuf::from(".m2/repository"));

    let mut messages = Vec::new();
    if let Some(path) = user_settings.as_ref() {
        match read_maven_local_repository_setting(path) {
            Ok(Some(value)) => {
                return MavenLocalRepositoryResolution {
                    path: interpolate_maven_path(value.as_str(), home.as_deref()),
                    message: None,
                }
            }
            Ok(None) => {}
            Err(message) => messages.push(message),
        }
    }

    if let Some(path) = global_settings.as_ref() {
        match read_maven_local_repository_setting(path) {
            Ok(Some(value)) => {
                return MavenLocalRepositoryResolution {
                    path: interpolate_maven_path(value.as_str(), home.as_deref()),
                    message: None,
                }
            }
            Ok(None) => {}
            Err(message) => messages.push(message),
        }
    }

    MavenLocalRepositoryResolution {
        path: fallback,
        message: (!messages.is_empty()).then(|| messages.join("; ")),
    }
}

fn read_maven_local_repository_setting(path: &Path) -> Result<Option<String>, String> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("Could not read {}: {err}", path.display())),
    };
    parse_maven_local_repository_setting(&contents)
        .map_err(|err| format!("Could not parse {}: {err}", path.display()))
}

fn parse_maven_local_repository_setting(contents: &str) -> Result<Option<String>, String> {
    let document = roxmltree::Document::parse(contents).map_err(|err| err.to_string())?;
    let root = document.root_element();
    if root.tag_name().name() != "settings" {
        return Ok(None);
    }

    Ok(root
        .children()
        .find(|node| node.is_element() && node.tag_name().name() == "localRepository")
        .and_then(|node| node.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

fn interpolate_maven_path(value: &str, home: Option<&Path>) -> PathBuf {
    let home_string = home
        .map(|home| home.display().to_string())
        .unwrap_or_else(|| env::var("HOME").unwrap_or_default());
    let interpolated = value
        .replace("${user.home}", home_string.as_str())
        .replace("${env.HOME}", home_string.as_str());
    expand_tilde(interpolated.as_str(), home)
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn expand_tilde(value: &str, home: Option<&Path>) -> PathBuf {
    if value == "~" {
        if let Some(home) = home {
            return home.to_path_buf();
        }
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = home {
            return home.join(rest);
        }
    }
    PathBuf::from(value)
}

fn scan_maven_repository(root: &Path, limits: MavenScanLimits) -> MavenRepositoryScan {
    let started = Instant::now();
    let mut stack = vec![root.to_path_buf()];
    let mut accumulators: BTreeMap<(String, String), MavenArtifactAccumulator> = BTreeMap::new();
    let mut scanned_version_dirs = 0_usize;
    let mut skipped = 0_usize;
    let mut partial_message = None;

    while let Some(path) = stack.pop() {
        if started.elapsed().as_millis() >= limits.max_scan_ms {
            partial_message = Some("Repository scan reached time limit".to_string());
            break;
        }
        if scanned_version_dirs >= limits.max_version_dirs {
            partial_message = Some("Repository scan reached version directory limit".to_string());
            break;
        }

        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            skipped += 1;
            continue;
        }
        if !metadata.is_dir() {
            continue;
        }

        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries.flatten().collect::<Vec<_>>(),
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        if let Some((group_id, artifact_id, version, file_count)) =
            maven_coordinate_from_version_dir(root, &path, &entries)
        {
            scanned_version_dirs += 1;
            let key = (group_id, artifact_id);
            let accumulator = accumulators.entry(key).or_default();
            accumulator.versions.insert(version.clone());
            accumulator.file_count += file_count;
            if version.to_ascii_uppercase().contains("SNAPSHOT") {
                accumulator.snapshot_count += 1;
            }
            accumulator.path = Some(path.display().to_string());
            continue;
        }

        for entry in entries {
            stack.push(entry.path());
        }
    }

    let mut rows = Vec::new();
    let mut snapshot_count = 0_usize;
    let mut duplicate_artifact_count = 0_usize;
    let mut version_count = 0_usize;
    let mut duplicates = Vec::new();

    for ((group_id, artifact_id), accumulator) in accumulators.iter() {
        let versions = accumulator.versions.iter().cloned().collect::<Vec<_>>();
        version_count += versions.len();
        snapshot_count += accumulator.snapshot_count;

        let mut row = package_row(
            format!("{group_id}:{artifact_id}"),
            maven_version_summary(&versions),
            accumulator.path.clone(),
            "maven local repository scan",
            PackageKind::MavenArtifact,
        );
        if versions.len() > 1 {
            duplicate_artifact_count += 1;
            push_signal(&mut row, PackageSignal::DuplicateVersions);
            duplicates.push(MavenDuplicateArtifact {
                coordinate: row.name.clone(),
                version_count: versions.len(),
                versions: versions.clone(),
            });
        }
        if accumulator.snapshot_count > 0 {
            push_signal(&mut row, PackageSignal::Snapshot);
        }
        attach_maven_actions(&mut row, group_id, artifact_id);
        rows.push(row);
    }

    rows.sort_by(|a, b| a.name.cmp(&b.name));
    if rows.len() > limits.max_rows_returned {
        rows.truncate(limits.max_rows_returned);
        partial_message = Some("Repository scan reached row limit".to_string());
    }

    duplicates.sort_by(|a, b| {
        b.version_count
            .cmp(&a.version_count)
            .then_with(|| a.coordinate.cmp(&b.coordinate))
    });
    duplicates.truncate(10);

    MavenRepositoryScan {
        health: MavenRepositoryHealth {
            local_repository: root.display().to_string(),
            artifact_count: accumulators.len(),
            version_count,
            snapshot_count,
            duplicate_artifact_count,
            top_duplicate_artifacts: duplicates,
            repository_scan_status: RepositoryScanStatus {
                partial: partial_message.is_some(),
                scanned_version_dirs,
                skipped,
                message: partial_message,
            },
        },
        packages: rows,
    }
}

fn maven_coordinate_from_version_dir(
    root: &Path,
    path: &Path,
    entries: &[fs::DirEntry],
) -> Option<(String, String, String, usize)> {
    let relative = path.strip_prefix(root).ok()?;
    let parts = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }

    let file_count = entries
        .iter()
        .filter(|entry| {
            entry
                .file_type()
                .map(|file_type| file_type.is_file())
                .unwrap_or(false)
        })
        .count();
    let has_marker = entries.iter().any(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        matches!(
            Path::new(&name).extension().and_then(|ext| ext.to_str()),
            Some("pom" | "jar" | "aar" | "module")
        ) || name.ends_with(".lastUpdated")
    });
    if !has_marker {
        return None;
    }

    let version = parts.last()?.clone();
    let artifact_id = parts.get(parts.len() - 2)?.clone();
    let group_id = parts[..parts.len() - 2].join(".");
    Some((group_id, artifact_id, version, file_count))
}

fn attach_maven_actions(row: &mut PackageRow, group_id: &str, artifact_id: &str) {
    let coordinate = format!("{group_id}:{artifact_id}");
    if row.version != "unknown" && !row.version.starts_with("multiple ") {
        row.actions.push(envelope_owned(
            "mvn",
            vec![
                "dependency:get".to_string(),
                format!("-Dartifact={coordinate}:{}", row.version),
            ],
            0,
        ));
    }
    row.actions.push(envelope_owned(
        "mvn",
        vec![
            "dependency:tree".to_string(),
            format!("-Dincludes={coordinate}"),
        ],
        0,
    ));
}

fn maven_version_summary(versions: &[String]) -> String {
    match versions {
        [] => "unknown".to_string(),
        [version] => version.clone(),
        _ => format!("multiple ({})", versions.len()),
    }
}

fn detect_python<F>(runner: &F, snapshot: &mut ManagerSnapshot) -> Option<String>
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    for program in ["python3", "python"] {
        match runner(program, &["--version".to_string()], Duration::from_secs(5)) {
            Ok(run) if run.exit_code == Some(0) => return Some(program.to_string()),
            Ok(run) => snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                "Python version probe failed",
                run,
            )),
            Err(failure) if matches!(failure.kind, FailureKind::MissingBinary) => {}
            Err(failure) => snapshot.failures.push(failure),
        }
    }

    snapshot.failures.push(CommandFailure {
        kind: FailureKind::MissingBinary,
        message: "python3 and python are not installed or are not on PATH".to_string(),
        command: None,
        stdout: String::new(),
        stderr: String::new(),
    });
    None
}

fn command_stdout_owned<F>(
    program: &str,
    args: Vec<String>,
    timeout_secs: u64,
    snapshot: &mut ManagerSnapshot,
    runner: &F,
    failure_message: &str,
) -> Option<String>
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    match runner(program, &args, Duration::from_secs(timeout_secs)) {
        Ok(run) if run.exit_code == Some(0) => Some(trimmed(run.stdout)),
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

fn parse_pip_list(stdout: &str, python_executable: &str) -> Result<Vec<PackageRow>, String> {
    let value: Value = serde_json::from_str(stdout).map_err(|err| err.to_string())?;
    let packages = value
        .as_array()
        .ok_or_else(|| "pip list output was not an array".to_string())?;

    let mut rows = packages
        .iter()
        .filter_map(|package| {
            Some(package_row(
                json_string(package.get("name"))?,
                json_string(package.get("version")).unwrap_or_else(|| "unknown".to_string()),
                None,
                format!("{python_executable} -m pip list --format=json").as_str(),
                PackageKind::PythonDistribution,
            ))
        })
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(rows)
}

#[derive(Default)]
struct PipInspectEnrichment {
    site_packages: Option<String>,
    user_site: Option<String>,
}

fn enrich_pip_from_inspect(
    packages: &mut [PackageRow],
    stdout: &str,
) -> Result<PipInspectEnrichment, String> {
    let value: Value = serde_json::from_str(stdout).map_err(|err| err.to_string())?;
    let mut enrichment = PipInspectEnrichment::default();
    let mut by_name = packages
        .iter_mut()
        .map(|package| (package.name.to_ascii_lowercase(), package))
        .collect::<HashMap<_, _>>();

    let Some(installed) = value.get("installed").and_then(Value::as_array) else {
        return Ok(enrichment);
    };

    for item in installed {
        let name = item
            .get("metadata")
            .and_then(|metadata| metadata.get("name"))
            .and_then(Value::as_str)
            .or_else(|| item.get("name").and_then(Value::as_str));
        let Some(name) = name else {
            continue;
        };
        let Some(package) = by_name.get_mut(&name.to_ascii_lowercase()) else {
            continue;
        };

        if let Some(location) = json_string(item.get("location")) {
            package.path = Some(
                Path::new(&location)
                    .join(&package.name)
                    .display()
                    .to_string(),
            );
            if enrichment.site_packages.is_none() {
                enrichment.site_packages = Some(location.clone());
            }
            if is_user_site(&location) {
                enrichment.user_site = Some(location);
                push_signal(package, PackageSignal::UserSite);
            }
        }
        if item
            .get("editable_project_location")
            .and_then(Value::as_str)
            .is_some()
        {
            push_signal(package, PackageSignal::Editable);
        }
        if item.get("direct_url").is_some() {
            push_signal(package, PackageSignal::DirectUrl);
        }
    }

    Ok(enrichment)
}

fn is_user_site(path: &str) -> bool {
    path.contains("/.local/") || path.contains("/Library/Python/")
}

fn attach_pip_actions(packages: &mut [PackageRow], python_executable: &str) {
    for package in packages {
        package.actions.push(envelope_owned(
            python_executable,
            vec![
                "-m".to_string(),
                "pip".to_string(),
                "show".to_string(),
                package.name.clone(),
            ],
            0,
        ));
        package.actions.push(envelope_owned(
            python_executable,
            vec![
                "-m".to_string(),
                "pip".to_string(),
                "install".to_string(),
                "--upgrade".to_string(),
                package.name.clone(),
            ],
            0,
        ));
        package.actions.push(envelope_owned(
            python_executable,
            vec![
                "-m".to_string(),
                "pip".to_string(),
                "uninstall".to_string(),
                package.name.clone(),
            ],
            0,
        ));
    }
}

fn detect_pip_environment(
    python_executable: &str,
    site_packages: Option<&str>,
) -> PipEnvironmentKind {
    if env::var_os("VIRTUAL_ENV").is_some() || python_executable.contains("/.venv/") {
        return PipEnvironmentKind::VirtualEnv;
    }
    if site_packages.is_some_and(is_user_site) {
        return PipEnvironmentKind::User;
    }
    if python_executable.starts_with("/usr/bin/") || python_executable.starts_with("/System/") {
        return PipEnvironmentKind::System;
    }
    PipEnvironmentKind::Unknown
}

fn hydrate_pip_outdated_with_runner<F>(python_executable: &str, runner: &F) -> PipOutdatedPreview
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let args = vec![
        "-m".to_string(),
        "pip".to_string(),
        "list".to_string(),
        "--outdated".to_string(),
        "--format=json".to_string(),
    ];
    match runner(python_executable, &args, Duration::from_secs(30)) {
        Ok(run) if run.exit_code == Some(0) => match parse_pip_outdated(&run.stdout) {
            Ok(outdated) => PipOutdatedPreview {
                status: AsyncStatus::Ready,
                command: envelope_owned(python_executable, args, 30_000),
                outdated,
                message: None,
                failure: None,
            },
            Err(message) => PipOutdatedPreview {
                status: AsyncStatus::Failed,
                command: envelope_owned(python_executable, args, 30_000),
                outdated: Vec::new(),
                message: Some(message.clone()),
                failure: Some(parse_failure(message, run)),
            },
        },
        Ok(run) => {
            let failure = command_failure(FailureKind::CommandFailed, "pip outdated failed", run);
            PipOutdatedPreview {
                status: AsyncStatus::Failed,
                command: envelope_owned(python_executable, args, 30_000),
                outdated: Vec::new(),
                message: Some(failure.message.clone()),
                failure: Some(failure),
            }
        }
        Err(failure) => PipOutdatedPreview {
            status: AsyncStatus::Failed,
            command: envelope_owned(python_executable, args, 30_000),
            outdated: Vec::new(),
            message: Some(failure.message.clone()),
            failure: Some(failure),
        },
    }
}

fn parse_pip_outdated(stdout: &str) -> Result<Vec<String>, String> {
    let value: Value = serde_json::from_str(stdout).map_err(|err| err.to_string())?;
    let packages = value
        .as_array()
        .ok_or_else(|| "pip outdated output was not an array".to_string())?;
    let mut names = packages
        .iter()
        .filter_map(|package| json_string(package.get("name")))
        .collect::<Vec<_>>();
    names.sort();
    Ok(names)
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
            PackageKind::Generic | PackageKind::MavenArtifact | PackageKind::PythonDistribution => {
            }
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
            PackageKind::Generic | PackageKind::MavenArtifact | PackageKind::PythonDistribution => {
            }
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
        PackageKind::MavenArtifact => 3,
        PackageKind::PythonDistribution => 4,
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

fn run_command_owned(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<CommandRun, CommandFailure> {
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_command(program, &refs, timeout)
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

fn npx_cache_path(cache_path: &str) -> String {
    Path::new(cache_path).join("_npx").display().to_string()
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
        && snapshot.failures.iter().any(|failure| {
            matches!(
                failure.kind,
                FailureKind::MissingBinary | FailureKind::MissingPath
            )
        })
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
        maven: None,
        pip: None,
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
    fn npx_cache_path_uses_npm_cache_subdirectory() {
        assert_eq!(npx_cache_path("/tmp/npm-cache"), "/tmp/npm-cache/_npx");
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
        let _guard = TempDirGuard(root.clone());
        fs::create_dir_all(root.join("versions/node/v20.11.1/bin")).expect("create node version");
        fs::create_dir_all(root.join("versions/node/v18.19.0/bin")).expect("create node version");
        fs::create_dir_all(root.join("versions/node/not-a-version")).expect("create ignored dir");

        let snapshot = scan_nvm_with_dir(root.clone());

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.id, ManagerId::Nvm);
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::NvmDir && path.path == root.display().to_string()));
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

    #[test]
    fn scan_nvm_reports_missing_when_nvm_dir_does_not_exist() {
        let root = temp_dir("missing-nvm");
        fs::remove_dir_all(&root).expect("remove temp dir");

        let snapshot = scan_nvm_with_dir(root);

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
    fn parse_maven_settings_reads_only_top_level_local_repository() {
        let repository = parse_maven_local_repository_setting(
            r#"<settings>
                <servers>
                  <server>
                    <username>sunven</username>
                    <password>secret</password>
                    <localRepository>/wrong</localRepository>
                  </server>
                </servers>
                <localRepository>${user.home}/.cache/maven</localRepository>
              </settings>"#,
        )
        .expect("parse settings");

        assert_eq!(repository.as_deref(), Some("${user.home}/.cache/maven"));
    }

    #[test]
    fn parse_maven_settings_rejects_malformed_xml() {
        let error = parse_maven_local_repository_setting("<settings>").expect_err("parse failure");

        assert!(!error.is_empty());
    }

    #[test]
    fn scan_maven_repository_flags_duplicates_and_snapshots() {
        let root = temp_dir("maven-repo");
        let _guard = TempDirGuard(root.clone());
        write_file(
            &root.join("org/example/tool/1.0.0/tool-1.0.0.pom"),
            b"<project />",
        );
        write_file(&root.join("org/example/tool/1.1.0/tool-1.1.0.jar"), b"jar");
        write_file(
            &root.join("org/example/snap/2.0-SNAPSHOT/snap-2.0-SNAPSHOT.pom"),
            b"<project />",
        );

        let scan = scan_maven_repository(
            &root,
            MavenScanLimits {
                max_scan_ms: 5_000,
                max_version_dirs: 100,
                max_rows_returned: 100,
            },
        );

        assert_eq!(scan.health.artifact_count, 2);
        assert_eq!(scan.health.version_count, 3);
        assert_eq!(scan.health.snapshot_count, 1);
        assert_eq!(scan.health.duplicate_artifact_count, 1);

        let tool = scan
            .packages
            .iter()
            .find(|package| package.name == "org.example:tool")
            .expect("tool artifact");
        assert!(tool.signals.contains(&PackageSignal::DuplicateVersions));
        assert!(tool
            .actions
            .iter()
            .any(|action| action.preview.contains("dependency:tree")));

        let snap = scan
            .packages
            .iter()
            .find(|package| package.name == "org.example:snap")
            .expect("snapshot artifact");
        assert!(snap.signals.contains(&PackageSignal::Snapshot));
    }

    #[test]
    fn parse_pip_list_sorts_packages() {
        let packages = parse_pip_list(
            r#"[
                {"name": "requests", "version": "2.32.3"},
                {"name": "black", "version": "24.4.2"}
            ]"#,
            "/usr/bin/python3",
        )
        .expect("parse pip list");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "black");
        assert_eq!(packages[0].kind, PackageKind::PythonDistribution);
        assert_eq!(
            packages[0].source,
            "/usr/bin/python3 -m pip list --format=json"
        );
    }

    #[test]
    fn enrich_pip_from_inspect_marks_editable_direct_url_and_user_site() {
        let mut packages = parse_pip_list(
            r#"[{"name": "local-tool", "version": "0.1.0"}]"#,
            "/usr/bin/python3",
        )
        .expect("parse pip list");

        let enrichment = enrich_pip_from_inspect(
            &mut packages,
            r#"{
                "installed": [{
                    "metadata": {"name": "local-tool"},
                    "location": "/Users/sunven/Library/Python/3.12/lib/python/site-packages",
                    "editable_project_location": "/Users/sunven/github/local-tool",
                    "direct_url": {"url": "file:///Users/sunven/github/local-tool"}
                }]
            }"#,
        )
        .expect("inspect enrichment");

        let package = &packages[0];
        assert!(package.signals.contains(&PackageSignal::Editable));
        assert!(package.signals.contains(&PackageSignal::DirectUrl));
        assert!(package.signals.contains(&PackageSignal::UserSite));
        assert!(package.path.as_deref().unwrap().contains("local-tool"));
        assert!(enrichment.user_site.is_some());
    }

    #[test]
    fn parse_pip_outdated_reads_names() {
        let outdated = parse_pip_outdated(
            r#"[
                {"name": "requests", "version": "2.31.0", "latest_version": "2.32.3"},
                {"name": "black", "version": "23.0.0", "latest_version": "24.4.2"}
            ]"#,
        )
        .expect("parse outdated");

        assert_eq!(outdated, vec!["black".to_string(), "requests".to_string()]);
    }

    #[test]
    fn parse_cargo_install_list_reads_single_and_multi_binary_crates() {
        let packages = parse_cargo_install_list(
            "ripgrep v14.1.1:\n    rg\ncargo-edit v0.13.4:\n    cargo-add\n    cargo-rm\n",
            Path::new("/Users/sunven/.cargo/bin"),
        )
        .expect("parse cargo install list");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "cargo-edit");
        assert_eq!(packages[0].version, "0.13.4");
        assert_eq!(
            packages[0].path.as_deref(),
            Some("/Users/sunven/.cargo/bin/cargo-add")
        );
        assert!(packages[0]
            .actions
            .iter()
            .any(|action| action.preview == "cargo install cargo-edit"));
        assert!(packages[0]
            .actions
            .iter()
            .any(|action| action.preview == "cargo uninstall cargo-edit"));
        assert_eq!(packages[1].name, "ripgrep");
        assert_eq!(packages[1].version, "14.1.1");
        assert_eq!(
            packages[1].path.as_deref(),
            Some("/Users/sunven/.cargo/bin/rg")
        );
    }

    #[test]
    fn parse_cargo_install_list_allows_empty_output() {
        let packages = parse_cargo_install_list("", Path::new("/Users/sunven/.cargo/bin"))
            .expect("parse empty cargo install list");

        assert!(packages.is_empty());
    }

    #[test]
    fn parse_cargo_install_list_rejects_unknown_content() {
        let error = parse_cargo_install_list(
            "installed crates:\n  ripgrep",
            Path::new("/Users/sunven/.cargo/bin"),
        )
        .expect_err("parse failure");

        assert!(error.contains("Could not parse cargo install list line"));
    }

    #[test]
    fn resolve_cargo_home_uses_env_or_home_fallback() {
        assert_eq!(
            resolve_cargo_home(Some("~/rust/cargo"), Some(Path::new("/Users/sunven"))),
            PathBuf::from("/Users/sunven/rust/cargo")
        );
        assert_eq!(
            resolve_cargo_home(None, Some(Path::new("/Users/sunven"))),
            PathBuf::from("/Users/sunven/.cargo")
        );
        assert_eq!(resolve_cargo_home(None, None), PathBuf::from(".cargo"));
    }

    #[test]
    fn scan_cargo_collects_safe_commands_paths_packages_and_actions() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "cargo");
            match args {
                ["--version"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "cargo 1.88.0 (873a06493 2025-05-10)\n",
                )),
                ["install", "--list"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "ripgrep v14.1.1:\n    rg\n",
                )),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot =
            scan_cargo_with_runner_and_home(&runner, PathBuf::from("/Users/sunven/.cargo"));

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.version.as_deref(), Some("1.88.0"));
        assert_eq!(snapshot.commands.len(), 2);
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::CargoBin));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::CargoRegistryCache));
        assert_eq!(snapshot.packages.len(), 1);
        assert_eq!(snapshot.packages[0].name, "ripgrep");
        assert_eq!(
            snapshot.packages[0].path.as_deref(),
            Some("/Users/sunven/.cargo/bin/rg")
        );
    }

    #[test]
    fn scan_cargo_reports_missing_without_running_install_list() {
        let runner = |program: &str,
                      args: &[&str],
                      _timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "cargo");
            assert_eq!(args, ["--version"]);
            Err(CommandFailure {
                kind: FailureKind::MissingBinary,
                message: "cargo is not installed or is not on PATH".to_string(),
                command: Some(envelope("cargo", &["--version"], 5_000)),
                stdout: String::new(),
                stderr: "not found".to_string(),
            })
        };

        let snapshot =
            scan_cargo_with_runner_and_home(&runner, PathBuf::from("/Users/sunven/.cargo"));

        assert_eq!(snapshot.status, ManagerStatus::Missing);
        assert!(snapshot.packages.is_empty());
        assert!(snapshot.paths.iter().any(|path| path.label == "Cargo bin"));
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
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
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
            hydrate_homebrew_cleanup,
            hydrate_pip_outdated
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
