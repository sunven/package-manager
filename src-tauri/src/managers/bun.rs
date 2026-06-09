use super::*;

pub(super) fn scan_bun() -> ManagerSnapshot {
    scan_bun_with_runner_and_home(&run_command, home_dir().as_deref())
}

pub(super) fn scan_bun_with_runner_and_home<F>(runner: &F, home: Option<&Path>) -> ManagerSnapshot
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

pub(super) fn resolve_bun_install_from_env(home: Option<&Path>) -> PathBuf {
    let bun_install = env::var("BUN_INSTALL").ok();
    resolve_bun_install(bun_install.as_deref(), home)
}

pub(super) fn resolve_bun_install(bun_install: Option<&str>, home: Option<&Path>) -> PathBuf {
    if let Some(value) = bun_install.map(str::trim).filter(|value| !value.is_empty()) {
        return expand_tilde(value, home);
    }

    home.map(|home| home.join(".bun"))
        .unwrap_or_else(|| PathBuf::from(".bun"))
}

pub(super) fn parse_bun_global_packages(stdout: &str, global_bin: &str) -> Vec<PackageRow> {
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

pub(super) fn parse_bun_global_package_line(line: &str) -> Option<(String, String)> {
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

pub(super) fn attach_bun_actions(rows: &mut [PackageRow]) {
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
