use super::*;
use std::os::unix::fs::symlink;

fn fixture(root: &Path, limit: usize) -> (DiskScanState, Arc<Job>) {
    let state = DiskScanState::load(PathBuf::from("/dev/null/disk-settings.json"));
    let prepared = prepare(root.to_str().unwrap()).unwrap();
    let job = state.install(&prepared).unwrap();
    run(&job, prepared, limit, |_| {});
    (state, job)
}

fn id(job: &Job, relative: &str) -> usize {
    let tree = job.tree.lock().unwrap();
    tree.nodes
        .iter()
        .enumerate()
        .find(|(id, _)| tree.path(*id) == tree.root.join(relative))
        .unwrap()
        .0
}

fn plan(state: &DiskScanState, job: &Job, names: &[&str]) -> Plan {
    let scan = job.tree.lock().unwrap().summary.scan_id.clone();
    state
        .prepare_removal(&scan, names.iter().map(|name| id(job, name)).collect())
        .unwrap()
}

fn execute_fake(plan: &Plan, trash: impl FnMut(&Path) -> Result<(), String>) -> Outcome {
    execute(
        plan,
        &AtomicBool::new(false),
        || Ok(Vec::new()),
        trash,
        |_| {},
        |_| {},
    )
}

#[test]
fn frozen_confirmation_rejects_root_protected_home_links_duplicates_and_mixed_parents() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("root");
    fs::create_dir_all(root.join("home/sub")).unwrap();
    fs::write(root.join("file"), b"x").unwrap();
    symlink(root.join("file"), root.join("link")).unwrap();
    let (state, job) = fixture(&root, MAX_ENTRIES);
    let scan = job.tree.lock().unwrap().summary.scan_id.clone();
    job.tree.lock().unwrap().protected_home = Some(
        observe_chain(&root.join("home").canonicalize().unwrap())
            .unwrap()
            .into_iter()
            .map(|(_, identity)| identity)
            .collect(),
    );
    for ids in [
        vec![0],
        vec![id(&job, "home")],
        vec![id(&job, "link")],
        vec![id(&job, "file"); 2],
        vec![id(&job, "home/sub"), id(&job, "file")],
    ] {
        assert!(state.prepare_removal(&scan, ids).is_err());
    }
    let first = plan(&state, &job, &["file"]);
    assert!(state
        .install(&prepare(root.to_str().unwrap()).unwrap())
        .is_err());
    assert!(state
        .prepare_removal(&scan, vec![id(&job, "file")])
        .is_err());
    state.cancel_removal(&first.id).unwrap();
    assert!(state.claim_removal(&first.id).is_err());
    let second = plan(&state, &job, &["file"]);
    assert_ne!(first.id, second.id);
}

#[test]
fn running_scan_has_no_removal_authority() {
    let base = tempfile::tempdir().unwrap();
    fs::write(base.path().join("file"), b"x").unwrap();
    let (state, job) = fixture(base.path(), MAX_ENTRIES);
    let scan = job.tree.lock().unwrap().summary.scan_id.clone();
    job.tree.lock().unwrap().summary.phase = Phase::Running;
    assert!(state
        .prepare_removal(&scan, vec![id(&job, "file")])
        .is_err());
}

#[test]
fn protected_home_ancestors_are_checked_by_identity_even_under_another_path() {
    let base = tempfile::tempdir().unwrap();
    fs::create_dir_all(base.path().join("original/home")).unwrap();
    let protected =
        observe_chain(&base.path().join("original/home").canonicalize().unwrap()).unwrap();
    fs::rename(base.path().join("original"), base.path().join("alias")).unwrap();
    let (state, job) = fixture(base.path(), MAX_ENTRIES);
    job.tree.lock().unwrap().protected_home = Some(
        protected
            .into_iter()
            .map(|(_, identity)| identity)
            .collect(),
    );
    let scan = job.tree.lock().unwrap().summary.scan_id.clone();
    for name in ["alias", "alias/home"] {
        assert!(state
            .prepare_removal(&scan, vec![id(&job, name)])
            .err()
            .unwrap()
            .contains("主目录"));
    }
}

#[cfg(target_os = "macos")]
#[test]
fn real_data_volume_alias_uses_the_same_home_and_mount_ancestor_identity() {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap())
        .canonicalize()
        .unwrap();
    let alias = Path::new("/System/Volumes/Data").join(home.strip_prefix("/").unwrap());
    if !alias.is_dir() {
        return;
    }
    let identity = Identity::read(&fs::symlink_metadata(&home).unwrap()).unwrap();
    assert_eq!(
        Some(identity.clone()),
        Identity::read(&fs::symlink_metadata(&alias).unwrap())
    );
    assert!(contains_mount(&home, &identity, true, &[alias.clone()]).unwrap());
    let parent = home.parent().unwrap();
    let parent_identity = Identity::read(&fs::symlink_metadata(parent).unwrap()).unwrap();
    assert!(contains_mount(parent, &parent_identity, true, &[alias]).unwrap());
}

