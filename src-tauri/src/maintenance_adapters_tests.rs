use super::*;
use crate::maintenance_history::{
    FollowUpReadStatus, MaintenanceDetail, MaintenanceDomain, MaintenanceHistoryState,
    MaintenanceOperation, ProjectCleanupCandidateSnapshot, ProjectCleanupDetail,
    ProjectCleanupFinish, ProjectCleanupScope, SessionRemovalMode, SessionTrashDetail,
    SessionTrashScope,
};
use crate::opencode_deletion::{
    DeletionKind, DeletionPlan, OpenCodeDeletionItem, OpenCodeDeletionResult,
    OpenCodeDeletionStatus,
};
use crate::project_cleanup::ProjectDataKind;
use crate::session_records::{
    SessionRemovalItem, SessionRemovalReason, SessionRemovalResult, SessionRemovalStatus,
    SessionSourceKind,
};
use crate::types::ManagerId;
use crate::vscode_removal::{
    VscodeStorageRemovalItem, VscodeStorageRemovalReason, VscodeStorageRemovalResult,
    VscodeStorageRemovalStatus,
};

fn store() -> (tempfile::TempDir, MaintenanceHistoryState) {
    let directory = tempfile::tempdir().unwrap();
    let store = MaintenanceHistoryState::new(directory.path().into());
    (directory, store)
}

fn session_item(id: &str, status: SessionRemovalStatus) -> SessionRemovalItem {
    SessionRemovalItem {
        id: id.into(),
        status,
        reason: None,
        message: None,
    }
}

fn session_detail() -> MaintenanceDetail {
    MaintenanceDetail::SessionTrash(SessionTrashDetail {
        scope: SessionTrashScope {
            source: SessionSourceKind::Codex,
            mode: SessionRemovalMode::Single,
            days: None,
            confirmed_count: Some(1),
            confirmed_records: None,
            directory: None,
            cutoff_ms: None,
        },
        execution_total: None,
        results: Vec::new(),
    })
}

#[test]
fn older_than_sessions_append_each_item_and_finish() {
    let (_directory, history) = store();
    let items = vec![
        session_item("first", SessionRemovalStatus::Moved),
        SessionRemovalItem {
            id: "second".into(),
            status: SessionRemovalStatus::Skipped,
            reason: Some(SessionRemovalReason::InUse),
            message: None,
        },
    ];
    let receipt =
        remove_sessions_older_than(&history, SessionSourceKind::Codex, 7, Some(2), None, None, |sink| {
            for item in &items {
                sink(item);
            }
            Ok(SessionRemovalResult {
                moved: 1,
                failed: 0,
                skipped: 1,
                items,
                operation_error: None,
                message: None,
            })
        })
        .unwrap();

    let record = history.get(receipt.history_id.as_deref().unwrap()).unwrap();
    assert_eq!(record.execution, ExecutionSummary::Partial);
    let MaintenanceDetail::SessionTrash(detail) = record.detail else {
        panic!("expected session detail");
    };
    assert_eq!(detail.scope.mode, SessionRemovalMode::OlderThan);
    assert_eq!(detail.execution_total, Some(2));
    assert_eq!(detail.results.len(), 2);
}

#[test]
fn single_session_buffers_items_into_the_finished_record() {
    let (_directory, history) = store();
    let receipt = remove_session_record(&history, SessionSourceKind::Claude, None, None, || {
        Ok(SessionRemovalResult {
            moved: 1,
            failed: 0,
            skipped: 0,
            items: vec![session_item("only", SessionRemovalStatus::Moved)],
            operation_error: None,
            message: None,
        })
    })
    .unwrap();

    let record = history.get(receipt.history_id.as_deref().unwrap()).unwrap();
    assert_eq!(record.execution, ExecutionSummary::Succeeded);
    let MaintenanceDetail::SessionTrash(detail) = record.detail else {
        panic!("expected session detail");
    };
    assert_eq!(detail.results.len(), 1);
    assert_eq!(detail.results[0].status, "Moved");
}

