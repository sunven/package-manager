use super::*;

fn scan(root: &Path, limit: usize) -> Arc<Job> {
    let config = tempfile::tempdir().unwrap();
    let state = DiskScanState::load(config.path().join("settings.json"));
    let prepared = prepare(root.to_str().unwrap()).unwrap();
    let job = state.install(&prepared).unwrap();
    run(&job, prepared, limit, |_| {});
    job
}

#[test]
fn nested_tree_hidden_directories_and_cached_navigation() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join(".git/objects")).unwrap();
    fs::create_dir_all(root.path().join("node_modules/pkg")).unwrap();
    fs::create_dir(root.path().join("empty")).unwrap();
    fs::write(root.path().join(".git/objects/blob"), vec![7; 9000]).unwrap();
    fs::write(root.path().join("readme"), b"hello").unwrap();
    let job = scan(root.path(), MAX_ENTRIES);
    let mut tree = job.tree.lock().unwrap();
    assert_eq!(tree.summary.phase, Phase::Completed);
    assert_eq!(tree.summary.entries, 7);
    assert_eq!(
        tree.summary.bytes,
        crate::disk_usage::disk_usage(root.path()).bytes
    );
    let page = tree.page(0, 1, 200, ListGroup::All).unwrap();
    assert_eq!(page.total, 4);
    assert!(page.ancestors.is_empty());
    let empty = page.entries.iter().find(|e| e.name == "empty").unwrap();
    assert_eq!(empty.bytes, Some(0));
    let git = page.entries.iter().find(|e| e.name == ".git").unwrap().id;
    fs::remove_dir_all(root.path().join(".git")).unwrap();
    let cached = tree.page(git, 2, 200, ListGroup::All).unwrap();
    assert_eq!(cached.entries[0].name, "objects");
    assert_eq!(cached.ancestors[0].id, 0);
    assert!(tree.page(usize::MAX, 3, 200, ListGroup::All).is_err());
}

#[cfg(unix)]
#[test]
fn each_directory_deduplicates_shared_files_independently() {
    let root = tempfile::tempdir().unwrap();
    for path in ["a/deep", "a/other", "b/deep", "c"] {
        fs::create_dir_all(root.path().join(path)).unwrap();
    }
    let source = root.path().join("original");
    fs::write(&source, vec![1; 16000]).unwrap();
    for path in [
        "a/link",
        "a/deep/link",
        "a/other/link",
        "b/link",
        "b/deep/link",
        "c/link",
        "duplicate",
    ] {
        fs::hard_link(&source, root.path().join(path)).unwrap();
    }
    fs::write(root.path().join("a/deep/unique"), vec![1; 24000]).unwrap();
    let job = scan(root.path(), MAX_ENTRIES);
    let tree = job.tree.lock().unwrap();
    for (id, node) in tree.nodes.iter().enumerate() {
        if node.kind == Kind::Directory {
            assert_eq!(
                node.bytes,
                crate::disk_usage::disk_usage(&tree.path(id)).bytes,
                "{}",
                tree.path(id).display()
            );
        }
    }
    let children_sum: u64 = tree.nodes[0]
        .children
        .iter()
        .filter_map(|id| tree.nodes[*id].bytes)
        .sum();
    assert!(children_sum > tree.summary.bytes.unwrap());
}

#[cfg(unix)]
#[test]
fn root_links_resolve_but_internal_links_and_special_files_are_excluded() {
    use std::os::unix::{fs::symlink, net::UnixListener};
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("root");
    fs::create_dir(&root).unwrap();
    fs::write(base.path().join("outside"), b"outside").unwrap();
    symlink(&root, base.path().join("start")).unwrap();
    symlink(&root, root.join("cycle")).unwrap();
    symlink(base.path().join("outside"), root.join("external")).unwrap();
    symlink(base.path().join("missing"), root.join("broken")).unwrap();
    let _socket = UnixListener::bind(root.join("socket")).unwrap();
    assert_eq!(
        prepare(base.path().join("start").to_str().unwrap())
            .unwrap()
            .root,
        root.canonicalize().unwrap()
    );
    let job = scan(&root, MAX_ENTRIES);
    let mut tree = job.tree.lock().unwrap();
    assert_eq!(tree.summary.phase, Phase::Completed);
    assert_eq!(tree.summary.excluded, 4);
    assert_eq!(tree.summary.bytes, Some(0));
    for entry in tree.page(0, 1, 200, ListGroup::All).unwrap().entries {
        assert_eq!(entry.status, "excluded");
        assert_eq!(entry.bytes, None);
        assert!(tree.page(entry.id, 2, 200, ListGroup::All).is_err());
    }
}

