mod bun;
mod cargo;
mod docker;
mod homebrew;
mod maven;
mod node;
mod pip;
mod uv;

use crate::command::{
    command_failure, command_stdout, envelope, envelope_owned, parse_failure, push_command,
    run_command, run_command_owned, run_recorded_command, run_recorded_stdout,
};
#[cfg(test)]
use crate::disk_usage::disk_usage;
use crate::disk_usage::{format_bytes, parse_size, path_info};
use crate::types::*;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub(crate) use homebrew::hydrate_homebrew_cleanup_with_runner;
pub(crate) use pip::hydrate_pip_outdated_with_runner;

#[cfg(test)]
use self::{bun::*, cargo::*, docker::*, homebrew::*, maven::*, node::*, pip::*, uv::*};

pub(crate) fn scan_manager_snapshot(manager: ManagerId) -> ManagerScanSnapshot {
    let started = Instant::now();
    let manager = scan_single_manager(manager);

    ManagerScanSnapshot {
        scan_duration_ms: started.elapsed().as_millis(),
        manager,
    }
}

fn scan_single_manager(manager: ManagerId) -> ManagerSnapshot {
    match manager {
        ManagerId::Npm => node::scan_npm(),
        ManagerId::Pnpm => node::scan_pnpm(),
        ManagerId::Yarn => node::scan_yarn(),
        ManagerId::Nvm => node::scan_nvm(),
        ManagerId::Homebrew => homebrew::scan_homebrew(),
        ManagerId::Maven => maven::scan_maven(),
        ManagerId::Pip => pip::scan_pip(),
        ManagerId::Cargo => cargo::scan_cargo(),
        ManagerId::Docker => docker::scan_docker(),
        ManagerId::Bun => bun::scan_bun(),
        ManagerId::Uv => uv::scan_uv(),
    }
}

fn split_package_version(raw: &str) -> (String, String) {
    if let Some(index) = raw.rfind('@') {
        if index > 0 && index + 1 < raw.len() {
            return (raw[..index].to_string(), raw[index + 1..].to_string());
        }
    }

    (raw.to_string(), "unknown".to_string())
}

fn package_row(
    name: String,
    version: String,
    path: Option<String>,
    source: &str,
    kind: PackageKind,
) -> PackageRow {
    PackageRow {
        name,
        version,
        path,
        source: source.to_string(),
        kind,
        signals: Vec::new(),
        actions: Vec::new(),
    }
}

fn push_signal(package: &mut PackageRow, signal: PackageSignal) {
    if !package.signals.contains(&signal) {
        package.signals.push(signal);
    }
}

fn kind_rank(kind: PackageKind) -> u8 {
    match kind {
        PackageKind::Generic => 0,
        PackageKind::Formula => 1,
        PackageKind::Cask => 2,
        PackageKind::MavenArtifact => 3,
        PackageKind::PythonDistribution => 4,
        PackageKind::DockerImage => 5,
        PackageKind::DockerContainer => 6,
        PackageKind::DockerVolume => 7,
        PackageKind::BunPackage => 8,
        PackageKind::UvTool => 9,
        PackageKind::UvPython => 10,
    }
}

fn json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn expand_tilde(value: &str, home: Option<&Path>) -> PathBuf {
    if value == "~" {
        if let Some(home) = home {
            return home.to_path_buf();
        }
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = home {
            return home.join(rest);
        }
    }
    PathBuf::from(value)
}

fn attach_missing_paths(packages: &mut [PackageRow], root: &str) {
    for package in packages {
        if package.path.is_none() {
            package.path = Some(Path::new(root).join(&package.name).display().to_string());
        }
    }
}

