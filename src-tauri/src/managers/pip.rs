use super::*;

pub(super) fn scan_pip() -> ManagerSnapshot {
    scan_pip_with_runner(&run_command_owned)
}

pub(super) fn scan_pip_with_runner<F>(runner: &F) -> ManagerSnapshot
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

/// Resolves the interpreter to run a cleanup through.
///
/// Deliberately re-resolved instead of carried over from the scan: cleanup
/// should act on the Python environment in effect *now*, not the one that was
/// active when the scan ran. It is never accepted from the frontend — doing so
/// would let an arbitrary program path reach the command runner and would undo
/// the guarantee that the frontend cannot choose what executes (ADR-0001).
pub(crate) fn resolve_python_for_cleanup<F>(runner: &F) -> Result<String, String>
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    for program in ["python3", "python"] {
        if let Ok(run) = runner(program, &["--version".to_string()], Duration::from_secs(5)) {
            if run.exit_code == Some(0) {
                return Ok(program.to_string());
            }
        }
    }

    Err("python3 and python are not installed or are not on PATH".to_string())
}

pub(super) fn detect_python<F>(runner: &F, snapshot: &mut ManagerSnapshot) -> Option<String>
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

pub(super) fn command_stdout_owned<F>(
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

pub(super) fn parse_pip_list(
    stdout: &str,
    python_executable: &str,
) -> Result<Vec<PackageRow>, String> {
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
pub(super) struct PipInspectEnrichment {
    pub(super) site_packages: Option<String>,
    pub(super) user_site: Option<String>,
}

pub(super) fn enrich_pip_from_inspect(
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

pub(super) fn is_user_site(path: &str) -> bool {
    path.contains("/.local/") || path.contains("/Library/Python/")
}

pub(super) fn attach_pip_actions(packages: &mut [PackageRow], python_executable: &str) {
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

pub(super) fn detect_pip_environment(
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

pub(crate) fn hydrate_pip_outdated_with_runner<F>(
    python_executable: &str,
    runner: &F,
) -> PipOutdatedPreview
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

pub(super) fn parse_pip_outdated(stdout: &str) -> Result<Vec<String>, String> {
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
