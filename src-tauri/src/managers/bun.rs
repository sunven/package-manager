use super::scan_support::{
    empty_snapshot, expand_tilde, finish, home_dir, package_row, split_package_version, trimmed,
};
use crate::command::{
    envelope, envelope_owned, run_command, run_recorded_command, run_recorded_stdout,
};
use crate::disk_usage::path_info;
use crate::types::{
    CommandFailure, CommandRun, ManagerId, ManagerSnapshot, PackageKind, PackageRow, PathKind,
};
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(super) fn scan_bun() -> ManagerSnapshot {
    scan_bun_with_runner_and_home(&run_command, home_dir().as_deref())
}

fn scan_bun_with_runner_and_home<F>(runner: &F, home: Option<&Path>) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Bun, "Bun");

    let version_run = match run_recorded_command(
        &mut snapshot,
        runner,
        "bun",
        &["--version"],
        5,
        "Bun version probe failed",
    ) {
        Some(run) => run,
        None => return finish(snapshot),
    };
    snapshot.version = Some(trimmed(version_run.stdout));

    let bun_root = resolve_bun_install_from_env(home);
    snapshot.paths.push(path_info(
        "Bun install",
        PathKind::BunInstall,
        bun_root.display().to_string(),
    ));

    if let Some(cache) = run_recorded_stdout(
        &mut snapshot,
        runner,
        "bun",
        &["pm", "cache"],
        5,
        "Bun cache lookup failed",
    ) {
        snapshot
            .paths
            .push(path_info("Bun cache", PathKind::BunCache, cache));
    } else {
        snapshot.paths.push(path_info(
            "Bun cache",
            PathKind::BunCache,
            bun_root.join("install/cache").display().to_string(),
        ));
    }

    let global_bin = run_recorded_stdout(
        &mut snapshot,
        runner,
        "bun",
        &["pm", "bin", "-g"],
        5,
        "Bun global bin lookup failed",
    )
    .unwrap_or_else(|| bun_root.join("bin").display().to_string());

    if let Some(run) = run_recorded_command(
        &mut snapshot,
        runner,
        "bun",
        &["pm", "ls", "-g"],
        15,
        "Bun global package list failed",
    ) {
        snapshot.packages = parse_bun_global_packages(&run.stdout, &global_bin);
    }
    attach_bun_actions(&mut snapshot.packages);

    snapshot
        .commands
        .push(envelope("bun", &["pm", "cache", "rm"], 0));
    finish(snapshot)
}

fn resolve_bun_install_from_env(home: Option<&Path>) -> PathBuf {
    let bun_install = env::var("BUN_INSTALL").ok();
    resolve_bun_install(bun_install.as_deref(), home)
}

fn resolve_bun_install(bun_install: Option<&str>, home: Option<&Path>) -> PathBuf {
    if let Some(value) = bun_install.map(str::trim).filter(|value| !value.is_empty()) {
        return expand_tilde(value, home);
    }

    home.map(|home| home.join(".bun"))
        .unwrap_or_else(|| PathBuf::from(".bun"))
}

fn parse_bun_global_packages(stdout: &str, global_bin: &str) -> Vec<PackageRow> {
    let mut rows = stdout
        .lines()
        .filter_map(parse_bun_global_package_line)
        .map(|(name, version)| {
            package_row(
                name.clone(),
                version,
                Some(Path::new(global_bin).join(&name).display().to_string()),
                "bun pm ls -g",
                PackageKind::BunPackage,
            )
        })
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| a.name.cmp(&b.name));
    rows
}

fn parse_bun_global_package_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('/') || trimmed.starts_with("bun ") {
        return None;
    }

    let token = trimmed
        .split_whitespace()
        .find(|part| part.contains('@') && !part.starts_with("http"))?;
    let (name, version) = split_package_version(token);
    if name.is_empty() || version == "unknown" {
        return None;
    }
    Some((name, version))
}

fn attach_bun_actions(rows: &mut [PackageRow]) {
    for row in rows {
        row.actions.push(envelope_owned(
            "bun",
            vec!["pm".to_string(), "view".to_string(), row.name.clone()],
            0,
        ));
        row.actions.push(envelope_owned(
            "bun",
            vec![
                "remove".to_string(),
                "--global".to_string(),
                row.name.clone(),
            ],
            0,
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::fake_run;
    use super::{parse_bun_global_packages, scan_bun_with_runner_and_home};
    use crate::types::{CommandFailure, CommandRun, ManagerStatus, PackageKind, PathKind};
    use std::path::Path;
    use std::time::Duration;

    #[test]
    fn parse_bun_global_packages_reads_package_rows() {
        let packages = parse_bun_global_packages(
            "/Users/sunven/.bun/install/global\n├── prettier@3.5.3\n└── @scope/tool@1.2.0\n",
            "/Users/sunven/.bun/bin",
        );

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "@scope/tool");
        assert_eq!(packages[0].version, "1.2.0");
        assert_eq!(
            packages[0].path.as_deref(),
            Some("/Users/sunven/.bun/bin/@scope/tool")
        );
        assert_eq!(packages[0].kind, PackageKind::BunPackage);
        assert_eq!(packages[1].name, "prettier");
        assert_eq!(packages[1].version, "3.5.3");
    }

    #[test]
    fn scan_bun_collects_global_packages_paths_and_commands() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "bun");
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "1.2.17\n")),
                ["pm", "cache"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "/Users/sunven/.bun/install/cache\n",
                )),
                ["pm", "bin", "-g"] => {
                    Ok(fake_run(program, args, timeout, "/Users/sunven/.bun/bin\n"))
                }
                ["pm", "ls", "-g"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "/Users/sunven/.bun/install/global\n└── prettier@3.5.3\n",
                )),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot = scan_bun_with_runner_and_home(&runner, Some(Path::new("/Users/sunven")));

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.version.as_deref(), Some("1.2.17"));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::BunInstall));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::BunCache));
        assert_eq!(snapshot.packages.len(), 1);
        assert_eq!(snapshot.packages[0].name, "prettier");
        assert!(snapshot.packages[0]
            .actions
            .iter()
            .any(|action| action.preview == "bun pm view prettier"));
        assert!(snapshot
            .commands
            .iter()
            .any(|command| command.preview == "bun pm cache rm"));
    }
}
