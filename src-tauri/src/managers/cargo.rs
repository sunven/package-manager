use super::*;

pub(super) fn scan_cargo() -> ManagerSnapshot {
    scan_cargo_with_runner(&run_command)
}

pub(super) fn scan_cargo_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    scan_cargo_with_runner_and_home(runner, resolve_cargo_home_from_env())
}

pub(super) fn scan_cargo_with_runner_and_home<F>(runner: &F, cargo_home: PathBuf) -> ManagerSnapshot
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

pub(super) fn parse_cargo_version(stdout: &str) -> String {
    let line = stdout.lines().next().unwrap_or("").trim();
    line.strip_prefix("cargo ")
        .and_then(|value| value.split_whitespace().next())
        .filter(|value| !value.is_empty())
        .unwrap_or(line)
        .to_string()
}

pub(super) fn resolve_cargo_home_from_env() -> PathBuf {
    let cargo_home = env::var("CARGO_HOME").ok();
    resolve_cargo_home(cargo_home.as_deref(), home_dir().as_deref())
}

pub(super) fn resolve_cargo_home(cargo_home: Option<&str>, home: Option<&Path>) -> PathBuf {
    if let Some(value) = cargo_home.map(str::trim).filter(|value| !value.is_empty()) {
        return expand_tilde(value, home);
    }

    home.map(|home| home.join(".cargo"))
        .unwrap_or_else(|| PathBuf::from(".cargo"))
}

#[derive(Debug)]
pub(super) struct CargoInstallEntry {
    pub(super) name: String,
    pub(super) version: String,
    pub(super) binaries: Vec<String>,
}

pub(super) fn parse_cargo_install_list(
    stdout: &str,
    bin_dir: &Path,
) -> Result<Vec<PackageRow>, String> {
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

pub(super) fn parse_cargo_install_header(line: &str) -> Option<CargoInstallEntry> {
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

pub(super) fn attach_cargo_actions(row: &mut PackageRow) {
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
