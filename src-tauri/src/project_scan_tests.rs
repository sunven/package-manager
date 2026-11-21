use super::*;
use std::sync::{mpsc, Condvar};

struct Fixture {
    directory: tempfile::TempDir,
    state: ProjectCleanupState,
    history: ProjectScanHistoryState,
    root_id: String,
    preset_id: String,
}

impl Fixture {
    fn new(count: usize) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("projects");
        fs::create_dir(&root).unwrap();
        for index in 0..count {
            let project = root.join(format!("project-{index}"));
            fs::create_dir_all(project.join("node_modules/nested")).unwrap();
            fs::write(project.join("package.json"), "{}").unwrap();
            fs::write(project.join("node_modules/nested/file"), "content").unwrap();
        }
        let state = ProjectCleanupState::load(directory.path().join("settings.json"));
        let settings = state.authorize_root(root).unwrap();
        Self {
            root_id: settings.root_id.unwrap(),
            preset_id: settings.active_preset_id.unwrap(),
            history: ProjectScanHistoryState::new(directory.path().join("history.json")),
            state,
            directory,
        }
    }

    fn run(&self, progress: &(dyn Fn(ProjectScanProgress) + Sync)) -> ProjectScanSummary {
        run_with(
            &self.state,
            &self.root_id,
            8,
            progress,
            &discover_project_data_until,
            &measure_project_data_until,
            &available,
            &|draft| self.history.record(draft),
        )
        .unwrap()
    }
}

fn available(_: &str) -> (bool, Option<String>) {
    (true, None)
}

#[test]
fn an_early_stop_creates_no_session_or_history_and_retires_the_request() {
    let fixture = Fixture::new(1);
    let id = Mutex::new(String::new());
    let summary = fixture.run(&|progress| match progress {
        ProjectScanProgress::Started { scan_id } => {
            *id.lock().unwrap() = scan_id.clone();
            request_stop(&fixture.state, &scan_id).unwrap();
        }
        _ => panic!("a stopped discovery must not publish a session"),
    });
    assert_eq!(summary.finish, MeasurementState::Stopped);
    assert!(summary.record.is_none());
    assert!(fixture.state.lock().unwrap().scan.is_none());
    assert!(fixture.state.lock().unwrap().pending_scan_id.is_none());
    assert!(
        fixture.history.list(&[fixture.preset_id.clone()]).histories[&fixture.preset_id]
            .records
            .is_empty()
    );
    let old_id = id.into_inner().unwrap();
    let next = fixture.run(&|progress| {
        if matches!(progress, ProjectScanProgress::Started { .. }) {
            request_stop(&fixture.state, &old_id).unwrap();
        }
    });
    assert_eq!(next.finish, MeasurementState::Finished);
    assert!(next.record.is_some());
    assert_ne!(next.scan_id, old_id);
}

#[test]
fn directory_walkers_propagate_interruption_without_a_completed_measurement() {
    let fixture = Fixture::new(2);
    let checks = AtomicUsize::new(0);
    let root = fixture.directory.path().join("projects");
    assert!(
        discover_project_data_until(&root, 8, &|| checks.fetch_add(1, Ordering::Relaxed) >= 2)
            .is_none()
    );
    let checks = AtomicUsize::new(0);
    let path = root.join("project-0/node_modules");
    assert!(
        measure_project_data_until(ProjectDataKind::NodeModules, &path, &|| checks
            .fetch_add(1, Ordering::Relaxed)
            >= 3)
        .is_none()
    );
    assert_eq!(
        measure_project_data(ProjectDataKind::NodeModules, &path).status,
        DirectoryMeasurementStatus::Ready
    );
}

