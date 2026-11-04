mod android_sdk;
mod bun;
mod cargo;
mod cleanup;
mod docker;
mod fvm;
mod homebrew;
mod maven;
mod node;
mod pip;
mod scan_support;
#[cfg(test)]
mod test_support;
mod uv;

use crate::command::{run_command, run_command_owned};
use crate::disk_usage::disk_usage;
use crate::types::{
    AsyncStatus, DiskUsageStatus, ManagerId, ManagerScanProgress, ManagerScanSnapshot,
    ManagerSnapshot, ManagerStatus,
};
use std::path::Path;
use std::time::Instant;

pub(crate) use cleanup::run_cache_cleanup_with_runner;
pub(crate) use maven::repository_for_maintenance as maven_repository_for_maintenance;
pub(crate) use node::{run_npm_maintenance_with_runner, run_pnpm_maintenance_with_runner};
pub(crate) use android_sdk::run_android_sdk_uninstall_with_runner;

pub(crate) fn scan_manager_snapshot(
    manager: ManagerId,
    progress: &dyn Fn(ManagerScanProgress),
) -> ManagerScanSnapshot {
    let started = Instant::now();
    progress(ManagerScanProgress::Reading);
    let mut snapshot = scan_single_manager(manager);
    measure_paths(&mut snapshot, progress);
    hydrate_supplements(manager, &mut snapshot, progress);
    let problems = scan_problems(&snapshot);

    ManagerScanSnapshot {
        scan_duration_ms: started.elapsed().as_millis(),
        diagnostics: crate::scan_diagnostics::collect(&snapshot),
        problems,
        manager: snapshot,
    }
}

fn measure_paths(snapshot: &mut ManagerSnapshot, progress: &dyn Fn(ManagerScanProgress)) {
    let total = snapshot.paths.len();
    progress(ManagerScanProgress::Measuring {
        completed: 0,
        total,
    });
    for (index, path) in snapshot.paths.iter_mut().enumerate() {
        path.size = disk_usage(Path::new(&path.path));
        progress(ManagerScanProgress::Measuring {
            completed: index + 1,
            total,
        });
    }
}

fn hydrate_supplements(
    manager: ManagerId,
    snapshot: &mut ManagerSnapshot,
    progress: &dyn Fn(ManagerScanProgress),
) {
    if manager == ManagerId::Homebrew
        && snapshot
            .homebrew
            .as_ref()
            .is_some_and(|homebrew| matches!(homebrew.cleanup.status, AsyncStatus::Pending))
    {
        progress(ManagerScanProgress::HydratingHomebrew);
        let preview = homebrew::hydrate_homebrew_cleanup_with_runner(&run_command);
        if let Some(homebrew) = snapshot.homebrew.as_mut() {
            homebrew.cleanup = preview;
        }
    }

    if manager == ManagerId::Pip {
        let python = snapshot.pip.as_ref().and_then(|pip| {
            matches!(pip.outdated_status, AsyncStatus::Pending)
                .then(|| pip.python_executable.clone())
        });
        if let Some(python) = python {
            progress(ManagerScanProgress::HydratingPip);
            let preview = pip::hydrate_pip_outdated_with_runner(&python, &run_command_owned);
            pip::merge_pip_outdated(snapshot, &preview);
        }
    }
}

