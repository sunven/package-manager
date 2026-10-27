use super::*;
use crate::maintenance_history::{
    MaintenanceDetail, MaintenanceHistoryState, ProjectCleanupFinish,
};
use crate::project_cleanup::{
    discover_project_data, measure_project_data, ProjectCleanupState, ProjectDataCandidateStatus,
    ProjectDataScan, ToolAvailability,
};
use crate::types::{CommandFailure, CommandRun};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

struct Fixture(PathBuf);

impl Fixture {
    fn new(name: &str) -> Self {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "project-cleanup-batch-{name}-{stamp}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }

    fn add_node_project(&self, name: &str) {
        let project = self.0.join(name);
        fs::create_dir_all(project.join("node_modules/pkg")).unwrap();
        fs::write(project.join("package.json"), "{}").unwrap();
        fs::write(project.join("node_modules/pkg/index.js"), "payload").unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[allow(clippy::result_large_err)]
fn unused_runner(_: &str, _: &[String], _: Duration) -> Result<CommandRun, CommandFailure> {
    panic!("the runner must not be used for node_modules candidates")
}

fn delete_directory(path: &Path) -> Result<(), String> {
    fs::remove_dir_all(path).map_err(|error| error.to_string())
}

struct Setup {
    fixture: Fixture,
    state: ProjectCleanupState,
    history: MaintenanceHistoryState,
    scan: ProjectDataScan,
}

impl Setup {
    fn new(name: &str, projects: &[&str]) -> Self {
        let fixture = Fixture::new(name);
        for project in projects {
            fixture.add_node_project(project);
        }
        let state = ProjectCleanupState::load(fixture.0.join("settings.json"));
        let settings = state.authorize_root(fixture.0.clone()).unwrap();
        let root_id = settings.root_id.unwrap();
        let (root_path, depth, scan_id) = state.prepare_scan(&root_id, 8).unwrap();
        let mut scan = state
            .install_scan(
                &root_id,
                scan_id,
                root_path,
                depth,
                discover_project_data(&fixture.0, 8),
                ToolAvailability {
                    cargo_available: false,
                    cargo_message: None,
                    maven_available: false,
                    maven_message: None,
                },
            )
            .unwrap();
        for candidate in &scan.candidates {
            let measurement =
                measure_project_data(candidate.kind, Path::new(&candidate.directory_path));
            state
                .apply_measurement(&scan.scan_id, &candidate.candidate_id, measurement)
                .unwrap();
        }
        scan.candidates
            .retain(|candidate| candidate.status == ProjectDataCandidateStatus::Ready);
        let history = MaintenanceHistoryState::new(fixture.0.join("history"));
        Self {
            fixture,
            state,
            history,
            scan,
        }
    }

    fn candidate_ids(&self) -> Vec<String> {
        self.scan
            .candidates
            .iter()
            .map(|candidate| candidate.candidate_id.clone())
            .collect()
    }
}

#[test]
fn cleans_each_confirmed_candidate_and_records_the_batch() {
    let setup = Setup::new("success", &["one"]);
    let ids = setup.candidate_ids();
    assert_eq!(ids.len(), 1);

    let mut events = Vec::new();
    let mut report = |progress: ProjectCleanupBatchProgress| match progress {
        ProjectCleanupBatchProgress::Started { total } => events.push(format!("started:{total}")),
        ProjectCleanupBatchProgress::Advanced {
            candidate_id,
            outcome,
            completed_count,
            cleaned_bytes,
        } => {
            let outcome = match outcome {
                ProjectCleanupBatchOutcome::Result { result } => {
                    format!("result:{:?}:{}", result.status, result.cleaned_bytes)
                }
                ProjectCleanupBatchOutcome::EffectFailed { message, .. } => {
                    format!("failed:{message}")
                }
            };
            events.push(format!(
                "advanced:{candidate_id}:{outcome}:{completed_count}:{cleaned_bytes}"
            ));
        }
    };

    let summary = run_batch_with_runner_and_deleter(
        &setup.state,
        &setup.history,
        &BatchScope {
            scan_id: &setup.scan.scan_id,
            batch_id: "batch-1",
            candidate_ids: &ids,
        },
        &mut report,
        &unused_runner,
        &delete_directory,
    )
    .unwrap();

    assert_eq!(summary.result.finish, ProjectCleanupFinish::Completed);
    assert_eq!(summary.result.total_count, 1);
    assert_eq!(summary.result.completed_count, 1);
    assert_eq!(summary.result.failed_count, 0);
    assert!(summary.result.cleaned_bytes > 0);
    let history_id = summary.history_id.expect("history id");
    assert!(summary.history_warning.is_none());
    assert_eq!(events.len(), 2);
    assert_eq!(events[0], "started:1");
    assert!(events[1].starts_with("advanced:"));
    assert!(!setup.fixture.0.join("one/node_modules").exists());

    let record = setup.history.get(&history_id).unwrap();
    assert_eq!(record.execution, ExecutionSummary::Succeeded);
    let MaintenanceDetail::ProjectCleanup(detail) = record.detail else {
        panic!("expected project detail");
    };
    assert_eq!(detail.finish, ProjectCleanupFinish::Completed);
    assert_eq!(detail.results.len(), 1);
    assert_eq!(detail.results[0].status, "Succeeded");
}

#[test]
fn stops_after_the_current_candidate_and_leaves_the_rest_for_later() {
    let setup = Setup::new("stop", &["one", "two"]);
    let ids = setup.candidate_ids();
    assert_eq!(ids.len(), 2);

    let mut advanced = 0;
    let mut report = |progress: ProjectCleanupBatchProgress| {
        if let ProjectCleanupBatchProgress::Advanced { outcome, .. } = progress {
            if matches!(outcome, ProjectCleanupBatchOutcome::Result { .. }) {
                advanced += 1;
                if advanced == 1 {
                    assert!(setup.state.request_stop("batch-2"));
                }
            }
        }
    };

    let summary = run_batch_with_runner_and_deleter(
        &setup.state,
        &setup.history,
        &BatchScope {
            scan_id: &setup.scan.scan_id,
            batch_id: "batch-2",
            candidate_ids: &ids,
        },
        &mut report,
        &unused_runner,
        &delete_directory,
    )
    .unwrap();

    assert_eq!(summary.result.finish, ProjectCleanupFinish::Stopped);
    assert_eq!(summary.result.total_count, 2);
    assert_eq!(summary.result.completed_count, 1);
    assert_eq!(advanced, 1);
    let remaining = ["one", "two"]
        .iter()
        .filter(|project| setup.fixture.0.join(project).join("node_modules").exists())
        .count();
    assert_eq!(remaining, 1);

    let record = setup
        .history
        .get(summary.history_id.as_deref().unwrap())
        .unwrap();
    let MaintenanceDetail::ProjectCleanup(detail) = record.detail else {
        panic!("expected project detail");
    };
    assert_eq!(detail.finish, ProjectCleanupFinish::Stopped);
    assert_eq!(detail.results.len(), 1);
}

#[test]
fn reports_an_effect_failure_without_history_when_the_scope_is_unknown() {
    let fixture = Fixture::new("missing");
    let state = ProjectCleanupState::load(fixture.0.join("settings.json"));
    let history = MaintenanceHistoryState::new(fixture.0.join("history"));
    let mut failure = None;
    let mut report = |progress: ProjectCleanupBatchProgress| {
        if let ProjectCleanupBatchProgress::Advanced {
            outcome: ProjectCleanupBatchOutcome::EffectFailed { message, .. },
            ..
        } = progress
        {
            failure = Some(message);
        }
    };

    let summary = run_batch_with_runner_and_deleter(
        &state,
        &history,
        &BatchScope {
            scan_id: "missing-scan",
            batch_id: "batch-3",
            candidate_ids: &["missing-candidate".to_string()],
        },
        &mut report,
        &unused_runner,
        &delete_directory,
    )
    .unwrap();

    assert_eq!(summary.result.finish, ProjectCleanupFinish::Completed);
    assert_eq!(summary.result.total_count, 1);
    assert_eq!(summary.result.completed_count, 1);
    assert_eq!(summary.result.failed_count, 1);
    assert!(summary.history_id.is_none());
    assert!(summary.history_warning.is_some());
    assert!(failure.is_some_and(|message| !message.is_empty()));
}