#[test]
fn stopping_drains_four_workers_and_never_publishes_their_interrupted_results() {
    let fixture = Fixture::new(6);
    let state = fixture.state.clone();
    let history = fixture.history.clone();
    let root_id = fixture.root_id.clone();
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let worker_gate = gate.clone();
    let (entered, calls) = mpsc::channel();
    let (progress, updates) = mpsc::channel();
    let running = std::thread::spawn(move || {
        run_with(
            &state,
            &root_id,
            8,
            &|event| {
                progress.send(event).unwrap();
            },
            &discover_project_data_until,
            &|kind, path, _| {
                entered.send(path.to_path_buf()).unwrap();
                let (lock, ready) = &*worker_gate;
                let _wait = ready
                    .wait_while(lock.lock().unwrap(), |open| !*open)
                    .unwrap();
                // A result returning after stop must also be rejected at the state write.
                Some(measure_project_data(kind, path))
            },
            &available,
            &|draft| history.record(draft),
        )
    });
    let ProjectScanProgress::Started { scan_id } =
        updates.recv_timeout(Duration::from_secs(5)).unwrap()
    else {
        panic!()
    };
    let ProjectScanProgress::Discovered { scan } =
        updates.recv_timeout(Duration::from_secs(5)).unwrap()
    else {
        panic!()
    };
    for _ in 0..4 {
        calls.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    request_stop(&fixture.state, &scan_id).unwrap();
    assert!(fixture.state.update_depth(&fixture.preset_id, 3).is_err());
    assert!(fixture.state.remove_preset(&fixture.preset_id).is_err());
    assert!(fixture.state.begin_batch("new-batch").is_err());
    assert!(!running.is_finished());
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    let summary = running.join().unwrap().unwrap();
    assert_eq!(summary.finish, MeasurementState::Stopped);
    assert_eq!(calls.try_iter().count(), 0);
    assert_eq!(updates.try_iter().count(), 0);
    for candidate in &scan.candidates {
        assert_eq!(
            fixture
                .state
                .lock()
                .unwrap()
                .candidate(&scan_id, &candidate.candidate_id)
                .unwrap()
                .measurement
                .status,
            DirectoryMeasurementStatus::Pending
        );
    }
    let record = summary.record.unwrap();
    assert_eq!(record.measurement, MeasurementState::Stopped);
    assert_eq!(record.candidates.total, 6);
    assert!(record.discovery.complete);
    assert_eq!(record.finished_at, summary.finished_at);
    assert_eq!(
        fixture.history.list(&[fixture.preset_id.clone()]).histories[&fixture.preset_id]
            .records
            .len(),
        1
    );
    fixture.state.update_depth(&fixture.preset_id, 3).unwrap();
}

#[test]
fn stopped_measurement_keeps_completed_candidates_and_records_discovery_once() {
    let fixture = Fixture::new(2);
    let current_id = Mutex::new(String::new());
    let completed = Mutex::new(None);
    let summary = fixture.run(&|event| match event {
        ProjectScanProgress::Started { scan_id } => *current_id.lock().unwrap() = scan_id,
        ProjectScanProgress::Measured { candidate_id, .. } => {
            *completed.lock().unwrap() = Some(candidate_id);
            request_stop(&fixture.state, &current_id.lock().unwrap()).unwrap();
        }
        _ => {}
    });
    assert_eq!(summary.finish, MeasurementState::Stopped);
    let completed = completed.into_inner().unwrap().unwrap();
    assert_eq!(
        fixture
            .state
            .lock()
            .unwrap()
            .candidate(&summary.scan_id, &completed)
            .unwrap()
            .measurement
            .status,
        DirectoryMeasurementStatus::Ready
    );
    assert_eq!(summary.record.unwrap().candidates.total, 2);
}

#[test]
fn final_recording_keeps_settings_locked_and_failure_only_adds_a_warning() {
    let fixture = Fixture::new(0);
    let state = fixture.state.clone();
    let root_id = fixture.root_id.clone();
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let writer_gate = gate.clone();
    let (writing, entered) = mpsc::channel();
    let running = std::thread::spawn(move || {
        run_with(
            &state,
            &root_id,
            8,
            &|_| {},
            &discover_project_data_until,
            &measure_project_data_until,
            &available,
            &|draft| {
                writing.send(draft).unwrap();
                let (lock, ready) = &*writer_gate;
                let _wait = ready
                    .wait_while(lock.lock().unwrap(), |open| !*open)
                    .unwrap();
                Err("disk full".into())
            },
        )
    });
    let draft = entered.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(fixture.state.select_preset(&fixture.preset_id).is_err());
    assert!(fixture.state.remove_preset(&fixture.preset_id).is_err());
    let rejected = run_with(
        &fixture.state,
        &fixture.root_id,
        8,
        &|_| {},
        &discover_project_data_until,
        &measure_project_data_until,
        &available,
        &|draft| fixture.history.record(draft),
    );
    assert!(rejected.is_err());
    request_stop(&fixture.state, &draft.scan_id).unwrap();
    assert!(!running.is_finished());
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    let summary = running.join().unwrap().unwrap();
    assert_eq!(summary.finish, MeasurementState::Finished);
    assert_eq!(summary.history_warning.as_deref(), Some("disk full"));
    assert!(summary.record.is_none());
    fixture.state.remove_preset(&fixture.preset_id).unwrap();
}

#[test]
fn incomplete_discovery_and_measurement_failures_keep_their_distinct_facts() {
    let fixture = Fixture::new(1);
    let summary = run_with(
        &fixture.state,
        &fixture.root_id,
        8,
        &|_| {},
        &|path, depth, stopped| {
            let mut discovery = discover_project_data_until(path, depth, stopped)?;
            discovery.skipped = 1;
            Some(discovery)
        },
        &|_, _, _| {
            Some(failed_measurement(
                DirectoryMeasurementStatus::Error,
                std::io::Error::other("unreadable"),
            ))
        },
        &available,
        &|draft| fixture.history.record(draft),
    )
    .unwrap();
    assert_eq!(summary.finish, MeasurementState::Finished);
    let record = summary.record.unwrap();
    assert!(!record.discovery.complete);
    assert_eq!(record.discovery.skipped, 1);
    assert!(record.changes.is_none());
    assert_eq!(
        fixture
            .state
            .lock()
            .unwrap()
            .scan
            .as_ref()
            .unwrap()
            .candidates
            .values()
            .next()
            .unwrap()
            .measurement
            .status,
        DirectoryMeasurementStatus::Error
    );
}

#[test]
fn cleanup_of_a_measured_candidate_is_preserved_when_the_scan_finishes() {
    let fixture = Fixture::new(1);
    let current_id = Mutex::new(String::new());
    let candidate_id = Mutex::new(String::new());
    let summary = fixture.run(&|event| match event {
        ProjectScanProgress::Started { scan_id } => *current_id.lock().unwrap() = scan_id,
        ProjectScanProgress::Measured {
            candidate_id: id,
            measurement,
        } => {
            let _batch = fixture.state.begin_batch("batch").unwrap();
            let scan_id = current_id.lock().unwrap();
            fixture.state.cleanup_context(&scan_id, &id).unwrap();
            let result = ProjectCleanupResult {
                candidate_id: id.clone(),
                status: ProjectCleanupStatus::Succeeded,
                command: None,
                before_bytes: measurement.bytes.unwrap(),
                after_bytes: 0,
                cleaned_bytes: measurement.bytes.unwrap(),
                measurement: missing_measurement(),
                stdout: String::new(),
                stderr: String::new(),
                message: None,
                failure: None,
            };
            fixture
                .state
                .apply_cleanup_result(&scan_id, &result)
                .unwrap();
            *candidate_id.lock().unwrap() = id;
        }
        _ => {}
    });
    assert_eq!(summary.finish, MeasurementState::Finished);
    let candidate = fixture
        .state
        .lock()
        .unwrap()
        .candidate(&summary.scan_id, &candidate_id.lock().unwrap())
        .unwrap();
    assert!(candidate.cleanup_attempted);
    assert_eq!(
        candidate.measurement.status,
        DirectoryMeasurementStatus::Missing
    );
    assert_eq!(summary.record.unwrap().candidates.total, 1);
}

#[test]
fn progress_and_summary_use_the_frontend_contract() {
    let fixture = Fixture::new(0);
    let updates = Mutex::new(Vec::new());
    let summary = fixture.run(&|event| {
        updates
            .lock()
            .unwrap()
            .push(serde_json::to_value(event).unwrap())
    });
    let updates = updates.into_inner().unwrap();
    assert_eq!(updates[0]["phase"], "started");
    assert_eq!(updates[0]["scanId"], summary.scan_id);
    assert_eq!(updates[1]["phase"], "discovered");
    let serialized = serde_json::to_value(summary).unwrap();
    assert_eq!(serialized["finish"], "finished");
    assert!(serialized["finishedAt"].is_number());
    assert!(serialized["record"]["presetId"].is_string());
}

#[test]
fn a_disconnected_progress_receiver_does_not_prevent_terminal_recording() {
    let fixture = Fixture::new(1);
    let (sender, receiver) = mpsc::channel();
    drop(receiver);
    let summary = fixture.run(&|event| {
        let _ = sender.send(event);
    });
    assert_eq!(summary.finish, MeasurementState::Finished);
    assert!(summary.record.is_some());
    assert_eq!(
        fixture.history.list(&[fixture.preset_id.clone()]).histories[&fixture.preset_id]
            .records
            .len(),
        1
    );
}