fn scan_problems(snapshot: &ManagerSnapshot) -> Option<String> {
    let mut messages = Vec::new();
    for failure in &snapshot.failures {
        messages.push(failure.message.clone());
    }
    if matches!(snapshot.status, ManagerStatus::Failed) {
        messages.push("管理器扫描失败".into());
    }
    if let Some(homebrew) = snapshot.homebrew.as_ref() {
        if matches!(homebrew.cleanup.status, AsyncStatus::Failed) {
            messages.push(
                homebrew
                    .cleanup
                    .message
                    .clone()
                    .unwrap_or_else(|| "Homebrew 清理预演失败".into()),
            );
        }
    }
    if let Some(pip) = snapshot.pip.as_ref() {
        if matches!(pip.outdated_status, AsyncStatus::Failed) {
            messages.push(
                pip.outdated_message
                    .clone()
                    .unwrap_or_else(|| "pip 更新检查失败".into()),
            );
        }
    }
    for path in &snapshot.paths {
        if matches!(
            path.size.status,
            DiskUsageStatus::Error | DiskUsageStatus::PermissionDenied
        ) || path.size.skipped > 0
        {
            messages.push(format!(
                "{}：{}",
                path.label,
                path.size
                    .message
                    .clone()
                    .unwrap_or_else(|| "目录读取不完整".into())
            ));
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut unique = Vec::new();
    for message in messages {
        if seen.insert(message.clone()) {
            unique.push(message);
        }
    }
    if unique.is_empty() {
        None
    } else {
        Some(unique.join("；"))
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
        ManagerId::Fvm => fvm::scan_fvm(),
        ManagerId::AndroidSdk => android_sdk::scan_android_sdk(),
    }
}

#[cfg(test)]
mod tests {
    use super::scan_support::empty_snapshot;
    use super::{measure_paths, scan_problems};
    use crate::types::{
        CommandFailure, DiskUsage, DiskUsageStatus, FailureKind, ManagerId, ManagerStatus, PathInfo,
        PathKind,
    };
    #[cfg(unix)]
    use std::path::Path;

    fn disk_usage(status: DiskUsageStatus, message: Option<&str>, skipped: u64) -> DiskUsage {
        DiskUsage {
            status,
            bytes: None,
            human: None,
            files: 0,
            directories: 0,
            skipped,
            message: message.map(str::to_string),
        }
    }

    #[test]
    fn problems_name_failures_and_unreadable_paths_once() {
        let mut snapshot = empty_snapshot(ManagerId::Npm, "npm");
        snapshot.status = ManagerStatus::Partial;
        snapshot.failures.push(CommandFailure {
            kind: FailureKind::CommandFailed,
            message: "inventory failed".into(),
            command: None,
            stdout: String::new(),
            stderr: String::new(),
        });
        snapshot.paths.push(PathInfo {
            label: "Cache".into(),
            kind: PathKind::Cache,
            path: "/cache".into(),
            size: disk_usage(
                DiskUsageStatus::PermissionDenied,
                Some("permission denied"),
                0,
            ),
        });
        snapshot.paths.push(PathInfo {
            label: "Cache".into(),
            kind: PathKind::Cache,
            path: "/cache".into(),
            size: disk_usage(
                DiskUsageStatus::PermissionDenied,
                Some("permission denied"),
                0,
            ),
        });

        assert_eq!(
            scan_problems(&snapshot).as_deref(),
            Some("inventory failed；Cache：permission denied")
        );
    }

    #[cfg(unix)]
    fn assert_uv_linked_directories_have_no_read_problems(create_link: fn(&Path, &Path)) {
        use std::fs;

        let root = tempfile::tempdir().expect("create uv directories");
        let mut snapshot = empty_snapshot(ManagerId::Uv, "uv");
        snapshot.status = ManagerStatus::Ready;
        for (label, kind, directory) in [
            ("uv tools", PathKind::UvTools, "tools"),
            (
                "uv Python installations",
                PathKind::UvPythonInstallations,
                "python",
            ),
            ("uv cache", PathKind::UvCache, "cache"),
        ] {
            let path = root.path().join(directory);
            fs::create_dir(&path).expect("create uv directory");
            let file = path.join("original");
            fs::write(&file, b"uv installed data").expect("write original file");
            create_link(&file, &path.join("linked"));
            snapshot.paths.push(crate::disk_usage::path_info(
                label,
                kind,
                path.to_string_lossy().into_owned(),
            ));
        }

        measure_paths(&mut snapshot, &|_| {});

        assert_eq!(scan_problems(&snapshot), None);
        for path in snapshot.paths {
            assert_eq!(path.size.status, DiskUsageStatus::Ready);
            assert_eq!(path.size.skipped, 0, "{}", path.label);
            assert!(path.size.message.is_none(), "{}", path.label);
        }
    }

    #[cfg(unix)]
    #[test]
    fn uv_symlinked_directories_have_no_read_problems() {
        assert_uv_linked_directories_have_no_read_problems(|source, link| {
            std::os::unix::fs::symlink(source, link).expect("create symlink");
        });
    }

    #[cfg(unix)]
    #[test]
    fn uv_hardlinked_directories_have_no_read_problems() {
        assert_uv_linked_directories_have_no_read_problems(|source, link| {
            std::fs::hard_link(source, link).expect("create hardlink");
        });
    }

    #[cfg(unix)]
    #[test]
    fn uv_unreadable_subdirectories_still_report_read_problems() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().expect("create uv cache");
        fs::write(root.path().join("readable"), b"cache data").expect("write readable data");
        let unreadable = root.path().join("unreadable");
        fs::create_dir(&unreadable).expect("create unreadable directory");
        fs::write(unreadable.join("data"), b"cache data").expect("write unreadable data");
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000))
            .expect("restrict directory permissions");
        // A root test runner can bypass filesystem permissions.
        if fs::read_dir(&unreadable).is_ok() {
            fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o700)).unwrap();
            return;
        }
        let mut snapshot = empty_snapshot(ManagerId::Uv, "uv");
        snapshot.status = ManagerStatus::Ready;
        snapshot.paths.push(crate::disk_usage::path_info(
            "uv cache",
            PathKind::UvCache,
            root.path().to_string_lossy().into_owned(),
        ));

        measure_paths(&mut snapshot, &|_| {});
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o700))
            .expect("restore directory permissions");

        let usage = &snapshot.paths[0].size;
        assert_eq!(usage.status, DiskUsageStatus::Ready);
        assert_eq!(usage.files, 1);
        assert_eq!(usage.skipped, 1);
        assert!(usage.bytes.unwrap() > 0);
        let problems = scan_problems(&snapshot).expect("report unreadable uv directory");
        assert!(problems.starts_with("uv cache：Could not read "));
        assert!(problems.contains(unreadable.to_string_lossy().as_ref()));
    }

    #[test]
    fn failed_manager_reports_a_failure_even_without_command_failures() {
        let mut snapshot = empty_snapshot(ManagerId::Npm, "npm");
        snapshot.status = ManagerStatus::Failed;

        assert_eq!(
            scan_problems(&snapshot).as_deref(),
            Some("管理器扫描失败")
        );
    }
}