fn finish(mut snapshot: ManagerSnapshot) -> ManagerSnapshot {
    if matches!(snapshot.status, ManagerStatus::Unsupported) {
        return snapshot;
    }

    if snapshot.version.is_none()
        && snapshot.failures.iter().any(|failure| {
            matches!(
                failure.kind,
                FailureKind::MissingBinary | FailureKind::MissingPath
            )
        })
    {
        snapshot.status = ManagerStatus::Missing;
    } else if !snapshot.packages.is_empty() || !snapshot.paths.is_empty() {
        if snapshot.failures.is_empty() {
            snapshot.status = ManagerStatus::Ready;
        } else {
            snapshot.status = ManagerStatus::Partial;
        }
    } else if snapshot.failures.is_empty() {
        snapshot.status = ManagerStatus::Ready;
    } else {
        snapshot.status = ManagerStatus::Failed;
    }

    snapshot
}

fn empty_snapshot(id: ManagerId, label: &str) -> ManagerSnapshot {
    ManagerSnapshot {
        id,
        label: label.to_string(),
        status: ManagerStatus::Failed,
        version: None,
        packages: Vec::new(),
        paths: Vec::new(),
        commands: Vec::new(),
        failures: Vec::new(),
        unsupported_reason: None,
        homebrew: None,
        maven: None,
        pip: None,
        docker: None,
    }
}