#[test]
fn vscode_editor_skip_still_finishes_as_partial() {
    let (_directory, history) = store();
    let workspaces = vec![
        VscodeWorkspaceSnapshotInput {
            id: "first".into(),
            name: "first".into(),
            project_path: None,
            storage_path: "/Code/workspaceStorage/first".into(),
            kind: "Folder".into(),
            project_status: "Missing".into(),
            removable: true,
            removal_block_reason: None,
            bytes: Some(10),
            usage_complete: true,
        },
        VscodeWorkspaceSnapshotInput {
            id: "second".into(),
            name: "second".into(),
            project_path: None,
            storage_path: "/Code/workspaceStorage/second".into(),
            kind: "Folder".into(),
            project_status: "Missing".into(),
            removable: true,
            removal_block_reason: None,
            bytes: Some(20),
            usage_complete: true,
        },
    ];
    let items = vec![
        VscodeStorageRemovalItem {
            id: "first".into(),
            status: VscodeStorageRemovalStatus::Moved,
            reason: None,
            message: None,
        },
        VscodeStorageRemovalItem {
            id: "second".into(),
            status: VscodeStorageRemovalStatus::Skipped,
            reason: Some(VscodeStorageRemovalReason::EditorStarted),
            message: None,
        },
    ];
    let receipt = remove_vscode_workspace_storage(&history, workspaces, |sink| {
        for item in &items {
            sink(item);
        }
        Ok(VscodeStorageRemovalResult {
            moved: 1,
            failed: 0,
            skipped: 1,
            items,
            operation_error: None,
            message: None,
        })
    })
    .unwrap();

    let record = history.get(receipt.history_id.as_deref().unwrap()).unwrap();
    assert_eq!(record.execution, ExecutionSummary::Partial);
    let MaintenanceDetail::VscodeStorage(detail) = record.detail else {
        panic!("expected vscode detail");
    };
    assert_eq!(detail.results.len(), 2);
}

#[test]
fn opencode_plan_scope_is_frozen_and_result_is_stored() {
    let (_directory, history) = store();
    let plan = DeletionPlan {
        plan_id: "plan-1".into(),
        kind: DeletionKind::One,
        days: None,
        cutoff_ms: None,
        selected: Vec::new(),
        roots: Vec::new(),
        affected: Vec::new(),
    };
    let items = vec![OpenCodeDeletionItem {
        id: "session-1".into(),
        status: OpenCodeDeletionStatus::Deleted,
        message: None,
    }];
    let receipt = commit_opencode_deletion(&history, &plan, |sink| {
        for item in &items {
            sink(item);
        }
        Ok(OpenCodeDeletionResult {
            preflight_error: None,
            items,
            completed_ids: vec!["session-1".into()],
        })
    })
    .unwrap();

    let record = history.get(receipt.history_id.as_deref().unwrap()).unwrap();
    assert_eq!(record.execution, ExecutionSummary::Succeeded);
    let MaintenanceDetail::OpenCodeDeletion(detail) = record.detail else {
        panic!("expected opencode detail");
    };
    assert_eq!(detail.scope.plan_id, "plan-1");
    assert_eq!(detail.scope.mode, SessionRemovalMode::Single);
    assert_eq!(detail.completed_ids, ["session-1"]);
    assert_eq!(detail.results.len(), 1);
}

#[test]
fn manager_summary_writes_steps_and_verification() {
    let (_directory, history) = store();
    let receipt = run_manager_maintenance(
        &history,
        ManagerId::Npm,
        MaintenanceOperation::CleanupCache,
        None,
        None,
        || 5u32,
        |_| {
            (
                ExecutionSummary::Succeeded,
                "done".into(),
                Some(vec![ManagerStep {
                    label: "清理缓存".into(),
                    state: "succeeded".into(),
                    failure_message: None,
                }]),
            )
        },
    )
    .unwrap();
    let id = receipt.history_id.as_deref().unwrap();
    update_verification(&history, id, "failed", Some("无法读取".into()), None).unwrap();

    let record = history.get(id).unwrap();
    assert_eq!(record.execution, ExecutionSummary::Succeeded);
    assert_eq!(record.message, "done");
    assert_eq!(
        record.verification.as_ref().unwrap().status,
        VerificationStatus::Failed
    );
    let MaintenanceDetail::Manager(detail) = record.detail else {
        panic!("expected manager detail");
    };
    assert_eq!(detail.steps.as_ref().unwrap().len(), 1);
}

