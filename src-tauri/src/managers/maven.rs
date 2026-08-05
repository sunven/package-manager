use super::scan_support::{
    empty_snapshot, expand_tilde, finish, home_dir, package_row, push_signal,
};
use crate::command::{command_failure, envelope, envelope_owned, push_command, run_command};
use crate::disk_usage::path_info;
use crate::types::{
    CommandFailure, CommandRun, FailureKind, ManagerId, ManagerSnapshot, MavenDuplicateArtifact,
    MavenRepositoryHealth, PackageKind, PackageRow, PackageSignal, PathKind, RepositoryScanStatus,
};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub(super) fn scan_maven() -> ManagerSnapshot {
    scan_maven_with_runner(&run_command)
}

fn scan_maven_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Maven, "Maven");

    let version_run = match runner("mvn", &["--version"], Duration::from_secs(5)) {
        Ok(run) if run.exit_code == Some(0) => run,
        Ok(run) => {
            snapshot.failures.push(command_failure(
                FailureKind::CommandFailed,
                "Maven version probe failed",
                run,
            ));
            return finish(snapshot);
        }
        Err(failure) => {
            snapshot.failures.push(failure);
            return finish(snapshot);
        }
    };

    push_command(&mut snapshot, "mvn", &["--version"], 5);
    snapshot.version = Some(parse_maven_version(&version_run.stdout));

    let maven_home = parse_maven_home(&version_run.stdout);
    let resolution = resolve_maven_local_repository(maven_home.as_deref());
    if let Some(message) = resolution.message.as_ref() {
        snapshot.failures.push(CommandFailure {
            kind: FailureKind::ParseFailure,
            message: message.clone(),
            command: None,
            stdout: String::new(),
            stderr: String::new(),
        });
    }

    snapshot.paths.push(path_info(
        "Local repository",
        PathKind::LocalRepository,
        resolution.path.display().to_string(),
    ));
    snapshot.commands.push(envelope(
        "mvn",
        &["dependency:purge-local-repository", "-DreResolve=false"],
        0,
    ));
    snapshot.commands.push(envelope(
        "mvn",
        &[
            "dependency:purge-local-repository",
            "-DactTransitively=false",
            "-DreResolve=false",
        ],
        0,
    ));

    let scan = scan_maven_repository(&resolution.path, MavenScanLimits::default());
    snapshot.packages = scan.packages;
    snapshot.maven = Some(scan.health);

    finish(snapshot)
}

struct MavenLocalRepositoryResolution {
    path: PathBuf,
    message: Option<String>,
}

#[derive(Clone, Copy)]
struct MavenScanLimits {
    max_scan_ms: u128,
    max_version_dirs: usize,
    max_rows_returned: usize,
}

impl Default for MavenScanLimits {
    fn default() -> Self {
        Self {
            max_scan_ms: 5_000,
            max_version_dirs: 100_000,
            max_rows_returned: 2_000,
        }
    }
}

struct MavenRepositoryScan {
    packages: Vec<PackageRow>,
    health: MavenRepositoryHealth,
}

#[derive(Default)]
struct MavenArtifactAccumulator {
    versions: BTreeSet<String>,
    path: Option<String>,
    file_count: usize,
    snapshot_count: usize,
}

fn parse_maven_version(stdout: &str) -> String {
    stdout
        .lines()
        .find(|line| line.trim_start().starts_with("Apache Maven"))
        .map(str::trim)
        .unwrap_or_else(|| stdout.lines().next().unwrap_or("unknown").trim())
        .to_string()
}

