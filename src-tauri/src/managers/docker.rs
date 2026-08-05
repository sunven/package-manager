use super::scan_support::{
    empty_snapshot, finish, home_dir, json_string, package_row, push_signal,
};
use crate::command::{envelope, envelope_owned, parse_failure, run_command, run_recorded_command};
use crate::disk_usage::path_info;
use crate::types::{
    AsyncStatus, CommandFailure, CommandRun, DockerDiskUsageRow, DockerResourceHealth, ManagerId,
    ManagerSnapshot, PackageKind, PackageRow, PackageSignal, PathKind,
};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

pub(super) fn scan_docker() -> ManagerSnapshot {
    scan_docker_with_runner_and_home(&run_command, home_dir().as_deref())
}

fn scan_docker_with_runner_and_home<F>(runner: &F, home: Option<&Path>) -> ManagerSnapshot
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

fn push_docker_paths(snapshot: &mut ManagerSnapshot, home: Option<&Path>) {
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

fn push_docker_commands(snapshot: &mut ManagerSnapshot) {
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

fn parse_docker_version(stdout: &str) -> String {
    let line = stdout.lines().next().unwrap_or("").trim();
    line.strip_prefix("Docker version ")
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(line)
        .to_string()
}

fn parse_docker_images(stdout: &str) -> Result<Vec<PackageRow>, String> {
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

fn parse_docker_containers(stdout: &str) -> Result<Vec<PackageRow>, String> {
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

fn parse_docker_volumes(stdout: &str) -> Result<Vec<PackageRow>, String> {
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

fn parse_docker_disk_usage(stdout: &str) -> Result<Vec<DockerDiskUsageRow>, String> {
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

fn docker_json_string_any(value: &Value, keys: &[&str]) -> Option<String> {
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

fn parse_json_lines(stdout: &str) -> Result<Vec<Value>, String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_str(line).map_err(|err| format!("{err}: {line}")))
        .collect()
}

fn attach_docker_image_actions(rows: &mut [PackageRow]) {
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

fn attach_docker_container_actions(rows: &mut [PackageRow]) {
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

fn attach_docker_volume_actions(rows: &mut [PackageRow]) {
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

#[cfg(test)]
mod tests {
    use super::{
        parse_docker_containers, parse_docker_disk_usage, parse_docker_images,
        parse_docker_volumes, scan_docker_with_runner_and_home,
    };
    use crate::command::envelope;
    use crate::managers::test_support::fake_run;
    use crate::types::{
        AsyncStatus, CommandFailure, CommandRun, FailureKind, ManagerStatus, PackageKind,
        PackageSignal, PathKind,
    };
    use std::path::Path;
    use std::time::Duration;

    #[test]
    fn parse_docker_images_marks_dangling_and_unused_rows() {
        let packages = parse_docker_images(
            r#"{"Repository":"node","Tag":"22-alpine","ID":"sha256:111","Digest":"sha256:aaa","Size":"165MB","Containers":"1"}
{"Repository":"<none>","Tag":"<none>","ID":"sha256:222","Digest":"<none>","Size":"20MB","Containers":"0"}"#,
        )
        .expect("parse docker images");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "node:22-alpine");
        assert_eq!(packages[0].version, "165MB");
        assert_eq!(packages[0].kind, PackageKind::DockerImage);
        assert_eq!(packages[0].path.as_deref(), Some("sha256:aaa"));
        assert_eq!(packages[1].name, "sha256:222");
        assert!(packages[1].signals.contains(&PackageSignal::Dangling));
        assert!(packages[1].signals.contains(&PackageSignal::Unused));
    }

    #[test]
    fn parse_docker_containers_marks_running_and_stopped_rows() {
        let packages = parse_docker_containers(
            r#"{"ID":"abc123","Image":"nginx:latest","Names":"web","Status":"Up 2 hours"}
{"ID":"def456","Image":"redis:7","Names":"cache","Status":"Exited (0) 1 day ago"}"#,
        )
        .expect("parse docker containers");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "cache");
        assert_eq!(packages[0].path, None);
        assert!(packages[0].source.contains("container def456"));
        assert!(packages[0].signals.contains(&PackageSignal::Stopped));
        assert_eq!(packages[1].name, "web");
        assert!(packages[1].signals.contains(&PackageSignal::Running));
    }

    #[test]
    fn parse_docker_volumes_reads_mountpoints() {
        let packages = parse_docker_volumes(
            r#"{"Name":"db-data","Driver":"local","Mountpoint":"/var/lib/docker/volumes/db-data/_data"}"#,
        )
        .expect("parse docker volumes");

        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].name, "db-data");
        assert_eq!(packages[0].version, "local");
        assert_eq!(packages[0].kind, PackageKind::DockerVolume);
        assert_eq!(
            packages[0].path.as_deref(),
            Some("/var/lib/docker/volumes/db-data/_data")
        );
    }

    #[test]
    fn parse_docker_disk_usage_reads_json_rows() {
        let rows = parse_docker_disk_usage(
            r#"{"Type":"Images","TotalCount":"2","ActiveCount":"1","Size":"185MB","Reclaimable":"20MB (10%)"}
{"Type":"Build Cache","Total":"4","Active":"0","Size":"1.2GB","Reclaimable":"1.2GB"}"#,
        )
        .expect("parse docker disk usage");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].resource_type, "Images");
        assert_eq!(rows[0].total_count, "2");
        assert_eq!(rows[0].active_count, "1");
        assert_eq!(rows[1].resource_type, "Build Cache");
        assert_eq!(rows[1].total_count, "4");
        assert_eq!(rows[1].active_count, "0");
    }

    #[test]
    fn scan_docker_collects_resources_paths_and_safe_commands() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "docker");
            match args {
                ["--version"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "Docker version 28.2.2, build e6534b4\n",
                )),
                ["image", "ls", "--all", "--format", "{{json .}}", "--digests"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    r#"{"Repository":"node","Tag":"22-alpine","ID":"sha256:111","Digest":"sha256:aaa","Size":"165MB","Containers":"0"}"#,
                )),
                ["container", "ls", "--all", "--format", "{{json .}}"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    r#"{"ID":"abc123","Image":"node:22-alpine","Names":"app","Status":"Exited (0) 1 day ago"}"#,
                )),
                ["volume", "ls", "--format", "{{json .}}"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    r#"{"Name":"app-cache","Driver":"local","Mountpoint":"/var/lib/docker/volumes/app-cache/_data"}"#,
                )),
                ["system", "df", "--format", "{{json .}}"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    r#"{"Type":"Images","TotalCount":"1","ActiveCount":"0","Size":"165MB","Reclaimable":"165MB (100%)"}"#,
                )),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot = scan_docker_with_runner_and_home(&runner, Some(Path::new("/Users/sunven")));

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.version.as_deref(), Some("28.2.2"));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::DockerDesktopData));
        assert!(snapshot
            .commands
            .iter()
            .any(|command| command.preview == "docker system prune"));
        assert_eq!(snapshot.packages.len(), 3);

        let docker = snapshot.docker.expect("docker health");
        assert_eq!(docker.image_count, 1);
        assert_eq!(docker.container_count, 1);
        assert_eq!(docker.volume_count, 1);
        assert_eq!(docker.unused_image_count, 1);
        assert_eq!(docker.disk_usage_status, AsyncStatus::Ready);
        assert_eq!(docker.disk_usage[0].resource_type, "Images");

        let container = snapshot
            .packages
            .iter()
            .find(|package| package.kind == PackageKind::DockerContainer)
            .expect("container row");
        assert!(container
            .actions
            .iter()
            .any(|action| action.preview == "docker container rm abc123"));
    }

    #[test]
    fn scan_docker_reports_missing_but_keeps_known_paths() {
        let runner = |program: &str,
                      args: &[&str],
                      _timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "docker");
            assert_eq!(args, ["--version"]);
            Err(CommandFailure {
                kind: FailureKind::MissingBinary,
                message: "docker is not installed or is not on PATH".to_string(),
                command: Some(envelope("docker", &["--version"], 5_000)),
                stdout: String::new(),
                stderr: "not found".to_string(),
            })
        };

        let snapshot = scan_docker_with_runner_and_home(&runner, Some(Path::new("/Users/sunven")));

        assert_eq!(snapshot.status, ManagerStatus::Missing);
        assert!(snapshot.packages.is_empty());
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::DockerConfig));
    }
}
