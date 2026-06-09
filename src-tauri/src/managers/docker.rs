use super::*;

pub(super) fn scan_docker() -> ManagerSnapshot {
    scan_docker_with_runner_and_home(&run_command, home_dir().as_deref())
}

pub(super) fn scan_docker_with_runner_and_home<F>(
    runner: &F,
    home: Option<&Path>,
) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Docker, "Docker");

    push_docker_paths(&mut snapshot, home);
    push_docker_commands(&mut snapshot);

    let version_run = match run_recorded_command(
        &mut snapshot,
        runner,
        "docker",
        &["--version"],
        5,
        "Docker version probe failed",
    ) {
        Some(run) => run,
        None => return finish(snapshot),
    };
    snapshot.version = Some(parse_docker_version(&version_run.stdout));

    let mut images = Vec::new();
    let mut containers = Vec::new();
    let mut volumes = Vec::new();
    let mut disk_usage = Vec::new();
    let mut disk_usage_status = AsyncStatus::Ready;
    let mut disk_usage_message = None;

    match run_recorded_command(
        &mut snapshot,
        runner,
        "docker",
        &[
            "image",
            "ls",
            "--all",
            "--format",
            "{{json .}}",
            "--digests",
        ],
        15,
        "Docker image list failed",
    ) {
        Some(run) => match parse_docker_images(&run.stdout) {
            Ok(rows) => images = rows,
            Err(message) => snapshot.failures.push(parse_failure(message, run)),
        },
        None => {}
    }

    match run_recorded_command(
        &mut snapshot,
        runner,
        "docker",
        &["container", "ls", "--all", "--format", "{{json .}}"],
        15,
        "Docker container list failed",
    ) {
        Some(run) => match parse_docker_containers(&run.stdout) {
            Ok(rows) => containers = rows,
            Err(message) => snapshot.failures.push(parse_failure(message, run)),
        },
        None => {}
    }

    match run_recorded_command(
        &mut snapshot,
        runner,
        "docker",
        &["volume", "ls", "--format", "{{json .}}"],
        15,
        "Docker volume list failed",
    ) {
        Some(run) => match parse_docker_volumes(&run.stdout) {
            Ok(rows) => volumes = rows,
            Err(message) => snapshot.failures.push(parse_failure(message, run)),
        },
        None => {}
    }

    match run_recorded_command(
        &mut snapshot,
        runner,
        "docker",
        &["system", "df", "--format", "{{json .}}"],
        20,
        "Docker disk usage failed",
    ) {
        Some(run) => match parse_docker_disk_usage(&run.stdout) {
            Ok(rows) => disk_usage = rows,
            Err(message) => {
                disk_usage_status = AsyncStatus::Failed;
                disk_usage_message = Some(message.clone());
                snapshot.failures.push(parse_failure(message, run));
            }
        },
        None => {
            disk_usage_status = AsyncStatus::Failed;
            disk_usage_message = Some("Docker disk usage failed".to_string());
        }
    }

    attach_docker_image_actions(&mut images);
    attach_docker_container_actions(&mut containers);
    attach_docker_volume_actions(&mut volumes);

    let image_count = images.len();
    let container_count = containers.len();
    let running_container_count = containers
        .iter()
        .filter(|row| row.signals.contains(&PackageSignal::Running))
        .count();
    let volume_count = volumes.len();
    let dangling_image_count = images
        .iter()
        .filter(|row| row.signals.contains(&PackageSignal::Dangling))
        .count();
    let unused_image_count = images
        .iter()
        .filter(|row| row.signals.contains(&PackageSignal::Unused))
        .count();

    snapshot.packages.extend(images);
    snapshot.packages.extend(containers);
    snapshot.packages.extend(volumes);
    snapshot.docker = Some(DockerResourceHealth {
        image_count,
        container_count,
        running_container_count,
        volume_count,
        dangling_image_count,
        unused_image_count,
        disk_usage,
        disk_usage_status,
        disk_usage_message,
    });

    finish(snapshot)
}

pub(super) fn push_docker_paths(snapshot: &mut ManagerSnapshot, home: Option<&Path>) {
    if let Some(home) = home {
        snapshot.paths.push(path_info(
            "Docker config",
            PathKind::DockerConfig,
            home.join(".docker").display().to_string(),
        ));
        snapshot.paths.push(path_info(
            "Docker buildx",
            PathKind::DockerBuildx,
            home.join(".docker/buildx").display().to_string(),
        ));
        snapshot.paths.push(path_info(
            "Docker Desktop data",
            PathKind::DockerDesktopData,
            home.join("Library/Containers/com.docker.docker/Data")
                .display()
                .to_string(),
        ));
    }
}

pub(super) fn push_docker_commands(snapshot: &mut ManagerSnapshot) {
    snapshot
        .commands
        .push(envelope("docker", &["system", "df", "-v"], 20_000));
    snapshot.commands.push(envelope(
        "docker",
        &["image", "prune", "--all", "--filter", "until=168h"],
        0,
    ));
    snapshot
        .commands
        .push(envelope("docker", &["builder", "prune"], 0));
    snapshot
        .commands
        .push(envelope("docker", &["volume", "prune"], 0));
    snapshot
        .commands
        .push(envelope("docker", &["system", "prune"], 0));
}

pub(super) fn parse_docker_version(stdout: &str) -> String {
    let line = stdout.lines().next().unwrap_or("").trim();
    line.strip_prefix("Docker version ")
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(line)
        .to_string()
}

