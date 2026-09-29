use super::scan_support::{empty_snapshot, finish, package_row, push_signal, trimmed};
use crate::command::{envelope_owned, parse_failure, run_command, run_recorded_command};
use crate::disk_usage::path_info;
use crate::types::{
    CommandFailure, CommandRun, ManagerId, ManagerSnapshot, PackageKind, PackageRow, PackageSignal,
    PathKind,
};
use serde_json::Value;
use std::fs;
use std::time::Duration;

pub(super) fn scan_fvm() -> ManagerSnapshot {
    scan_fvm_with_runner(&run_command)
}

fn scan_fvm_with_runner<F>(runner: &F) -> ManagerSnapshot
where
    F: Fn(&str, &[&str], Duration) -> Result<CommandRun, CommandFailure>,
{
    let mut snapshot = empty_snapshot(ManagerId::Fvm, "FVM");

    let version_run = match run_recorded_command(
        &mut snapshot,
        runner,
        "fvm",
        &["--version"],
        5,
        "FVM version probe failed",
    ) {
        Some(run) => run,
        None => return finish(snapshot),
    };
    snapshot.version = Some(trimmed(version_run.stdout));

    // Paths come from `fvm api context`, which also reports the global cache
    // link. The link itself is only read, never followed for measurement.
    let mut global_version: Option<String> = None;
    if let Some(run) = run_recorded_command(
        &mut snapshot,
        runner,
        "fvm",
        &["api", "context"],
        5,
        "FVM context lookup failed",
    ) {
        match parse_fvm_context(&run.stdout) {
            Ok(context) => {
                snapshot.paths.push(path_info(
                    "FVM versions",
                    PathKind::FvmVersions,
                    context.versions_path,
                ));
                if let Some(git_cache) = context.git_cache_path {
                    snapshot.paths.push(path_info(
                        "FVM git cache",
                        PathKind::FvmGitCache,
                        git_cache,
                    ));
                }
                global_version = context
                    .global_link
                    .as_deref()
                    .and_then(resolve_global_version);
            }
            Err(message) => snapshot.failures.push(parse_failure(message, run)),
        }
    }

    if let Some(run) = run_recorded_command(
        &mut snapshot,
        runner,
        "fvm",
        &["api", "list"],
        15,
        "FVM version list failed",
    ) {
        match parse_fvm_version_list(&run.stdout, global_version.as_deref()) {
            Ok(rows) => snapshot.packages = rows,
            Err(message) => snapshot.failures.push(parse_failure(message, run)),
        }
    }

    finish(snapshot)
}

struct FvmContext {
    versions_path: String,
    git_cache_path: Option<String>,
    global_link: Option<String>,
}

