use super::scan_support::{empty_snapshot, finish, package_row};
use crate::command::{
    envelope, envelope_owned, parse_failure, run_command, run_recorded_command, run_recorded_stdout,
};
use crate::disk_usage::path_info;
use crate::types::{
    CommandFailure, CommandRun, ManagerId, ManagerSnapshot, PackageKind, PackageRow, PathKind,
};
use std::time::Duration;

pub(super) fn scan_uv() -> ManagerSnapshot {
    scan_uv_with_runner(&run_command)
}

fn scan_uv_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Uv, "uv");

    let version_run = match run_recorded_command(
        &mut snapshot,
        runner,
        "uv",
        &["--version"],
        5,
        "uv version probe failed",
    ) {
        Some(run) => run,
        None => return finish(snapshot),
    };
    snapshot.version = Some(parse_uv_version(&version_run.stdout));

    if let Some(path) = run_recorded_stdout(
        &mut snapshot,
        runner,
        "uv",
        &["tool", "dir"],
        5,
        "uv tool dir lookup failed",
    ) {
        snapshot
            .paths
            .push(path_info("uv tools", PathKind::UvTools, path));
    }

    if let Some(path) = run_recorded_stdout(
        &mut snapshot,
        runner,
        "uv",
        &["python", "dir"],
        5,
        "uv python dir lookup failed",
    ) {
        snapshot.paths.push(path_info(
            "uv Python installations",
            PathKind::UvPythonInstallations,
            path,
        ));
    }

    if let Some(path) = run_recorded_stdout(
        &mut snapshot,
        runner,
        "uv",
        &["cache", "dir"],
        5,
        "uv cache dir lookup failed",
    ) {
        snapshot
            .paths
            .push(path_info("uv cache", PathKind::UvCache, path));
    }

    if let Some(run) = run_recorded_command(
        &mut snapshot,
        runner,
        "uv",
        &["tool", "list"],
        15,
        "uv tool list failed",
    ) {
        snapshot.packages = parse_uv_tool_list(&run.stdout);
    }

    if let Some(run) = run_recorded_command(
        &mut snapshot,
        runner,
        "uv",
        &["python", "list", "--only-installed"],
        15,
        "uv Python list failed",
    ) {
        match parse_uv_python_list(&run.stdout) {
            Ok(mut rows) => snapshot.packages.append(&mut rows),
            Err(message) => snapshot.failures.push(parse_failure(message, run)),
        }
    }
    attach_uv_actions(&mut snapshot.packages);

    snapshot
        .commands
        .push(envelope("uv", &["cache", "prune"], 0));
    snapshot
        .commands
        .push(envelope("uv", &["cache", "clean"], 0));
    finish(snapshot)
}

fn parse_uv_version(stdout: &str) -> String {
    let line = stdout.lines().next().unwrap_or("").trim();
    line.strip_prefix("uv ")
        .filter(|value| !value.is_empty())
        .unwrap_or(line)
        .to_string()
}

fn parse_uv_tool_list(stdout: &str) -> Vec<PackageRow> {
    let mut rows = Vec::new();
    let mut current_index: Option<usize> = None;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some((name, version)) = parse_uv_tool_header(trimmed) {
            rows.push(package_row(
                name,
                version,
                None,
                "uv tool list",
                PackageKind::UvTool,
            ));
            current_index = Some(rows.len() - 1);
            continue;
        }

        if let Some(index) = current_index {
            if let Some(executable) = parse_uv_tool_executable(trimmed) {
                if rows[index].path.is_none() {
                    rows[index].path = Some(executable);
                }
            }
        }
    }

    rows.sort_by(|a, b| a.name.cmp(&b.name));
    rows
}

fn parse_uv_tool_header(line: &str) -> Option<(String, String)> {
    let (name, rest) = line.split_once(' ')?;
    let version = rest
        .split_whitespace()
        .find_map(|part| part.strip_prefix('v'))
        .filter(|part| part.chars().next().is_some_and(|ch| ch.is_ascii_digit()))?;
    Some((name.to_string(), version.to_string()))
}