#[test]
fn invalid_start_preserves_active_job_and_restart_only_restores_path() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("root");
    fs::create_dir(&root).unwrap();
    let file = base.path().join("settings.json");
    let state = DiskScanState::load(file.clone());
    let job = state
        .install(&prepare(root.to_str().unwrap()).unwrap())
        .unwrap();
    for invalid in [
        "relative",
        "/this-path-must-not-exist-disk-scan",
        file.to_str().unwrap(),
    ] {
        assert!(prepare(invalid).is_err());
    }
    assert!(!job.cancel.load(Ordering::Relaxed));
    let reloaded = DiskScanState::load(file);
    assert_eq!(
        reloaded.settings().last_path,
        Some(root.canonicalize().unwrap().display().to_string())
    );
    assert!(reloaded.registry.lock().unwrap().job.is_none());
    let next = state
        .install(&prepare(root.to_str().unwrap()).unwrap())
        .unwrap();
    assert!(job.cancel.load(Ordering::Relaxed));
    assert!(!next.cancel.load(Ordering::Relaxed));
    assert!(state
        .job(&job.tree.lock().unwrap().summary.scan_id)
        .is_err());
}

#[test]
fn cancellation_and_limit_stop_the_actual_walk() {
    let root = tempfile::tempdir().unwrap();
    for i in 0..500 {
        fs::write(root.path().join(format!("file-{i}")), b"a").unwrap();
    }
    let job = scan(root.path(), 205);
    let mut tree = job.tree.lock().unwrap();
    assert_eq!(tree.summary.phase, Phase::Limited);
    assert_eq!(tree.summary.entries, 205);
    let page = tree.page(0, 1, 200, ListGroup::All).unwrap();
    assert_eq!(page.entries.len(), 200);
    assert_eq!(page.total, 205);
    assert_eq!(page.directory.status, "partial");
    assert_eq!(
        tree.page(0, 1, 400, ListGroup::All).unwrap().entries.len(),
        205
    );
    drop(tree);
    let prepared = prepare(root.path().to_str().unwrap()).unwrap();
    job.cancel.store(true, Ordering::Relaxed);
    run(&job, prepared, MAX_ENTRIES, |_| {});
    assert_eq!(job.tree.lock().unwrap().summary.entries, 205);
    assert_eq!(job.tree.lock().unwrap().summary.phase, Phase::Stopped);
}

#[cfg(unix)]
#[test]
fn unreadable_child_marks_ancestors_partial_but_keeps_other_files() {
    use std::os::unix::fs::PermissionsExt;
    if unsafe { libc::geteuid() } == 0 {
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let locked = root.path().join("locked");
    fs::create_dir(&locked).unwrap();
    fs::write(root.path().join("readable"), vec![1; 8000]).unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    let job = scan(root.path(), MAX_ENTRIES);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o700)).unwrap();
    let mut tree = job.tree.lock().unwrap();
    assert_eq!(tree.summary.phase, Phase::Partial);
    assert!(tree.summary.bytes.unwrap() > 0);
    let page = tree.page(0, 1, 200, ListGroup::All).unwrap();
    let locked = page.entries.iter().find(|e| e.name == "locked").unwrap();
    assert_eq!(locked.bytes, None);
    assert_eq!(locked.status, "partial");
    assert!(locked.message.is_some());
}

#[test]
fn stable_running_order_appends_then_sorts_at_completion() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("a"), b"small").unwrap();
    fs::write(root.path().join("b"), vec![1; 64000]).unwrap();
    let job = scan(root.path(), MAX_ENTRIES);
    let mut tree = job.tree.lock().unwrap();
    tree.summary.phase = Phase::Running;
    let first = tree.page(0, 1, 200, ListGroup::All).unwrap();
    let smaller = first.entries[1].id;
    tree.nodes[smaller].bytes = Some(1_000_000);
    assert_eq!(
        tree.page(0, 1, 200, ListGroup::All).unwrap().entries[0].id,
        first.entries[0].id
    );
    tree.summary.phase = Phase::Completed;
    assert_eq!(
        tree.page(0, 1, 200, ListGroup::All).unwrap().entries[0].id,
        smaller
    );
}