fn trimmed(value: String) -> String {
    value.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn parse_npm_packages_returns_empty_vec_when_dependencies_missing() {
        let packages =
            parse_npm_packages(r#"{"name":"npm","version":"10.0.0"}"#).expect("parse npm output");

        assert!(packages.is_empty());
    }

    #[test]
    fn parse_npm_packages_sorts_and_keeps_paths() {
        let packages = parse_npm_packages(
            r#"{
                "dependencies": {
                    "zeta": {"version": "2.0.0", "path": "/tmp/zeta"},
                    "alpha": {"version": "1.0.0", "path": "/tmp/alpha"}
                }
            }"#,
        )
        .expect("parse npm output");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "alpha");
        assert_eq!(packages[0].version, "1.0.0");
        assert_eq!(packages[0].path.as_deref(), Some("/tmp/alpha"));
        assert_eq!(packages[1].name, "zeta");
        assert_eq!(packages[1].version, "2.0.0");
        assert_eq!(packages[1].path.as_deref(), Some("/tmp/zeta"));
    }

    #[test]
    fn npx_cache_path_uses_npm_cache_subdirectory() {
        assert_eq!(npx_cache_path("/tmp/npm-cache"), "/tmp/npm-cache/_npx");
    }

    #[test]
    fn resolve_nvm_dir_uses_env_or_home_fallback() {
        assert_eq!(
            resolve_nvm_dir(Some("~/node/nvm"), Some(Path::new("/Users/sunven"))),
            PathBuf::from("/Users/sunven/node/nvm")
        );
        assert_eq!(
            resolve_nvm_dir(None, Some(Path::new("/Users/sunven"))),
            PathBuf::from("/Users/sunven/.nvm")
        );
        assert_eq!(resolve_nvm_dir(None, None), PathBuf::from(".nvm"));
    }

    #[test]
    fn scan_nvm_reads_installed_node_versions_from_nvm_dir() {
        let root = temp_dir("nvm");
        let _guard = TempDirGuard(root.clone());
        fs::create_dir_all(root.join("versions/node/v20.11.1/bin")).expect("create node version");
        fs::create_dir_all(root.join("versions/node/v18.19.0/bin")).expect("create node version");
        fs::create_dir_all(root.join("versions/node/not-a-version")).expect("create ignored dir");

        let snapshot = scan_nvm_with_dir(root.clone());

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.id, ManagerId::Nvm);
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::NvmDir && path.path == root.display().to_string()));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::NvmNodeVersions));
        assert_eq!(snapshot.packages.len(), 2);
        assert_eq!(snapshot.packages[0].name, "node");
        assert_eq!(snapshot.packages[0].version, "20.11.1");
        assert_eq!(snapshot.packages[1].version, "18.19.0");
        assert!(snapshot.packages[0]
            .actions
            .iter()
            .any(|action| action.preview == "nvm use 20.11.1"));
    }

    #[test]
    fn scan_nvm_reports_missing_when_nvm_dir_does_not_exist() {
        let root = temp_dir("missing-nvm");
        fs::remove_dir_all(&root).expect("remove temp dir");

        let snapshot = scan_nvm_with_dir(root);

        assert_eq!(snapshot.status, ManagerStatus::Missing);
        assert!(snapshot.packages.is_empty());
        assert!(matches!(
            snapshot.failures[0].kind,
            FailureKind::MissingPath
        ));
    }

    #[test]
    fn parse_pnpm_packages_reads_array_entries() {
        let packages = parse_pnpm_packages(
            r#"[
                {
                    "dependencies": {
                        "beta": {"version": "2.1.0", "path": "/tmp/beta"}
                    }
                },
                {
                    "dependencies": {
                        "alpha": {"version": "1.3.0", "path": "/tmp/alpha"}
                    }
                }
            ]"#,
        )
        .expect("parse pnpm output");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "alpha");
        assert_eq!(packages[0].version, "1.3.0");
        assert_eq!(packages[0].path.as_deref(), Some("/tmp/alpha"));
        assert_eq!(packages[1].name, "beta");
        assert_eq!(packages[1].version, "2.1.0");
        assert_eq!(packages[1].path.as_deref(), Some("/tmp/beta"));
    }

    #[test]
    fn parse_yarn_classic_packages_reads_tree_lines() {
        let packages = parse_yarn_classic_packages(
            r#"{"type":"tree","data":{"trees":[{"name":"@scope/tool@2.0.0"},{"name":"alpha@1.0.0"}]}}
{"type":"success","data":"Done"}"#,
        )
        .expect("parse yarn output");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "@scope/tool");
        assert_eq!(packages[0].version, "2.0.0");
        assert_eq!(packages[1].name, "alpha");
        assert_eq!(packages[1].version, "1.0.0");
    }

    #[test]
    fn parse_yarn_classic_packages_falls_back_to_human_list() {
        let packages = parse_yarn_classic_packages(
            r#"info "@scope/tool@2.0.0" has binaries:
  - tool
info "alpha@1.0.0" has binaries:
  - alpha
"#,
        )
        .expect("parse yarn fallback");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "@scope/tool");
        assert_eq!(packages[0].version, "2.0.0");
        assert_eq!(packages[1].name, "alpha");
        assert_eq!(packages[1].version, "1.0.0");
    }

    #[test]
    fn split_package_version_handles_scoped_packages() {
        let (name, version) = split_package_version("@scope/tool@2.0.0");

        assert_eq!(name, "@scope/tool");
        assert_eq!(version, "2.0.0");
    }

    #[test]
    fn parse_homebrew_list_versions_reads_names_and_versions() {
        let packages = parse_homebrew_list_versions(
            "node 24.1.0\npostgresql@16 16.8\nmulti-version 1.0 1.1\nnoversion\n",
            PackageKind::Formula,
            "brew list --formula --versions",
        );

        assert_eq!(packages.len(), 4);
        assert_eq!(packages[0].name, "node");
        assert_eq!(packages[0].version, "24.1.0");
        assert_eq!(packages[1].name, "postgresql@16");
        assert_eq!(packages[1].version, "16.8");
        assert_eq!(packages[2].name, "multi-version");
        assert_eq!(packages[2].version, "1.0 1.1");
        assert_eq!(packages[3].name, "noversion");
        assert_eq!(packages[3].version, "unknown");
    }

    #[test]
    fn parse_maven_settings_reads_only_top_level_local_repository() {
        let repository = parse_maven_local_repository_setting(
            r#"<settings>
                <servers>
                  <server>
                    <username>sunven</username>
                    <password>secret</password>
                    <localRepository>/wrong</localRepository>
                  </server>
                </servers>
                <localRepository>${user.home}/.cache/maven</localRepository>
              </settings>"#,
        )
        .expect("parse settings");

        assert_eq!(repository.as_deref(), Some("${user.home}/.cache/maven"));
    }

    #[test]
    fn parse_maven_settings_rejects_malformed_xml() {
        let error = parse_maven_local_repository_setting("<settings>").expect_err("parse failure");

        assert!(!error.is_empty());
    }

    #[test]
    fn scan_maven_repository_flags_duplicates_and_snapshots() {
        let root = temp_dir("maven-repo");
        let _guard = TempDirGuard(root.clone());
        write_file(
            &root.join("org/example/tool/1.0.0/tool-1.0.0.pom"),
            b"<project />",
        );
        write_file(&root.join("org/example/tool/1.1.0/tool-1.1.0.jar"), b"jar");
        write_file(
            &root.join("org/example/snap/2.0-SNAPSHOT/snap-2.0-SNAPSHOT.pom"),
            b"<project />",
        );

        let scan = scan_maven_repository(
            &root,
            MavenScanLimits {
                max_scan_ms: 5_000,
                max_version_dirs: 100,
                max_rows_returned: 100,
            },
        );

        assert_eq!(scan.health.artifact_count, 2);
        assert_eq!(scan.health.version_count, 3);
        assert_eq!(scan.health.snapshot_count, 1);
        assert_eq!(scan.health.duplicate_artifact_count, 1);

        let tool = scan
            .packages
            .iter()
            .find(|package| package.name == "org.example:tool")
            .expect("tool artifact");
        assert!(tool.signals.contains(&PackageSignal::DuplicateVersions));
        assert!(tool
            .actions
            .iter()
            .any(|action| action.preview.contains("dependency:tree")));

        let snap = scan
            .packages
            .iter()
            .find(|package| package.name == "org.example:snap")
            .expect("snapshot artifact");
        assert!(snap.signals.contains(&PackageSignal::Snapshot));
    }

    #[test]
    fn parse_pip_list_sorts_packages() {
        let packages = parse_pip_list(
            r#"[
                {"name": "requests", "version": "2.32.3"},
                {"name": "black", "version": "24.4.2"}
            ]"#,
            "/usr/bin/python3",
        )
        .expect("parse pip list");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "black");
        assert_eq!(packages[0].kind, PackageKind::PythonDistribution);
        assert_eq!(
            packages[0].source,
            "/usr/bin/python3 -m pip list --format=json"
        );
    }

    #[test]
    fn enrich_pip_from_inspect_marks_editable_direct_url_and_user_site() {
        let mut packages = parse_pip_list(
            r#"[{"name": "local-tool", "version": "0.1.0"}]"#,
            "/usr/bin/python3",
        )
        .expect("parse pip list");

        let enrichment = enrich_pip_from_inspect(
            &mut packages,
            r#"{
                "installed": [{
                    "metadata": {"name": "local-tool"},
                    "location": "/Users/sunven/Library/Python/3.12/lib/python/site-packages",
                    "editable_project_location": "/Users/sunven/github/local-tool",
                    "direct_url": {"url": "file:///Users/sunven/github/local-tool"}
                }]
            }"#,
        )
        .expect("inspect enrichment");

        let package = &packages[0];
        assert!(package.signals.contains(&PackageSignal::Editable));
        assert!(package.signals.contains(&PackageSignal::DirectUrl));
        assert!(package.signals.contains(&PackageSignal::UserSite));
        assert!(package.path.as_deref().unwrap().contains("local-tool"));
        assert!(enrichment.user_site.is_some());
    }

    #[test]
    fn parse_pip_outdated_reads_names() {
        let outdated = parse_pip_outdated(
            r#"[
                {"name": "requests", "version": "2.31.0", "latest_version": "2.32.3"},
                {"name": "black", "version": "23.0.0", "latest_version": "24.4.2"}
            ]"#,
        )
        .expect("parse outdated");

        assert_eq!(outdated, vec!["black".to_string(), "requests".to_string()]);
    }

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

    #[test]
    fn scan_homebrew_merges_outdated_leaves_paths_and_actions() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "Homebrew 4.4.0\n")),
                ["list", "--formula", "--versions"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "node 24.1.0\nripgrep 14.1.1\n",
                )),
                ["list", "--cask", "--versions"] => {
                    Ok(fake_run(program, args, timeout, "docker 4.39.0\n"))
                }
                ["outdated", "--json=v2"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    r#"{
                        "formulae": [{"name": "node"}],
                        "casks": [{"token": "docker"}]
                    }"#,
                )),
                ["leaves"] => Ok(fake_run(program, args, timeout, "node\n")),
                ["--prefix"] => Ok(fake_run(program, args, timeout, "/opt/homebrew\n")),
                ["--cache"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    "/Users/sunven/Library/Caches/Homebrew\n",
                )),
                ["--cellar"] => Ok(fake_run(program, args, timeout, "/opt/homebrew/Cellar\n")),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot = scan_homebrew_with_runner(&runner);

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.version.as_deref(), Some("4.4.0"));
        assert_eq!(snapshot.packages.len(), 3);
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::Cache));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::Cellar));

        let node = snapshot
            .packages
            .iter()
            .find(|package| package.name == "node")
            .expect("node row");
        assert!(node.signals.contains(&PackageSignal::Outdated));
        assert!(node.signals.contains(&PackageSignal::Leaf));
        assert!(node
            .actions
            .iter()
            .any(|action| action.preview == "brew upgrade node"));
        assert!(node
            .actions
            .iter()
            .any(|action| action.preview == "brew uses --installed node"));

        let docker = snapshot
            .packages
            .iter()
            .find(|package| package.name == "docker")
            .expect("docker row");
        assert_eq!(docker.kind, PackageKind::Cask);
        assert!(docker.signals.contains(&PackageSignal::Outdated));
        assert!(!docker.signals.contains(&PackageSignal::Leaf));
        assert!(docker
            .actions
            .iter()
            .any(|action| action.preview == "brew upgrade --cask docker"));

        let maintenance = snapshot.homebrew.expect("homebrew maintenance");
        assert_eq!(maintenance.formula_count, 2);
        assert_eq!(maintenance.cask_count, 1);
        assert_eq!(maintenance.outdated_count, 2);
        assert_eq!(maintenance.leaf_count, 1);
        assert_eq!(maintenance.cleanup.status, AsyncStatus::Pending);
    }

    #[test]
    fn scan_homebrew_reports_partial_when_optional_command_fails() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "Homebrew 4.4.0\n")),
                ["list", "--formula", "--versions"] => {
                    Ok(fake_run(program, args, timeout, "node 24.1.0\n"))
                }
                ["list", "--cask", "--versions"] => Ok(fake_run(program, args, timeout, "")),
                ["outdated", "--json=v2"] => {
                    Ok(fake_failed_run(program, args, timeout, "outdated failed"))
                }
                ["leaves"] => Ok(fake_run(program, args, timeout, "")),
                ["--prefix"] => Ok(fake_run(program, args, timeout, "/opt/homebrew\n")),
                ["--cache"] => Ok(fake_run(program, args, timeout, "/tmp/homebrew-cache\n")),
                ["--cellar"] => Ok(fake_run(program, args, timeout, "/opt/homebrew/Cellar\n")),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot = scan_homebrew_with_runner(&runner);

        assert_eq!(snapshot.status, ManagerStatus::Partial);
        assert_eq!(snapshot.packages.len(), 1);
        assert_eq!(snapshot.failures.len(), 1);
        assert!(matches!(
            snapshot.failures[0].kind,
            FailureKind::CommandFailed
        ));
    }

    #[test]
    fn scan_homebrew_reports_missing_when_brew_cannot_spawn() {
        let runner = |program: &str,
                      args: &[&str],
                      _timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "brew");
            assert_eq!(args, ["--version"]);
            Err(CommandFailure {
                kind: FailureKind::MissingBinary,
                message: "brew is not installed or is not on PATH".to_string(),
                command: Some(envelope("brew", &["--version"], 5_000)),
                stdout: String::new(),
                stderr: "not found".to_string(),
            })
        };

        let snapshot = scan_homebrew_with_runner(&runner);

        assert_eq!(snapshot.status, ManagerStatus::Missing);
        assert!(snapshot.packages.is_empty());
        assert!(snapshot.homebrew.is_none());
    }

    #[test]
    fn hydrate_homebrew_cleanup_preserves_raw_output_and_size() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "brew");
            assert_eq!(args, ["cleanup", "--dry-run"]);
            Ok(fake_run(
                program,
                args,
                timeout,
                "Would remove: /tmp/a (10MB)\nWould remove: /tmp/b (1.5MB)\n",
            ))
        };

        let preview = hydrate_homebrew_cleanup_with_runner(&runner);

        assert_eq!(preview.status, AsyncStatus::Ready);
        assert!(preview.raw_output.contains("/tmp/a"));
        assert_eq!(preview.reclaimed_bytes, Some(12_058_624));
        assert_eq!(preview.command.preview, "brew cleanup --dry-run");
    }

    #[test]
    fn hydrate_homebrew_cleanup_failure_returns_failed_preview() {
        let runner = |program: &str,
                      args: &[&str],
                      timeout: Duration|
         -> Result<CommandRun, CommandFailure> {
            Ok(fake_failed_run(program, args, timeout, "cleanup failed"))
        };

        let preview = hydrate_homebrew_cleanup_with_runner(&runner);

        assert_eq!(preview.status, AsyncStatus::Failed);
        assert!(preview.failure.is_some());
        assert_eq!(preview.raw_output, "");
    }

    #[test]
    fn path_info_defers_size_scan() {
        let info = path_info("Store", PathKind::Store, "/tmp/package-store".to_string());

        assert_eq!(info.size.status, DiskUsageStatus::Pending);
        assert_eq!(info.size.bytes, None);
        assert_eq!(info.size.files, 0);
        assert_eq!(info.size.directories, 0);
    }

    #[cfg(unix)]
    #[test]
    fn disk_usage_dedupes_hardlinks() {
        let root = temp_dir("disk-usage");
        let _guard = TempDirGuard(root.clone());
        let file_a = root.join("alpha.txt");
        let file_b = root.join("beta.txt");
        write_file(&file_a, b"package manager");
        fs::hard_link(&file_a, &file_b).expect("create hard link");

        let usage = disk_usage(&root);
        let metadata = fs::metadata(&file_a).expect("metadata");

        assert_eq!(usage.status, DiskUsageStatus::Ready);
        assert_eq!(usage.files, 1);
        assert_eq!(usage.skipped, 1);
        assert_eq!(usage.bytes, Some(metadata.blocks().saturating_mul(512)));
    }

    fn temp_dir(label: &str) -> PathBuf {
        let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "package-manager-control-center-{label}-{stamp}-{suffix}"
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn write_file(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        let mut file = fs::File::create(path).expect("create file");
        file.write_all(contents).expect("write file");
    }

    fn fake_run(program: &str, args: &[&str], timeout: Duration, stdout: &str) -> CommandRun {
        CommandRun {
            envelope: envelope(program, args, timeout.as_millis() as u64),
            stdout: stdout.to_string(),
            stderr: String::new(),
            exit_code: Some(0),
            duration_ms: 1,
        }
    }

    fn fake_failed_run(
        program: &str,
        args: &[&str],
        timeout: Duration,
        stderr: &str,
    ) -> CommandRun {
        CommandRun {
            envelope: envelope(program, args, timeout.as_millis() as u64),
            stdout: String::new(),
            stderr: stderr.to_string(),
            exit_code: Some(1),
            duration_ms: 1,
        }
    }

    struct TempDirGuard(PathBuf);

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
