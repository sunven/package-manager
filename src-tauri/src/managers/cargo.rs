use super::scan_support::{empty_snapshot, expand_tilde, finish, home_dir, package_row};
use crate::command::{envelope_owned, parse_failure, run_command, run_recorded_command};
use crate::disk_usage::path_info;
use crate::types::{
    CommandFailure, CommandRun, ManagerId, ManagerSnapshot, PackageKind, PackageRow, PathKind,
};
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(super) fn scan_cargo() -> ManagerSnapshot {
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

#[cfg(test)]
mod tests {
    use super::super::test_support::fake_run;
    use super::{parse_cargo_install_list, resolve_cargo_home, scan_cargo_with_runner_and_home};
    use crate::command::envelope;
    use crate::types::{CommandFailure, CommandRun, FailureKind, ManagerStatus, PathKind};
    use std::path::{Path, PathBuf};
    use std::time::Duration;

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
}
