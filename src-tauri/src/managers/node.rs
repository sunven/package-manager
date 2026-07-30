use super::*;

pub(super) fn scan_npm() -> ManagerSnapshot {
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

pub(super) fn scan_pnpm() -> ManagerSnapshot {
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

pub(super) fn scan_yarn() -> ManagerSnapshot {
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

pub(super) fn scan_yarn_classic(snapshot: &mut ManagerSnapshot) {
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

pub(super) fn scan_yarn_modern(snapshot: &mut ManagerSnapshot) {
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

pub(super) fn scan_nvm() -> ManagerSnapshot {
    scan_nvm_with_dir(resolve_nvm_dir_from_env())
}

pub(super) fn scan_nvm_with_dir(nvm_dir: PathBuf) -> ManagerSnapshot {
    scan_nvm_with_context(nvm_dir, env::var("NVM_BIN").ok())
}

pub(super) fn scan_nvm_with_context(nvm_dir: PathBuf, nvm_bin: Option<String>) -> ManagerSnapshot {
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

    let current_version = current_nvm_node_version(&nvm_dir, nvm_bin.as_deref());
    snapshot.packages = scan_nvm_node_versions(&node_versions_dir, current_version.as_deref());
    finish(snapshot)
}

pub(super) fn resolve_nvm_dir_from_env() -> PathBuf {
    let nvm_dir = env::var("NVM_DIR").ok();
    resolve_nvm_dir(nvm_dir.as_deref(), home_dir().as_deref())
}

pub(super) fn resolve_nvm_dir(nvm_dir: Option<&str>, home: Option<&Path>) -> PathBuf {
    if let Some(value) = nvm_dir.map(str::trim).filter(|value| !value.is_empty()) {
        return expand_tilde(value, home);
    }

    home.map(|home| home.join(".nvm"))
        .unwrap_or_else(|| PathBuf::from(".nvm"))
}

pub(super) fn scan_nvm_node_versions(
    node_versions_dir: &Path,
    current_version: Option<&str>,
) -> Vec<PackageRow> {
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
            if current_version == Some(version.as_str()) {
                push_signal(&mut row, PackageSignal::Current);
            }
            attach_nvm_actions(&mut row, &version);
            Some(row)
        })
        .collect::<Vec<_>>();

    packages.sort_by(|a, b| compare_semver_desc(&a.version, &b.version));
    packages
}

pub(super) fn current_nvm_node_version(nvm_dir: &Path, nvm_bin: Option<&str>) -> Option<String> {
    nvm_bin
        .and_then(current_nvm_node_version_from_bin)
        .or_else(|| current_nvm_node_version_from_symlink(nvm_dir))
}

pub(super) fn current_nvm_node_version_from_symlink(nvm_dir: &Path) -> Option<String> {
    let target = fs::read_link(nvm_dir.join("current")).ok()?;
    target
        .file_name()
        .and_then(|name| parse_nvm_node_version_dir(&name.to_string_lossy()))
}

pub(super) fn current_nvm_node_version_from_bin(path: &str) -> Option<String> {
    let mut components = Path::new(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>();

    if components
        .last()
        .is_some_and(|component| component == "bin")
    {
        components.pop();
    }

    components
        .last()
        .and_then(|name| parse_nvm_node_version_dir(name))
}

pub(super) fn parse_nvm_node_version_dir(name: &str) -> Option<String> {
    let version = name.strip_prefix('v')?;
    if version.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        Some(version.to_string())
    } else {
        None
    }
}

pub(super) fn compare_semver_desc(left: &str, right: &str) -> std::cmp::Ordering {
    semver_sort_key(right)
        .cmp(&semver_sort_key(left))
        .then_with(|| right.cmp(left))
}

pub(super) fn semver_sort_key(version: &str) -> (u64, u64, u64) {
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

pub(super) fn attach_nvm_actions(row: &mut PackageRow, version: &str) {
    row.actions.push(envelope_owned(
        "nvm",
        vec!["use".to_string(), version.to_string()],
        0,
    ));
}

pub(crate) fn run_npm_maintenance_with_runner<F>(
    operation: NpmMaintenanceOperation,
    runner: &F,
) -> MaintenanceRunPreview
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let args = match operation {
        NpmMaintenanceOperation::UninstallGlobalPackage { package_name } => {
            vec!["uninstall".to_string(), "-g".to_string(), package_name]
        }
    };
    let command = envelope_owned("npm", args.clone(), 30_000);

    match runner("npm", &args, Duration::from_secs(30)) {
        Ok(run) if run.exit_code == Some(0) => MaintenanceRunPreview {
            status: AsyncStatus::Ready,
            command,
            stdout: run.stdout,
            stderr: run.stderr,
            message: None,
            failure: None,
        },
        Ok(run) => {
            let failure =
                command_failure(FailureKind::CommandFailed, "npm maintenance failed", run);
            MaintenanceRunPreview {
                status: AsyncStatus::Failed,
                command,
                stdout: failure.stdout.clone(),
                stderr: failure.stderr.clone(),
                message: Some(failure.message.clone()),
                failure: Some(failure),
            }
        }
        Err(failure) => MaintenanceRunPreview {
            status: AsyncStatus::Failed,
            command,
            stdout: failure.stdout.clone(),
            stderr: failure.stderr.clone(),
            message: Some(failure.message.clone()),
            failure: Some(failure),
        },
    }
}

pub(crate) fn run_pnpm_maintenance_with_runner<F>(
    operation: PnpmMaintenanceOperation,
    runner: &F,
) -> MaintenanceRunPreview
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let args = match operation {
        PnpmMaintenanceOperation::UninstallGlobalPackage { package_name } => {
            vec!["remove".to_string(), "--global".to_string(), package_name]
        }
    };
    let command = envelope_owned("pnpm", args.clone(), 30_000);

    match runner("pnpm", &args, Duration::from_secs(30)) {
        Ok(run) if run.exit_code == Some(0) => MaintenanceRunPreview {
            status: AsyncStatus::Ready,
            command,
            stdout: run.stdout,
            stderr: run.stderr,
            message: None,
            failure: None,
        },
        Ok(run) => {
            let failure =
                command_failure(FailureKind::CommandFailed, "pnpm maintenance failed", run);
            MaintenanceRunPreview {
                status: AsyncStatus::Failed,
                command,
                stdout: failure.stdout.clone(),
                stderr: failure.stderr.clone(),
                message: Some(failure.message.clone()),
                failure: Some(failure),
            }
        }
        Err(failure) => MaintenanceRunPreview {
            status: AsyncStatus::Failed,
            command,
            stdout: failure.stdout.clone(),
            stderr: failure.stderr.clone(),
            message: Some(failure.message.clone()),
            failure: Some(failure),
        },
    }
}

pub(super) fn parse_npm_packages(stdout: &str) -> Result<Vec<PackageRow>, String> {
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

pub(super) fn parse_pnpm_packages(stdout: &str) -> Result<Vec<PackageRow>, String> {
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

pub(super) fn parse_yarn_classic_packages(stdout: &str) -> Result<Vec<PackageRow>, String> {
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

pub(super) fn parse_yarn_human_list(stdout: &str) -> Vec<PackageRow> {
    stdout
        .lines()
        .flat_map(str::split_whitespace)
        .map(trim_yarn_token)
        .filter(|token| token.contains('@'))
        .map(|token| yarn_package_row(&token))
        .collect()
}

pub(super) fn trim_yarn_token(token: &str) -> String {
    token
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | ',' | ':' | ';' | '(' | ')' | '[' | ']'))
        .to_string()
}

pub(super) fn yarn_package_row(raw: &str) -> PackageRow {
    let (name, version) = split_package_version(raw);
    package_row(
        name,
        version,
        None,
        "yarn global list --json",
        PackageKind::Generic,
    )
}

pub(super) fn npx_cache_path(cache_path: &str) -> String {
    Path::new(cache_path).join("_npx").display().to_string()
}