fn parse_uv_tool_executable(line: &str) -> Option<String> {
    line.strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_uv_python_list(stdout: &str) -> Result<Vec<PackageRow>, String> {
    let mut rows = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let Some(name) = parts.next() else {
            continue;
        };
        let path = parts.next().map(str::to_string);
        let Some(version) = parse_uv_python_version(name) else {
            return Err(format!("Could not parse uv Python row: {trimmed}"));
        };
        rows.push(package_row(
            name.to_string(),
            version,
            path,
            "uv python list --only-installed",
            PackageKind::UvPython,
        ));
    }

    rows.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(rows)
}

fn parse_uv_python_version(name: &str) -> Option<String> {
    name.split('-')
        .find(|part| part.chars().next().is_some_and(|ch| ch.is_ascii_digit()))
        .map(str::to_string)
}

fn attach_uv_actions(rows: &mut [PackageRow]) {
    for row in rows {
        match row.kind {
            PackageKind::UvTool => {
                row.actions.push(envelope_owned(
                    "uv",
                    vec!["tool".to_string(), "run".to_string(), row.name.clone()],
                    0,
                ));
                row.actions.push(envelope_owned(
                    "uv",
                    vec![
                        "tool".to_string(),
                        "uninstall".to_string(),
                        row.name.clone(),
                    ],
                    0,
                ));
            }
            PackageKind::UvPython => {
                row.actions.push(envelope_owned(
                    "uv",
                    vec![
                        "python".to_string(),
                        "install".to_string(),
                        row.version.clone(),
                    ],
                    0,
                ));
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_uv_python_list, parse_uv_tool_list, scan_uv_with_runner};
    use crate::managers::test_support::fake_run;
    use crate::types::{CommandFailure, CommandRun, ManagerStatus, PackageKind, PathKind};
    use std::time::Duration;

    #[test]
    fn parse_uv_tool_list_reads_tools_and_executables() {
        let packages =
            parse_uv_tool_list("ruff v0.11.13\n- ruff\nhttpie v3.2.4\n- http\n- https\n");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "httpie");
        assert_eq!(packages[0].version, "3.2.4");
        assert_eq!(packages[0].path.as_deref(), Some("http"));
        assert_eq!(packages[0].kind, PackageKind::UvTool);
        assert_eq!(packages[1].name, "ruff");
        assert_eq!(packages[1].version, "0.11.13");
    }

    #[test]
    fn parse_uv_python_list_reads_installed_versions() {
        let packages = parse_uv_python_list(
            "cpython-3.12.7-macos-aarch64-none /Users/sunven/.local/share/uv/python/cpython-3.12.7\npypy-3.10.14-macos-aarch64-none /Users/sunven/.local/share/uv/python/pypy-3.10.14\n",
        )
        .expect("parse uv python list");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "cpython-3.12.7-macos-aarch64-none");
        assert_eq!(packages[0].version, "3.12.7");
        assert_eq!(packages[0].kind, PackageKind::UvPython);
        assert_eq!(packages[1].version, "3.10.14");
    }

    #[test]
    fn scan_uv_collects_tools_pythons_paths_and_commands() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "uv");
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "uv 0.7.13\n")),
                ["tool", "dir"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "/Users/sunven/.local/share/uv/tools\n",
                )),
                ["python", "dir"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "/Users/sunven/.local/share/uv/python\n",
                )),
                ["cache", "dir"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "/Users/sunven/Library/Caches/uv\n",
                )),
                ["tool", "list"] => Ok(fake_run(program, args, timeout, "ruff v0.11.13\n- ruff\n")),
                ["python", "list", "--only-installed"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "cpython-3.12.7-macos-aarch64-none /Users/sunven/.local/share/uv/python/cpython-3.12.7\n",
                )),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot = scan_uv_with_runner(&runner);

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.version.as_deref(), Some("0.7.13"));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::UvTools));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::UvPythonInstallations));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::UvCache));
        assert_eq!(snapshot.packages.len(), 2);
        assert!(snapshot
            .packages
            .iter()
            .any(|package| package.kind == PackageKind::UvTool));
        assert!(snapshot
            .packages
            .iter()
            .any(|package| package.kind == PackageKind::UvPython));
        assert!(snapshot
            .commands
            .iter()
            .any(|command| command.preview == "uv cache prune"));
    }
}