#[test]
fn directory_moved_after_validation_keeps_unreadable_entries_unknown() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("root");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("file"), b"data").unwrap();
    let state = DiskScanState::load(base.path().join("settings"));
    let prepared = prepare(root.to_str().unwrap()).unwrap();
    let job = state.install(&prepared).unwrap();
    // The open directory remains enumerable, but its original child paths no longer exist.
    fs::rename(&root, base.path().join("moved")).unwrap();
    run(&job, prepared, MAX_ENTRIES, |_| {});
    let mut tree = job.tree.lock().unwrap();
    assert_eq!(tree.summary.phase, Phase::Partial);
    assert_eq!(tree.summary.errors, 1);
    let page = tree.page(0, 1, 200, ListGroup::All).unwrap();
    assert_eq!(page.directory.status, "partial");
    assert_eq!(page.entries[0].name, "file");
    assert_eq!(page.entries[0].bytes, None);
    assert_eq!(page.entries[0].kind, Kind::Unknown);
    assert_eq!(page.entries[0].status, "partial");
    assert!(page.entries[0].message.is_some());
}

#[test]
#[ignore = "manual resource benchmark: one million retained entries"]
fn million_entry_directory_page_is_bounded() {
    let base = tempfile::tempdir().unwrap();
    let state = DiskScanState::load(base.path().join("settings"));
    let job = state
        .install(&prepare(base.path().to_str().unwrap()).unwrap())
        .unwrap();
    let started = Instant::now();
    let mut tree = job.tree.lock().unwrap();
    for id in 1..=MAX_ENTRIES {
        tree.nodes.push(Node {
            identity: None,
            parent: Some(0),
            depth: 1,
            name: format!("file-{id:07}").into(),
            kind: Kind::File,
            bytes: Some(id as u64 * 4096),
            finished: true,
            partial: false,
            message: None,
            children: Vec::new(),
        });
        tree.nodes[0].children.push(id);
    }
    tree.summary.phase = Phase::Limited;
    eprintln!(
        "million nodes built in {:?}; node struct {} bytes",
        started.elapsed(),
        std::mem::size_of::<Node>()
    );
    let query = Instant::now();
    let page = tree.page(0, 1, 200, ListGroup::All).unwrap();
    assert_eq!(page.total, MAX_ENTRIES);
    assert_eq!(page.entries.len(), 200);
    assert_eq!(page.entries[0].id, MAX_ENTRIES);
    let payload = serde_json::to_vec(&page).unwrap();
    assert!(payload.len() < 100_000);
    eprintln!(
        "sorted page {:?}; IPC bytes {}",
        query.elapsed(),
        payload.len()
    );
    let query = Instant::now();
    let chart = tree.chart(0).unwrap();
    assert_eq!(chart.entries.len(), CHART_LIMIT);
    assert_eq!(chart.other.count, MAX_ENTRIES - CHART_LIMIT);
    assert_eq!(chart.entries[0].id, MAX_ENTRIES);
    let payload = serde_json::to_vec(&chart).unwrap();
    assert!(payload.len() < 100_000);
    eprintln!(
        "bounded chart {:?}; IPC bytes {}",
        query.elapsed(),
        payload.len()
    );
    drop(tree);
    run(
        &job,
        prepare(base.path().to_str().unwrap()).unwrap(),
        MAX_ENTRIES,
        |_| {},
    );
    let tree = job.tree.lock().unwrap();
    assert_eq!(tree.summary.phase, Phase::Limited);
    assert_eq!(tree.summary.entries, MAX_ENTRIES);
}

#[cfg(unix)]
#[test]
fn other_devices_are_visible_but_not_traversed() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("root");
    fs::create_dir_all(root.join("other-volume/deep")).unwrap();
    fs::write(root.join("other-volume/deep/file"), b"outside volume").unwrap();
    let state = DiskScanState::load(base.path().join("settings"));
    let mut prepared = prepare(root.to_str().unwrap()).unwrap();
    prepared.device = prepared.device.wrapping_add(1);
    let job = state.install(&prepared).unwrap();
    run(&job, prepared, MAX_ENTRIES, |_| {});
    let mut tree = job.tree.lock().unwrap();
    let page = tree.page(0, 1, 200, ListGroup::All).unwrap();
    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].kind, Kind::Mount);
    assert_eq!(page.entries[0].status, "excluded");
    assert_eq!(tree.summary.phase, Phase::Completed);
    assert_eq!(tree.summary.bytes, Some(0));
}