fn parse_fvm_context(stdout: &str) -> Result<FvmContext, String> {
    let value: Value = serde_json::from_str(stdout)
        .map_err(|err| format!("Could not parse FVM context: {err}"))?;
    let context = value
        .get("context")
        .and_then(Value::as_object)
        .ok_or_else(|| "FVM context output has no context object".to_string())?;

    let versions_path = context
        .get("versionsCachePath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "FVM context output has no versions cache path".to_string())?
        .to_string();
    let git_cache_path = context
        .get("gitCachePath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let global_link = context
        .get("globalCacheLink")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    Ok(FvmContext {
        versions_path,
        git_cache_path,
        global_link,
    })
}

/// The global cache link points at the default SDK when one is set. A missing
/// or unreadable link only means no global default, never a scan failure.
fn resolve_global_version(link: &str) -> Option<String> {
    let target = fs::read_link(link).ok()?;
    target
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

fn parse_fvm_version_list(
    stdout: &str,
    global_version: Option<&str>,
) -> Result<Vec<PackageRow>, String> {
    let value: Value = serde_json::from_str(stdout)
        .map_err(|err| format!("Could not parse FVM version list: {err}"))?;
    let versions = value
        .get("versions")
        .and_then(Value::as_array)
        .ok_or_else(|| "FVM version list output has no versions array".to_string())?;
    let unreferenced = value
        .get("unreferencedVersions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut sortable = Vec::with_capacity(versions.len());
    for entry in versions {
        let Some(name) = entry.get("name").and_then(Value::as_str) else {
            continue;
        };
        let sdk = entry
            .get("flutterSdkVersion")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or(name);
        let dart = entry
            .get("dartSdkVersion")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        let version = match dart {
            Some(dart) => format!("{sdk} · Dart {dart}"),
            None => sdk.to_string(),
        };
        let mut row = package_row(
            "flutter".to_string(),
            version,
            entry
                .get("directory")
                .and_then(Value::as_str)
                .map(str::to_string),
            "fvm api list",
            PackageKind::FlutterVersion,
        );
        if global_version.is_some_and(|global| {
            global == name
                || global == sdk
                || Some(global) == row.path.as_deref().and_then(|path| path.rsplit('/').next())
        }) {
            push_signal(&mut row, PackageSignal::Current);
        }
        if unreferenced.iter().any(|item| item == name) {
            push_signal(&mut row, PackageSignal::Unused);
        }
        // Copy-only: `fvm global` sets the default SDK without touching
        // projects. The install name (not the SDK version) addresses it, so
        // the action is attached here where the name is still known.
        // `fvm use` is project-scoped and stays out of v1.
        row.actions.push(envelope_owned(
            "fvm",
            vec!["global".to_string(), name.to_string()],
            0,
        ));
        sortable.push((semver_sort_key(sdk), name.to_string(), row));
    }

    sortable.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    Ok(sortable.into_iter().map(|(_, _, row)| row).collect())
}

fn semver_sort_key(version: &str) -> (u64, u64, u64) {
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

#[cfg(test)]
mod tests {
    use super::{
        parse_fvm_context, parse_fvm_version_list, resolve_global_version, scan_fvm_with_runner,
    };
    use crate::managers::test_support::{fake_run, temp_dir};
    use crate::types::{
        CommandFailure, CommandRun, ManagerStatus, PackageKind, PackageSignal, PathKind,
    };
    use std::fs;
    use std::time::Duration;

    const LIST_JSON: &str = r#"{
        "size": "1.51 GB",
        "versions": [
            {
                "name": "3.38.0",
                "type": "release",
                "directory": "/Users/sunven/fvm/versions/3.38.0",
                "flutterSdkVersion": "3.38.0",
                "dartSdkVersion": "3.10.0",
                "isSetup": true
            },
            {
                "name": "3.47.5",
                "type": "release",
                "directory": "/Users/sunven/fvm/versions/3.47.5",
                "flutterSdkVersion": "3.47.5",
                "dartSdkVersion": "3.13.4",
                "isSetup": true
            }
        ],
        "projects": ["/Users/sunven/work/app"],
        "unreferencedVersions": ["3.38.0"]
    }"#;

    const CONTEXT_JSON: &str = r#"{
        "context": {
            "fvmDir": "/Users/sunven/fvm",
            "fvmVersion": "4.3.1",
            "gitCachePath": "/Users/sunven/fvm/cache.git",
            "globalCacheLink": "/Users/sunven/fvm/default",
            "versionsCachePath": "/Users/sunven/fvm/versions"
        }
    }"#;

    fn runner(
        program: &str,
        args: &[&str],
        timeout: Duration,
    ) -> Result<CommandRun, CommandFailure> {
        assert_eq!(program, "fvm");
        match args {
            ["--version"] => Ok(fake_run(program, args, timeout, "4.3.1\n")),
            ["api", "context"] => Ok(fake_run(program, args, timeout, CONTEXT_JSON)),
            ["api", "list"] => Ok(fake_run(program, args, timeout, LIST_JSON)),
            _ => panic!("unexpected command: {program} {args:?}"),
        }
    }

    #[test]
    fn parse_version_list_reads_sdks_and_dart_versions() {
        let rows = parse_fvm_version_list(LIST_JSON, None).expect("parse fvm list");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].version, "3.47.5 · Dart 3.13.4");
        assert_eq!(rows[0].name, "flutter");
        assert_eq!(rows[0].kind, PackageKind::FlutterVersion);
        assert_eq!(
            rows[0].path.as_deref(),
            Some("/Users/sunven/fvm/versions/3.47.5")
        );
        assert_eq!(rows[1].version, "3.38.0 · Dart 3.10.0");
    }

    #[test]
    fn parse_version_list_marks_global_and_unreferenced() {
        let rows = parse_fvm_version_list(LIST_JSON, Some("3.47.5")).expect("parse fvm list");

        assert!(rows[0].signals.contains(&PackageSignal::Current));
        assert!(!rows[0].signals.contains(&PackageSignal::Unused));
        assert!(rows[1].signals.contains(&PackageSignal::Unused));
        assert!(!rows[1].signals.contains(&PackageSignal::Current));
    }

    #[test]
    fn parse_version_list_tolerates_a_missing_dart_version() {
        let rows = parse_fvm_version_list(
            r#"{"versions": [{"name": "3.47.5", "directory": "/tmp/3.47.5", "flutterSdkVersion": "3.47.5"}]}"#,
            None,
        )
        .expect("parse fvm list");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].version, "3.47.5");
    }

    #[test]
    fn parse_context_reads_versions_and_git_cache_paths() {
        let context = parse_fvm_context(CONTEXT_JSON).expect("parse fvm context");

        assert_eq!(context.versions_path, "/Users/sunven/fvm/versions");
        assert_eq!(
            context.git_cache_path.as_deref(),
            Some("/Users/sunven/fvm/cache.git")
        );
        assert_eq!(
            context.global_link.as_deref(),
            Some("/Users/sunven/fvm/default")
        );
    }

    #[test]
    fn parse_context_rejects_output_without_a_versions_path() {
        assert!(parse_fvm_context(r#"{"context": {}}"#).is_err());
        assert!(parse_fvm_context("not json").is_err());
    }

    #[test]
    fn scan_fvm_collects_versions_paths_and_copy_actions() {
        let snapshot = scan_fvm_with_runner(&runner);

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.version.as_deref(), Some("4.3.1"));
        assert_eq!(snapshot.packages.len(), 2);
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::FvmVersions));
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::FvmGitCache));
        // No global link exists in this environment, so nothing is Current.
        assert!(snapshot
            .packages
            .iter()
            .all(|package| !package.signals.contains(&PackageSignal::Current)));
        assert!(snapshot
            .packages
            .iter()
            .any(|package| package.signals.contains(&PackageSignal::Unused)));
        assert!(snapshot.packages[0]
            .actions
            .iter()
            .any(|action| { action.preview == "fvm global 3.47.5" }));
        assert!(snapshot
            .commands
            .iter()
            .any(|command| command.preview == "fvm api list"));
    }

    #[cfg(unix)]
    #[test]
    fn scan_fvm_marks_the_global_default_as_current() {
        let root = temp_dir("fvm-global");
        let versions = root.path().join("versions");
        fs::create_dir_all(versions.join("3.47.5")).expect("create version dir");
        let link = root.path().join("default");
        std::os::unix::fs::symlink(versions.join("3.47.5"), &link).expect("create link");

        let context = format!(
            r#"{{"context": {{"versionsCachePath": "{}", "globalCacheLink": "{}"}}}}"#,
            versions.display(),
            link.display()
        );
        let local_runner = move |program: &str,
                                 args: &[&str],
                                 timeout: Duration|
              -> Result<CommandRun, CommandFailure> {
            assert_eq!(program, "fvm");
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "4.3.1\n")),
                ["api", "context"] => Ok(fake_run(program, args, timeout, &context)),
                ["api", "list"] => Ok(fake_run(program, args, timeout, LIST_JSON)),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        };

        let snapshot = scan_fvm_with_runner(&local_runner);

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        let current = snapshot
            .packages
            .iter()
            .find(|package| package.version.starts_with("3.47.5"))
            .expect("global package");
        assert!(current.signals.contains(&PackageSignal::Current));
    }

    #[test]
    fn scan_fvm_reports_missing_when_the_binary_is_absent() {
        let snapshot = scan_fvm_with_runner(&|program, _, _| {
            Err(CommandFailure {
                kind: crate::types::FailureKind::MissingBinary,
                message: format!("{program} is not installed or is not on PATH"),
                command: None,
                stdout: String::new(),
                stderr: String::new(),
            })
        });

        assert_eq!(snapshot.status, ManagerStatus::Missing);
        assert!(snapshot.packages.is_empty());
        assert!(snapshot.paths.is_empty());
    }

    #[test]
    fn scan_fvm_is_partial_when_the_version_list_fails() {
        let snapshot = scan_fvm_with_runner(&|program, args, timeout| {
            assert_eq!(program, "fvm");
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "4.3.1\n")),
                ["api", "context"] => Ok(fake_run(program, args, timeout, CONTEXT_JSON)),
                ["api", "list"] => Err(CommandFailure {
                    kind: crate::types::FailureKind::CommandFailed,
                    message: "FVM version list failed".to_string(),
                    command: None,
                    stdout: String::new(),
                    stderr: String::new(),
                }),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        });

        assert_eq!(snapshot.status, ManagerStatus::Partial);
        assert!(snapshot.packages.is_empty());
        assert!(!snapshot.paths.is_empty());
    }

    #[test]
    fn scan_fvm_is_ready_with_an_empty_list_when_no_versions_exist() {
        let snapshot = scan_fvm_with_runner(&|program, args, timeout| {
            assert_eq!(program, "fvm");
            match args {
                ["--version"] => Ok(fake_run(program, args, timeout, "4.3.1\n")),
                ["api", "context"] => Ok(fake_run(program, args, timeout, CONTEXT_JSON)),
                ["api", "list"] => Ok(fake_run(
                    program,
                    args,
                    timeout,
                    r#"{"versions": [], "unreferencedVersions": []}"#,
                )),
                _ => panic!("unexpected command: {program} {args:?}"),
            }
        });

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert!(snapshot.packages.is_empty());
    }

    #[test]
    fn resolve_global_version_returns_none_for_a_missing_link() {
        assert_eq!(resolve_global_version("/definitely/not/here"), None);
    }
}