fn parse_maven_home(stdout: &str) -> Option<String> {
    stdout.lines().find_map(|line| {
        line.trim()
            .strip_prefix("Maven home:")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn resolve_maven_local_repository(maven_home: Option<&str>) -> MavenLocalRepositoryResolution {
    let home = home_dir();
    let user_settings = home.as_ref().map(|home| home.join(".m2/settings.xml"));
    let global_settings = maven_home.map(|home| Path::new(home).join("conf/settings.xml"));
    let fallback = home
        .as_ref()
        .map(|home| home.join(".m2/repository"))
        .unwrap_or_else(|| PathBuf::from(".m2/repository"));

    let mut messages = Vec::new();
    if let Some(path) = user_settings.as_ref() {
        match read_maven_local_repository_setting(path) {
            Ok(Some(value)) => {
                return MavenLocalRepositoryResolution {
                    path: interpolate_maven_path(value.as_str(), home.as_deref()),
                    message: None,
                }
            }
            Ok(None) => {}
            Err(message) => messages.push(message),
        }
    }

    if let Some(path) = global_settings.as_ref() {
        match read_maven_local_repository_setting(path) {
            Ok(Some(value)) => {
                return MavenLocalRepositoryResolution {
                    path: interpolate_maven_path(value.as_str(), home.as_deref()),
                    message: None,
                }
            }
            Ok(None) => {}
            Err(message) => messages.push(message),
        }
    }

    MavenLocalRepositoryResolution {
        path: fallback,
        message: (!messages.is_empty()).then(|| messages.join("; ")),
    }
}

fn read_maven_local_repository_setting(path: &Path) -> Result<Option<String>, String> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("Could not read {}: {err}", path.display())),
    };
    parse_maven_local_repository_setting(&contents)
        .map_err(|err| format!("Could not parse {}: {err}", path.display()))
}

fn parse_maven_local_repository_setting(contents: &str) -> Result<Option<String>, String> {
    let document = roxmltree::Document::parse(contents).map_err(|err| err.to_string())?;
    let root = document.root_element();
    if root.tag_name().name() != "settings" {
        return Ok(None);
    }

    Ok(root
        .children()
        .find(|node| node.is_element() && node.tag_name().name() == "localRepository")
        .and_then(|node| node.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

fn interpolate_maven_path(value: &str, home: Option<&Path>) -> PathBuf {
    let home_string = home
        .map(|home| home.display().to_string())
        .unwrap_or_else(|| env::var("HOME").unwrap_or_default());
    let interpolated = value
        .replace("${user.home}", home_string.as_str())
        .replace("${env.HOME}", home_string.as_str());
    expand_tilde(interpolated.as_str(), home)
}

fn scan_maven_repository(root: &Path, limits: MavenScanLimits) -> MavenRepositoryScan {
    let started = Instant::now();
    let mut stack = vec![root.to_path_buf()];
    let mut accumulators: BTreeMap<(String, String), MavenArtifactAccumulator> = BTreeMap::new();
    let mut scanned_version_dirs = 0_usize;
    let mut skipped = 0_usize;
    let mut partial_message = None;

    while let Some(path) = stack.pop() {
        if started.elapsed().as_millis() >= limits.max_scan_ms {
            partial_message = Some("Repository scan reached time limit".to_string());
            break;
        }
        if scanned_version_dirs >= limits.max_version_dirs {
            partial_message = Some("Repository scan reached version directory limit".to_string());
            break;
        }

        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            skipped += 1;
            continue;
        }
        if !metadata.is_dir() {
            continue;
        }

        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries.flatten().collect::<Vec<_>>(),
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        if let Some((group_id, artifact_id, version, file_count)) =
            maven_coordinate_from_version_dir(root, &path, &entries)
        {
            scanned_version_dirs += 1;
            let key = (group_id, artifact_id);
            let accumulator = accumulators.entry(key).or_default();
            accumulator.versions.insert(version.clone());
            accumulator.file_count += file_count;
            if version.to_ascii_uppercase().contains("SNAPSHOT") {
                accumulator.snapshot_count += 1;
            }
            accumulator.path = Some(path.display().to_string());
            continue;
        }

        for entry in entries {
            stack.push(entry.path());
        }
    }

    let mut rows = Vec::new();
    let mut snapshot_count = 0_usize;
    let mut duplicate_artifact_count = 0_usize;
    let mut version_count = 0_usize;
    let mut duplicates = Vec::new();

    for ((group_id, artifact_id), accumulator) in accumulators.iter() {
        let versions = accumulator.versions.iter().cloned().collect::<Vec<_>>();
        version_count += versions.len();
        snapshot_count += accumulator.snapshot_count;

        let mut row = package_row(
            format!("{group_id}:{artifact_id}"),
            maven_version_summary(&versions),
            accumulator.path.clone(),
            "maven local repository scan",
            PackageKind::MavenArtifact,
        );
        if versions.len() > 1 {
            duplicate_artifact_count += 1;
            push_signal(&mut row, PackageSignal::DuplicateVersions);
            duplicates.push(MavenDuplicateArtifact {
                coordinate: row.name.clone(),
                version_count: versions.len(),
                versions: versions.clone(),
            });
        }
        if accumulator.snapshot_count > 0 {
            push_signal(&mut row, PackageSignal::Snapshot);
        }
        attach_maven_actions(&mut row, group_id, artifact_id);
        rows.push(row);
    }

    rows.sort_by(|a, b| a.name.cmp(&b.name));
    if rows.len() > limits.max_rows_returned {
        rows.truncate(limits.max_rows_returned);
        partial_message = Some("Repository scan reached row limit".to_string());
    }

    duplicates.sort_by(|a, b| {
        b.version_count
            .cmp(&a.version_count)
            .then_with(|| a.coordinate.cmp(&b.coordinate))
    });
    duplicates.truncate(10);

    MavenRepositoryScan {
        health: MavenRepositoryHealth {
            local_repository: root.display().to_string(),
            artifact_count: accumulators.len(),
            version_count,
            snapshot_count,
            duplicate_artifact_count,
            top_duplicate_artifacts: duplicates,
            repository_scan_status: RepositoryScanStatus {
                partial: partial_message.is_some(),
                scanned_version_dirs,
                skipped,
                message: partial_message,
            },
        },
        packages: rows,
    }
}

fn maven_coordinate_from_version_dir(
    root: &Path,
    path: &Path,
    entries: &[fs::DirEntry],
) -> Option<(String, String, String, usize)> {
    let relative = path.strip_prefix(root).ok()?;
    let parts = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }

    let file_count = entries
        .iter()
        .filter(|entry| {
            entry
                .file_type()
                .map(|file_type| file_type.is_file())
                .unwrap_or(false)
        })
        .count();
    let has_marker = entries.iter().any(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        matches!(
            Path::new(&name).extension().and_then(|ext| ext.to_str()),
            Some("pom" | "jar" | "aar" | "module")
        ) || name.ends_with(".lastUpdated")
    });
    if !has_marker {
        return None;
    }

    let version = parts.last()?.clone();
    let artifact_id = parts.get(parts.len() - 2)?.clone();
    let group_id = parts[..parts.len() - 2].join(".");
    Some((group_id, artifact_id, version, file_count))
}