#[test]
fn stop_during_traversal_preserves_already_read_entries() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("root");
    fs::create_dir(&root).unwrap();
    for id in 0..10_000 {
        fs::write(root.join(format!("file-{id}")), b"data").unwrap();
    }
    let state = DiskScanState::load(base.path().join("settings"));
    let prepared = prepare(root.to_str().unwrap()).unwrap();
    let job = state.install(&prepared).unwrap();
    std::thread::scope(|scope| {
        scope.spawn(|| run(&job, prepared, MAX_ENTRIES, |_| {}));
        loop {
            let count = job.tree.lock().unwrap().nodes.len();
            if count > 20 {
                job.cancel.store(true, Ordering::Relaxed);
                break;
            }
            std::thread::yield_now();
        }
    });
    let tree = job.tree.lock().unwrap();
    assert_eq!(tree.summary.phase, Phase::Stopped);
    assert!(tree.summary.entries >= 20 && tree.summary.entries < 10_000);
    assert!(tree.summary.bytes.unwrap() > 0);
}

#[test]
#[ignore = "manual read-only scan: set DISK_SCAN_VERIFY_ROOT and optional DISK_SCAN_VERIFY_OUTPUT"]
fn inspect_real_directory() {
    let root = std::env::var("DISK_SCAN_VERIFY_ROOT").expect("set DISK_SCAN_VERIFY_ROOT");
    let base = tempfile::tempdir().unwrap();
    let state = DiskScanState::load(base.path().join("settings"));
    let prepared = prepare(&root).unwrap();
    let job = state.install(&prepared).unwrap();
    let mut progress_count = 0;
    run(&job, prepared, MAX_ENTRIES, |_| {
        progress_count += 1;
    });
    let mut tree = job.tree.lock().unwrap();
    let summary = tree.summary.clone();
    let root_page = tree.page(0, 1, 200, ListGroup::All).unwrap();
    let directories: Vec<_> = root_page
        .entries
        .iter()
        .filter(|entry| entry.kind == Kind::Directory)
        .map(|entry| entry.id)
        .collect();
    let mut pages = vec![root_page];
    let mut charts = vec![tree.chart(0).unwrap()];
    for id in directories {
        pages.push(tree.page(id, id as u64 + 1, 200, ListGroup::All).unwrap());
        charts.push(tree.chart(id).unwrap());
    }
    eprintln!(
        "real scan: {} entries, {} bytes, {} errors, {} exclusions, {} ms, {} progress events",
        summary.entries,
        summary.bytes.unwrap_or(0),
        summary.errors,
        summary.excluded,
        summary.elapsed_ms,
        progress_count
    );
    if let Ok(output) = std::env::var("DISK_SCAN_VERIFY_OUTPUT") {
        fs::write(
            output,
            serde_json::to_vec(
                &serde_json::json!({ "summary": summary, "pages": pages, "charts": charts }),
            )
            .unwrap(),
        )
        .unwrap();
    }
}

fn chart_job(count: usize) -> Arc<Job> {
    let base = tempfile::tempdir().unwrap();
    let state = DiskScanState::load(base.path().join("settings"));
    let job = state
        .install(&prepare(base.path().to_str().unwrap()).unwrap())
        .unwrap();
    {
        let mut tree = job.tree.lock().unwrap();
        for id in 1..=count {
            tree.nodes.push(Node {
                identity: None,
                parent: Some(0),
                depth: 1,
                name: format!("file-{id:07}").into(),
                kind: Kind::File,
                bytes: Some(id as u64),
                finished: true,
                partial: false,
                message: None,
                children: Vec::new(),
            });
            tree.nodes[0].children.push(id);
        }
        tree.nodes[0].finished = true;
        tree.summary.phase = Phase::Completed;
    }
    job
}

#[test]
fn chart_covers_full_level_at_the_top_200_boundary() {
    for count in [0, 1, 199, 200, 201, 450] {
        let job = chart_job(count);
        let mut tree = job.tree.lock().unwrap();
        // Loading only two list rows must not restrict the chart's data scope.
        tree.page(0, 1, 2, ListGroup::All).unwrap();
        let chart = tree.chart(0).unwrap();
        assert_eq!(chart.total, count);
        assert_eq!(chart.entries.len(), count.min(200));
        assert_eq!(chart.other.count, count.saturating_sub(200));
        let expected = count as u64 * (count as u64 + 1) / 2;
        assert_eq!(
            chart.entries.iter().map(|e| e.bytes.unwrap()).sum::<u64>() + chart.other.bytes,
            expected
        );
        if count > 0 {
            assert_eq!(chart.entries[0].id, count);
        }
        assert!(tree.chart(usize::MAX).is_err());
        if count > 0 {
            assert!(tree.chart(1).is_err());
        }
    }
}