pub(super) fn parse_docker_images(stdout: &str) -> Result<Vec<PackageRow>, String> {
    let mut rows = Vec::new();
    for value in parse_json_lines(stdout)? {
        let repository = json_string(value.get("Repository")).unwrap_or_default();
        let tag = json_string(value.get("Tag")).unwrap_or_else(|| "unknown".to_string());
        let id = json_string(value.get("ID")).unwrap_or_else(|| "unknown".to_string());
        let digest = json_string(value.get("Digest"));
        let size = json_string(value.get("Size")).unwrap_or_else(|| "unknown".to_string());
        let containers = json_string(value.get("Containers")).unwrap_or_default();
        let name = if repository == "<none>" {
            id.clone()
        } else if tag == "<none>" || tag.is_empty() {
            repository.clone()
        } else {
            format!("{repository}:{tag}")
        };
        let mut row = package_row(
            name,
            size,
            None,
            "docker image ls --all",
            PackageKind::DockerImage,
        );
        row.path = digest.filter(|value| value != "<none>");
        if repository == "<none>" || tag == "<none>" {
            push_signal(&mut row, PackageSignal::Dangling);
        }
        if containers == "0" {
            push_signal(&mut row, PackageSignal::Unused);
        }
        rows.push(row);
    }

    rows.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(rows)
}

pub(super) fn parse_docker_containers(stdout: &str) -> Result<Vec<PackageRow>, String> {
    let mut rows = Vec::new();
    for value in parse_json_lines(stdout)? {
        let id = json_string(value.get("ID")).unwrap_or_else(|| "unknown".to_string());
        let image = json_string(value.get("Image")).unwrap_or_else(|| "unknown".to_string());
        let names = json_string(value.get("Names")).unwrap_or_else(|| id.clone());
        let status = json_string(value.get("Status")).unwrap_or_else(|| "unknown".to_string());
        let mut row = package_row(
            names,
            status.clone(),
            None,
            format!("docker container ls --all · {image}").as_str(),
            PackageKind::DockerContainer,
        );
        row.source = format!("{} · container {id}", row.source);
        if status.to_ascii_lowercase().starts_with("up ") {
            push_signal(&mut row, PackageSignal::Running);
        } else {
            push_signal(&mut row, PackageSignal::Stopped);
        }
        rows.push(row);
    }

    rows.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(rows)
}

pub(super) fn parse_docker_volumes(stdout: &str) -> Result<Vec<PackageRow>, String> {
    let mut rows = Vec::new();
    for value in parse_json_lines(stdout)? {
        let name = json_string(value.get("Name")).unwrap_or_else(|| "unknown".to_string());
        let driver = json_string(value.get("Driver")).unwrap_or_else(|| "unknown".to_string());
        let mountpoint = json_string(value.get("Mountpoint"));
        rows.push(package_row(
            name,
            driver,
            mountpoint,
            "docker volume ls",
            PackageKind::DockerVolume,
        ));
    }

    rows.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(rows)
}

pub(super) fn parse_docker_disk_usage(stdout: &str) -> Result<Vec<DockerDiskUsageRow>, String> {
    parse_json_lines(stdout)?
        .into_iter()
        .map(|value| {
            Ok(DockerDiskUsageRow {
                resource_type: docker_json_string_any(&value, &["Type"])
                    .ok_or_else(|| "docker system df row is missing Type".to_string())?,
                total_count: docker_json_string_any(&value, &["TotalCount", "Total"])
                    .unwrap_or_else(|| "-".to_string()),
                active_count: docker_json_string_any(&value, &["ActiveCount", "Active"])
                    .unwrap_or_else(|| "-".to_string()),
                size: docker_json_string_any(&value, &["Size"]).unwrap_or_else(|| "-".to_string()),
                reclaimable: docker_json_string_any(&value, &["Reclaimable"])
                    .unwrap_or_else(|| "-".to_string()),
            })
        })
        .collect()
}

pub(super) fn docker_json_string_any(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(|value| {
                value
                    .as_str()
                    .map(str::to_string)
                    .or_else(|| Some(value.to_string()))
            })
            .filter(|value| !value.is_empty())
    })
}

pub(super) fn parse_json_lines(stdout: &str) -> Result<Vec<Value>, String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_str(line).map_err(|err| format!("{err}: {line}")))
        .collect()
}

pub(super) fn attach_docker_image_actions(rows: &mut [PackageRow]) {
    for row in rows {
        row.actions.push(envelope_owned(
            "docker",
            vec!["image".to_string(), "inspect".to_string(), row.name.clone()],
            0,
        ));
        row.actions.push(envelope_owned(
            "docker",
            vec!["image".to_string(), "rm".to_string(), row.name.clone()],
            0,
        ));
    }
}

pub(super) fn attach_docker_container_actions(rows: &mut [PackageRow]) {
    for row in rows {
        let Some(id) = row
            .source
            .rsplit_once("container ")
            .map(|(_, id)| id.to_string())
        else {
            continue;
        };
        row.actions.push(envelope_owned(
            "docker",
            vec!["container".to_string(), "inspect".to_string(), id.clone()],
            0,
        ));
        if row.signals.contains(&PackageSignal::Stopped) {
            row.actions.push(envelope_owned(
                "docker",
                vec!["container".to_string(), "rm".to_string(), id],
                0,
            ));
        }
    }
}

pub(super) fn attach_docker_volume_actions(rows: &mut [PackageRow]) {
    for row in rows {
        row.actions.push(envelope_owned(
            "docker",
            vec![
                "volume".to_string(),
                "inspect".to_string(),
                row.name.clone(),
            ],
            0,
        ));
        row.actions.push(envelope_owned(
            "docker",
            vec!["volume".to_string(), "rm".to_string(), row.name.clone()],
            0,
        ));
    }
}