#[test]
fn replaced_or_missing_objects_skip_and_other_targets_continue() {
    let base = tempfile::tempdir().unwrap();
    for name in ["gone", "replaced", "changed"] {
        fs::write(base.path().join(name), b"old").unwrap();
    }
    let (state, job) = fixture(base.path(), MAX_ENTRIES);
    let plan = plan(&state, &job, &["gone", "replaced", "changed"]);
    fs::remove_file(base.path().join("gone")).unwrap();
    fs::rename(base.path().join("replaced"), base.path().join("original")).unwrap();
    fs::write(base.path().join("replaced"), b"new object").unwrap();
    fs::write(base.path().join("changed"), b"same object, new contents").unwrap();
    let mut called = Vec::new();
    let result = execute_fake(&plan, |path| {
        called.push(path.to_owned());
        Ok(())
    });
    assert_eq!(
        result
            .results
            .iter()
            .map(|item| item.status.as_str())
            .collect::<Vec<_>>(),
        ["skipped", "skipped", "moved"]
    );
    assert_eq!(
        called,
        vec![base.path().join("changed").canonicalize().unwrap()]
    );
}

#[test]
fn ancestor_link_or_same_name_directory_replacement_cannot_redirect_removal() {
    for link in [false, true] {
        let base = tempfile::tempdir().unwrap();
        fs::create_dir(base.path().join("parent")).unwrap();
        fs::write(base.path().join("parent/file"), b"original").unwrap();
        let (state, job) = fixture(base.path(), MAX_ENTRIES);
        let plan = plan(&state, &job, &["parent/file"]);
        fs::rename(base.path().join("parent"), base.path().join("original")).unwrap();
        if link {
            symlink(base.path().join("original"), base.path().join("parent")).unwrap();
        } else {
            fs::create_dir(base.path().join("parent")).unwrap();
            fs::hard_link(
                base.path().join("original/file"),
                base.path().join("parent/file"),
            )
            .unwrap();
        }
        let result = execute_fake(&plan, |_| panic!("must not move changed path"));
        assert_eq!(result.results[0].status, "skipped");
    }
}

#[test]
fn incomplete_directory_moves_as_one_object_including_new_content_and_links() {
    let base = tempfile::tempdir().unwrap();
    fs::create_dir(base.path().join("dir")).unwrap();
    let (state, job) = fixture(base.path(), 1);
    let plan = plan(&state, &job, &["dir"]);
    assert!(plan.targets[0].partial);
    fs::write(base.path().join("dir/new"), b"new").unwrap();
    symlink("/unrelated", base.path().join("dir/link")).unwrap();
    let destination = base.path().join("moved");
    let result = execute_fake(&plan, |path| {
        fs::rename(path, &destination).map_err(|e| e.to_string())
    });
    assert_eq!(result.results[0].status, "moved");
    assert_eq!(fs::read(destination.join("new")).unwrap(), b"new");
    assert_eq!(
        fs::read_link(destination.join("link")).unwrap(),
        Path::new("/unrelated")
    );
}

#[test]
fn live_mounts_block_whole_directory_even_when_not_in_scan_and_unknown_mounts_skip() {
    let base = tempfile::tempdir().unwrap();
    fs::create_dir(base.path().join("dir")).unwrap();
    let (state, job) = fixture(base.path(), 1);
    let plan = plan(&state, &job, &["dir"]);
    let path = PathBuf::from(&plan.targets[0].path);
    for mounts in [
        Ok(vec![path.clone()]),
        Ok(vec![path.join("not-scanned/mount")]),
        Err("cannot read mount table".into()),
    ] {
        let outcome = execute(
            &plan,
            &AtomicBool::new(false),
            || mounts.clone(),
            |_| panic!("mounted path must stay"),
            |_| {},
            |_| {},
        );
        assert_eq!(outcome.results[0].status, "skipped");
    }
}