#[test]
fn chart_separates_unknown_unfinished_zero_real_zero_and_excluded() {
    let job = chart_job(8);
    let mut tree = job.tree.lock().unwrap();
    tree.summary.phase = Phase::Stopped;
    tree.nodes[1].bytes = None;
    tree.nodes[1].finished = false;
    tree.nodes[2].bytes = Some(0);
    tree.nodes[2].finished = false;
    tree.nodes[3].bytes = Some(0);
    tree.nodes[4].bytes = Some(0);
    tree.nodes[4].partial = true;
    tree.nodes[5].kind = Kind::Symlink;
    tree.nodes[5].bytes = None;
    tree.nodes[6].partial = true;
    tree.nodes[7].kind = Kind::Mount;
    tree.nodes[7].bytes = None;
    tree.nodes[8].kind = Kind::Special;
    tree.nodes[8].bytes = None;
    let chart = tree.chart(0).unwrap();
    assert_eq!(chart.counts.unmeasured, 3);
    assert_eq!(chart.counts.zero, 1);
    assert_eq!(chart.counts.excluded, 3);
    assert_eq!(chart.entries.len(), 1);
    assert_eq!(chart.entries[0].id, 6);
    assert_eq!(chart.entries[0].status, "partial");
    assert_eq!(chart.phase, Phase::Stopped);
    assert_eq!(chart.other.bytes, 0);
    for (group, expected) in [
        (ListGroup::Unmeasured, vec![1, 2, 4]),
        (ListGroup::Zero, vec![3]),
        (ListGroup::Excluded, vec![5, 7, 8]),
    ] {
        let page = tree.page(0, 1, 1, group).unwrap();
        assert_eq!(page.total, expected.len());
        assert_eq!(page.entries.len(), 1);
        let mut ids: Vec<_> = tree
            .page(0, 1, 200, group)
            .unwrap()
            .entries
            .iter()
            .map(|entry| entry.id)
            .collect();
        ids.sort_unstable();
        assert_eq!(ids, expected);
    }
}

#[test]
fn other_group_filters_before_paging_and_tracks_new_large_items() {
    let job = chart_job(650);
    let mut tree = job.tree.lock().unwrap();
    tree.summary.phase = Phase::Running;
    let initial = tree.page(0, 1, 200, ListGroup::All).unwrap();
    assert_eq!(initial.entries.last().unwrap().id, 451);
    let group = tree.page(0, 1, 200, ListGroup::Other).unwrap();
    assert_eq!(group.total, 450);
    assert_eq!(group.entries[0].id, 450);
    assert_eq!(group.entries.last().unwrap().id, 251);
    assert_eq!(
        tree.page(0, 1, 400, ListGroup::Other)
            .unwrap()
            .entries
            .last()
            .unwrap()
            .id,
        51
    );
    tree.nodes[1].bytes = Some(1_000_000);
    let chart = tree.chart(0).unwrap();
    assert_eq!(chart.entries[0].id, 1);
    let group = tree.page(0, 1, 1_000, ListGroup::Other).unwrap();
    assert_eq!(group.total, 450);
    assert!(group.entries.iter().any(|entry| entry.id == 451));
    assert!(!group.entries.iter().any(|entry| entry.id == 1));
    // The chart's ranking must not disturb the existing stable list order.
    assert_eq!(
        tree.page(0, 1, 200, ListGroup::All).unwrap().entries[0].id,
        650
    );
    tree.nodes[2].finished = false;
    let chart = tree.chart(0).unwrap();
    assert!(chart.other.partial);
    assert_eq!(
        chart.other.bytes,
        group
            .entries
            .iter()
            .map(|entry| entry.bytes.unwrap())
            .sum::<u64>()
    );
}

#[cfg(unix)]
#[test]
fn chart_other_sums_overlapping_hardlink_footprints_without_parent_subtraction() {
    let root = tempfile::tempdir().unwrap();
    let original = root.path().join("original");
    fs::write(&original, vec![1; 16000]).unwrap();
    for id in 0..201 {
        fs::hard_link(&original, root.path().join(format!("link-{id:03}"))).unwrap();
    }
    let job = scan(root.path(), MAX_ENTRIES);
    let mut tree = job.tree.lock().unwrap();
    let chart = tree.chart(0).unwrap();
    let bytes = tree.summary.bytes.unwrap();
    assert!(bytes > 0);
    assert_eq!(chart.entries.len(), 200);
    assert!(chart.entries.iter().all(|entry| entry.bytes == Some(bytes)));
    assert_eq!(chart.other.count, 2);
    assert_eq!(chart.other.bytes, bytes * 2);
    let group = tree.page(0, 1, 200, ListGroup::Other).unwrap();
    assert_eq!(group.entries.len(), 2);
    assert!(group
        .entries
        .iter()
        .all(|entry| !chart.entries.iter().any(|top| top.id == entry.id)));
}
