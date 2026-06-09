use super::*;

pub(super) fn scan_uv() -> ManagerSnapshot {
    scan_uv_with_runner(&run_command)
}

pub(super) fn scan_uv_with_runner<F>(runner: &F) -> ManagerSnapshot
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

pub(super) fn parse_uv_version(stdout: &str) -> String {
    let line = stdout.lines().next().unwrap_or("").trim();
    line.strip_prefix("uv ")
        .filter(|value| !value.is_empty())
        .unwrap_or(line)
        .to_string()
}

pub(super) fn parse_uv_tool_list(stdout: &str) -> Vec<PackageRow> {
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

pub(super) fn parse_uv_tool_header(line: &str) -> Option<(String, String)> {
    let (name, rest) = line.split_once(' ')?;
    let version = rest
        .split_whitespace()
        .find_map(|part| part.strip_prefix('v'))
        .filter(|part| part.chars().next().is_some_and(|ch| ch.is_ascii_digit()))?;
    Some((name.to_string(), version.to_string()))
}

pub(super) fn parse_uv_tool_executable(line: &str) -> Option<String> {
    line.strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn parse_uv_python_list(stdout: &str) -> Result<Vec<PackageRow>, String> {
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

pub(super) fn parse_uv_python_version(name: &str) -> Option<String> {
    name.split('-')
        .find(|part| part.chars().next().is_some_and(|ch| ch.is_ascii_digit()))
        .map(str::to_string)
}

pub(super) fn attach_uv_actions(rows: &mut [PackageRow]) {
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
