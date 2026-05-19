use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PackageRow {
    name: String,
    version: String,
    path: Option<String>,
    source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathInfo {
    label: String,
    kind: PathKind,
    path: String,
    size: DiskUsage,
}

#[derive(Debug, Serialize)]
enum PathKind {
    Cache,
    Store,
    GlobalModules,
    GlobalDir,
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
}

#[derive(Debug, Clone, Copy, Serialize)]
enum ManagerId {
    Npm,
    Pnpm,
    Yarn,
}

#[derive(Debug, Serialize)]
enum ManagerStatus {
    Ready,
    Missing,
    Unsupported,
    Partial,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanSnapshot {
    scan_duration_ms: u128,
    managers: Vec<ManagerSnapshot>,
}

#[tauri::command]
fn scan_managers() -> ScanSnapshot {
    let started = Instant::now();
    let managers = vec![scan_npm(), scan_pnpm(), scan_yarn()];

    ScanSnapshot {
        scan_duration_ms: started.elapsed().as_millis(),
        managers,
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

fn parse_npm_packages(stdout: &str) -> Result<Vec<PackageRow>, String> {
    let value: Value = serde_json::from_str(stdout).map_err(|err| err.to_string())?;
    let Some(dependencies) = value.get("dependencies").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };

    let mut packages = dependencies
        .iter()
        .map(|(name, package)| PackageRow {
            name: name.to_string(),
            version: json_string(package.get("version")).unwrap_or_else(|| "unknown".to_string()),
            path: json_string(package.get("path")),
            source: "npm ls -g --depth=0 --json".to_string(),
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
            packages.push(PackageRow {
                name: name.to_string(),
                version: json_string(package.get("version"))
                    .unwrap_or_else(|| "unknown".to_string()),
                path: json_string(package.get("path")),
                source: "pnpm list -g --depth=0 --json".to_string(),
            });
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
    PackageRow {
        name,
        version,
        path: None,
        source: "yarn global list --json".to_string(),
    }
}

fn split_package_version(raw: &str) -> (String, String) {
    if let Some(index) = raw.rfind('@') {
        if index > 0 && index + 1 < raw.len() {
            return (raw[..index].to_string(), raw[index + 1..].to_string());
        }
    }

    (raw.to_string(), "unknown".to_string())
}

fn json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
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
    let child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

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

fn envelope_preview(program: &str, args: &[&str]) -> String {
    std::iter::once(program)
        .chain(args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ")
}

fn path_info(label: &str, kind: PathKind, path: String) -> PathInfo {
    let size = disk_usage(Path::new(&path));
    PathInfo {
        label: label.to_string(),
        kind,
        path,
        size,
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
        .invoke_handler(tauri::generate_handler![scan_managers])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