fn attach_maven_actions(row: &mut PackageRow, group_id: &str, artifact_id: &str) {
    let coordinate = format!("{group_id}:{artifact_id}");
    if row.version != "unknown" && !row.version.starts_with("multiple ") {
        row.actions.push(envelope_owned(
            "mvn",
            vec![
                "dependency:get".to_string(),
                format!("-Dartifact={coordinate}:{}", row.version),
            ],
            0,
        ));
    }
    row.actions.push(envelope_owned(
        "mvn",
        vec![
            "dependency:tree".to_string(),
            format!("-Dincludes={coordinate}"),
        ],
        0,
    ));
}

fn maven_version_summary(versions: &[String]) -> String {
    match versions {
        [] => "unknown".to_string(),
        [version] => version.clone(),
        _ => format!("multiple ({})", versions.len()),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_maven_local_repository_setting, scan_maven_repository, MavenScanLimits};
    use crate::managers::test_support::{temp_dir, write_file};
    use crate::types::PackageSignal;

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
        write_file(
            &root.path().join("org/example/tool/1.0.0/tool-1.0.0.pom"),
            b"<project />",
        );
        write_file(
            &root.path().join("org/example/tool/1.1.0/tool-1.1.0.jar"),
            b"jar",
        );
        write_file(
            &root
                .path()
                .join("org/example/snap/2.0-SNAPSHOT/snap-2.0-SNAPSHOT.pom"),
            b"<project />",
        );

        let scan = scan_maven_repository(
            root.path(),
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
}