#[test]
fn manager_not_executed_skips_verification() {
    let (_directory, history) = store();
    let receipt = run_manager_maintenance(
        &history,
        ManagerId::Npm,
        MaintenanceOperation::CleanupCache,
        None,
        None,
        || 5u32,
        |_| (ExecutionSummary::NotExecuted, "no plan".into(), None),
    )
    .unwrap();

    let record = history.get(receipt.history_id.as_deref().unwrap()).unwrap();
    assert_eq!(
        record.verification.as_ref().unwrap().status,
        VerificationStatus::Skipped
    );
}

#[test]
fn follow_up_is_written_once_for_closed_records() {
    let (_directory, history) = store();
    let id = history
        .begin(
            MaintenanceDomain::SessionRecord,
            MaintenanceOperation::RemoveToTrash,
            session_detail(),
            None,
        )
        .unwrap();
    history
        .finish(&id, ExecutionSummary::NotExecuted, "done".into())
        .unwrap();

    record_followup(&history, &id, "ready", Some("列表已刷新".into())).unwrap();
    assert!(record_followup(&history, &id, "failed", None).is_err());

    let record = history.get(&id).unwrap();
    assert_eq!(
        record.follow_up_read.unwrap().status,
        FollowUpReadStatus::Ready
    );
}

#[test]
fn verification_rejects_non_manager_records() {
    let (_directory, history) = store();
    let id = history
        .begin(
            MaintenanceDomain::SessionRecord,
            MaintenanceOperation::RemoveToTrash,
            session_detail(),
            None,
        )
        .unwrap();

    assert!(update_verification(&history, &id, "failed", None, None).is_err());
}

#[test]
fn project_batch_records_effect_failures_and_untried_candidates() {
    let (_directory, history) = store();
    let candidate = |id: &str, order: usize| ProjectCleanupCandidateSnapshot {
        candidate_id: id.into(),
        kind: ProjectDataKind::RustTarget,
        project_path: format!("/work/{id}"),
        directory_path: format!("/work/{id}/target"),
        order,
        confirmed_bytes: Some(10),
        confirmed_complete: true,
    };
    let id = history
        .begin(
            MaintenanceDomain::ProjectCleanup,
            MaintenanceOperation::CleanBatch,
            MaintenanceDetail::ProjectCleanup(ProjectCleanupDetail {
                scope: ProjectCleanupScope {
                    scan_id: "scan-1".into(),
                    scan_root_id: "root-1".into(),
                    scan_root_path: "/work".into(),
                    batch_id: "batch-1".into(),
                    candidates: vec![candidate("one", 0), candidate("two", 1)],
                },
                finish: ProjectCleanupFinish::Completed,
                results: Vec::new(),
            }),
            None,
        )
        .unwrap();

    finish_project(
        &history,
        &id,
        ProjectCleanupFinish::Stopped,
        vec![("one".into(), "IPC disconnected".into())],
        "stopped".into(),
    )
    .unwrap();

    let record = history.get(&id).unwrap();
    assert_eq!(record.execution, ExecutionSummary::Failed);
    let MaintenanceDetail::ProjectCleanup(detail) = record.detail else {
        panic!("expected project detail");
    };
    assert_eq!(detail.finish, ProjectCleanupFinish::Stopped);
    assert_eq!(
        detail.results[0].effect_failure_message.as_deref(),
        Some("IPC disconnected")
    );
    let summary = history.list().records[0].clone();
    assert_eq!(summary.counts.failed, 1);
    assert_eq!(summary.counts.not_attempted, 1);
}
