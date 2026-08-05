use super::scan_support::{empty_snapshot, finish, json_string, package_row, push_signal};
use crate::command::{
    command_failure, envelope, envelope_owned, parse_failure, run_command, run_recorded_command,
    run_recorded_stdout,
};
use crate::disk_usage::{format_bytes, parse_size, path_info};
use crate::types::{
    AsyncStatus, CommandEnvelope, CommandFailure, CommandRun, FailureKind, HomebrewCleanupPreview,
    HomebrewMaintenance, ManagerId, ManagerSnapshot, ManagerStatus, PackageKind, PackageRow,
    PackageSignal, PathKind,
};
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

pub(super) fn scan_homebrew() -> ManagerSnapshot {
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

fn kind_rank(kind: PackageKind) -> u8 {
    match kind {
        PackageKind::Generic => 0,
        PackageKind::Formula => 1,
        PackageKind::Cask => 2,
        PackageKind::MavenArtifact => 3,
        PackageKind::PythonDistribution => 4,
        PackageKind::DockerImage => 5,
        PackageKind::DockerContainer => 6,
        PackageKind::DockerVolume => 7,
        PackageKind::BunPackage => 8,
        PackageKind::UvTool => 9,
        PackageKind::UvPython => 10,
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
            PackageKind::Generic
            | PackageKind::MavenArtifact
            | PackageKind::PythonDistribution
            | PackageKind::DockerImage
            | PackageKind::DockerContainer
            | PackageKind::DockerVolume
            | PackageKind::BunPackage
            | PackageKind::UvTool
            | PackageKind::UvPython => {}
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
            PackageKind::Generic
            | PackageKind::MavenArtifact
            | PackageKind::PythonDistribution
            | PackageKind::DockerImage
            | PackageKind::DockerContainer
            | PackageKind::DockerVolume
            | PackageKind::BunPackage
            | PackageKind::UvTool
            | PackageKind::UvPython => {}
        }
    }
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

pub(crate) fn hydrate_homebrew_cleanup_with_runner<F>(runner: &F) -> HomebrewCleanupPreview
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

#[cfg(test)]
mod tests {
    use super::{
        hydrate_homebrew_cleanup_with_runner, parse_homebrew_list_versions,
        scan_homebrew_with_runner,
    };
    use crate::command::envelope;
    use crate::managers::test_support::{fake_failed_run, fake_run};
    use crate::types::{
        AsyncStatus, CommandFailure, CommandRun, FailureKind, ManagerStatus, PackageKind,
        PackageSignal, PathKind,
    };
    use std::time::Duration;

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
}