#[test]
fn failures_continue_stop_finishes_current_and_scan_is_consumed() {
    let base = tempfile::tempdir().unwrap();
    for name in ["a", "b", "c"] {
        fs::write(base.path().join(name), b"x").unwrap();
    }
    let (state, job) = fixture(base.path(), MAX_ENTRIES);
    let plan = plan(&state, &job, &["a", "b", "c"]);
    let history_dir = tempfile::tempdir().unwrap();
    let history = MaintenanceHistoryState::new(history_dir.path().into());
    let mut calls = 0;
    let outcome = run_batch(
        &state,
        &history,
        &plan.id,
        || Ok(vec![]),
        |_| {
            calls += 1;
            assert!(state
                .install(&prepare(base.path().to_str().unwrap()).unwrap())
                .is_err());
            if calls == 1 {
                return Err("system refused".into());
            }
            state
                .registry
                .lock()
                .unwrap()
                .active
                .as_ref()
                .unwrap()
                .1
                .store(true, Ordering::Relaxed);
            Ok(())
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(calls, 2);
    assert!(outcome.result.stopped);
    assert_eq!(outcome.result.results[0].status, "failed");
    assert_eq!(outcome.result.results[1].status, "moved");
    assert!(state.claim_removal(&plan.id).is_err());
    assert!(state
        .prepare_removal(&plan.scan_id, vec![id(&job, "c")])
        .is_err());
    assert!(state.registry.lock().unwrap().active.is_none());
    let record = history.get(outcome.history_id.as_deref().unwrap()).unwrap();
    assert_eq!(record.execution, ExecutionSummary::Partial);
    let MaintenanceDetail::DiskTrash(detail) = record.detail else {
        panic!("missing disk detail");
    };
    assert_eq!(detail.targets.len(), 3);
    assert_eq!(detail.results.len(), 2);
    crate::maintenance_adapters::record_followup(
        &history,
        outcome.history_id.as_deref().unwrap(),
        "failed",
        Some("scan failed".into()),
    )
    .unwrap();
    assert_eq!(
        history
            .get(outcome.history_id.as_deref().unwrap())
            .unwrap()
            .execution,
        ExecutionSummary::Partial
    );
    assert!(state
        .install(&prepare(base.path().to_str().unwrap()).unwrap())
        .is_ok());
}

#[test]
fn history_failure_does_not_change_move_result() {
    let base = tempfile::tempdir().unwrap();
    fs::write(base.path().join("a"), b"x").unwrap();
    let (state, job) = fixture(base.path(), MAX_ENTRIES);
    let plan = plan(&state, &job, &["a"]);
    let history_dir = tempfile::tempdir().unwrap();
    fs::write(history_dir.path().join("maintenance-v2.json"), b"broken").unwrap();
    let history = MaintenanceHistoryState::new(history_dir.path().into());
    let receipt = run_batch(
        &state,
        &history,
        &plan.id,
        || Ok(vec![]),
        |_| Ok(()),
        |_| {},
    )
    .unwrap();
    assert_eq!(receipt.result.results[0].status, "moved");
    assert!(receipt.history_warning.is_some());
}

#[cfg(target_os = "macos")]
#[test]
fn reads_actual_mount_table_without_traversing_the_target() {
    let mounts = mount_paths().unwrap();
    assert!(mounts.iter().any(|path| path == Path::new("/")));
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "manual Finder integration: moves only generated fixtures to Trash and restores them"]
fn actual_finder_trash_keeps_external_link_target_and_restores_fixture() {
    let base = tempfile::Builder::new()
        .prefix("clean-up-trash-smoke-")
        .tempdir()
        .unwrap();
    let root = base.path().join("scan");
    fs::create_dir(&root).unwrap();
    let name = format!(
        "{}-directory",
        base.path().file_name().unwrap().to_string_lossy()
    );
    let directory = root.join(&name);
    fs::create_dir(&directory).unwrap();
    let outside = base.path().join("outside");
    fs::write(&outside, b"must remain outside").unwrap();
    fs::write(
        directory.join("file with quotes \" and $()"),
        b"generated fixture",
    )
    .unwrap();
    symlink(&outside, directory.join("external-link")).unwrap();
    let (state, job) = fixture(&root, MAX_ENTRIES);
    let plan = plan(&state, &job, &[&name]);
    let history = MaintenanceHistoryState::new(base.path().join("history"));
    let receipt = run_batch(
        &state,
        &history,
        &plan.id,
        mount_paths,
        crate::session_records::move_path_to_trash,
        |_| {},
    )
    .unwrap();
    assert_eq!(
        receipt.result.results[0].status, "moved",
        "{:?}",
        receipt.result.results[0]
    );
    assert!(!directory.exists());
    assert_eq!(fs::read(&outside).unwrap(), b"must remain outside");
    let trashed = PathBuf::from(std::env::var_os("HOME").unwrap())
        .join(".Trash")
        .join(&name);
    let quote = |path: &Path| {
        format!(
            "\"{}\"",
            path.to_string_lossy()
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
        )
    };
    let restore = std::process::Command::new("osascript")
        .args([
            "-e",
            &format!(
                "tell application \"Finder\" to move POSIX file {} to POSIX file {}",
                quote(&trashed),
                quote(&root)
            ),
        ])
        .output()
        .unwrap();
    assert!(
        restore.status.success(),
        "fixture remains at {}: {}",
        trashed.display(),
        String::from_utf8_lossy(&restore.stderr)
    );
    assert_eq!(
        fs::read_link(directory.join("external-link")).unwrap(),
        outside
    );
    assert_eq!(
        fs::read(directory.join("file with quotes \" and $()")).unwrap(),
        b"generated fixture"
    );
}
