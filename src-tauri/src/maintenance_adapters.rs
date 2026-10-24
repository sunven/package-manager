use crate::maintenance_history::{
    now, optional_text, text, ExecutionSummary, FollowUpRead, FollowUpReadStatus,
    MaintenanceDetail, MaintenanceDomain, MaintenanceHistoryState, MaintenanceOperation,
    ManagerDetail, ManagerStep, OpenCodeDeletionDetail, OpenCodeDeletionItemSnapshot,
    OpenCodeDeletionScope, OpenCodeSessionSnapshot, ProjectCleanupDetail, ProjectCleanupFinish,
    ProjectCleanupTargetResult, SessionRecordSnapshot, SessionRemovalItemSnapshot,
    SessionRemovalMode, SessionTrashDetail, SessionTrashScope, Verification, VerificationStatus,
    VscodeStorageDetail, VscodeStorageItemSnapshot, VscodeStorageScope, VscodeWorkspaceSnapshot,
};
use crate::maintenance_operation::{run, OperationEnd, OperationHeader, Receipt};
use crate::opencode_deletion::{
    DeletionKind, DeletionPlan, OpenCodeDeletionItem, OpenCodeDeletionResult,
};
use crate::opencode_sessions::OpenCodeSessionRecord;
use crate::project_cleanup::ProjectCleanupResult;
use crate::session_records::{SessionRemovalItem, SessionRemovalResult, SessionSourceKind};
use crate::types::{
    CacheCleanupRun, CleanupOutcome, CleanupStepState, MaintenanceRunPreview, ManagerId,
};
use crate::vscode_removal::{VscodeStorageRemovalItem, VscodeStorageRemovalResult};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRecordSnapshotInput {
    id: String,
    title: String,
    working_directory: Option<String>,
    last_activity_ms: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VscodeWorkspaceSnapshotInput {
    id: String,
    name: String,
    project_path: Option<String>,
    storage_path: String,
    kind: String,
    project_status: String,
    removable: bool,
    removal_block_reason: Option<String>,
    bytes: Option<u64>,
    usage_complete: bool,
}

fn session_record_snapshot(record: SessionRecordSnapshotInput) -> SessionRecordSnapshot {
    SessionRecordSnapshot {
        id: record.id,
        title: record.title,
        working_directory: record.working_directory,
        last_activity_ms: record.last_activity_ms,
    }
}

fn session_detail(
    source: SessionSourceKind,
    mode: SessionRemovalMode,
    days: Option<u64>,
    confirmed_count: Option<usize>,
    confirmed_records: Option<Vec<SessionRecordSnapshotInput>>,
) -> MaintenanceDetail {
    MaintenanceDetail::SessionTrash(SessionTrashDetail {
        scope: SessionTrashScope {
            source,
            mode,
            days,
            confirmed_count,
            confirmed_records: confirmed_records
                .map(|records| records.into_iter().map(session_record_snapshot).collect()),
        },
        execution_total: None,
        results: Vec::new(),
    })
}

pub(crate) fn remove_sessions_older_than(
    history: &MaintenanceHistoryState,
    source: SessionSourceKind,
    days: u64,
    confirmed_count: Option<usize>,
    execute: impl FnOnce(&mut dyn FnMut(&SessionRemovalItem)) -> Result<SessionRemovalResult, String>,
) -> Result<Receipt<SessionRemovalResult>, String> {
    run(
        history,
        OperationHeader {
            domain: MaintenanceDomain::SessionRecord,
            operation: MaintenanceOperation::RemoveToTrash,
            detail: session_detail(
                source,
                SessionRemovalMode::OlderThan,
                Some(days),
                confirmed_count,
                None,
            ),
            before_snapshot_id: None,
        },
        execute,
        append_session_item,
        finish_streamed_session,
    )
}

pub(crate) fn remove_session_record(
    history: &MaintenanceHistoryState,
    source: SessionSourceKind,
    confirmed_record: Option<SessionRecordSnapshotInput>,
    execute: impl FnOnce() -> Result<SessionRemovalResult, String>,
) -> Result<Receipt<SessionRemovalResult>, String> {
    run(
        history,
        OperationHeader {
            domain: MaintenanceDomain::SessionRecord,
            operation: MaintenanceOperation::RemoveToTrash,
            detail: session_detail(
                source,
                SessionRemovalMode::Single,
                None,
                Some(1),
                confirmed_record.map(|record| vec![record]),
            ),
            before_snapshot_id: None,
        },
        |_sink| execute(),
        |_, _, _: &SessionRemovalItem| Ok(()),
        finish_buffered_session,
    )
}

pub(crate) fn remove_sessions_selected(
    history: &MaintenanceHistoryState,
    source: SessionSourceKind,
    confirmed_records: Vec<SessionRecordSnapshotInput>,
    execute: impl FnOnce(&mut dyn FnMut(&SessionRemovalItem)) -> Result<SessionRemovalResult, String>,
) -> Result<Receipt<SessionRemovalResult>, String> {
    let confirmed_count = Some(confirmed_records.len());
    run(
        history,
        OperationHeader {
            domain: MaintenanceDomain::SessionRecord,
            operation: MaintenanceOperation::RemoveToTrash,
            detail: session_detail(
                source,
                SessionRemovalMode::Selected,
                None,
                confirmed_count,
                Some(confirmed_records),
            ),
            before_snapshot_id: None,
        },
        execute,
        append_session_item,
        finish_streamed_session,
    )
}

fn session_item_snapshot(item: &SessionRemovalItem) -> SessionRemovalItemSnapshot {
    SessionRemovalItemSnapshot {
        id: item.id.clone(),
        status: format!("{:?}", item.status),
        reason: item.reason.as_ref().map(|reason| format!("{reason:?}")),
        message: optional_text(item.message.clone()),
    }
}

fn append_session_item(
    history: &MaintenanceHistoryState,
    id: &str,
    item: &SessionRemovalItem,
) -> Result<(), String> {
    let snapshot = session_item_snapshot(item);
    history.update(id, move |record| {
        if let MaintenanceDetail::SessionTrash(detail) = &mut record.detail {
            detail.results.retain(|row| row.id != snapshot.id);
            detail.results.push(snapshot);
        }
        Ok(())
    })
}

fn finish_streamed_session(
    history: &MaintenanceHistoryState,
    id: &str,
    end: OperationEnd<'_, SessionRemovalResult>,
) -> Result<(), String> {
    match end {
        OperationEnd::Completed(result) => {
            finish_session_trash(history, id, result.items.len(), result)
        }
        OperationEnd::Aborted(error) => abort(history, id, error),
    }
}

fn finish_buffered_session(
    history: &MaintenanceHistoryState,
    id: &str,
    end: OperationEnd<'_, SessionRemovalResult>,
) -> Result<(), String> {
    match end {
        OperationEnd::Completed(result) => {
            for item in &result.items {
                append_session_item(history, id, item)?;
            }
            finish_session_trash(history, id, result.items.len(), result)
        }
        OperationEnd::Aborted(error) => abort(history, id, error),
    }
}

fn finish_session_trash(
    history: &MaintenanceHistoryState,
    id: &str,
    execution_total: usize,
    result: &SessionRemovalResult,
) -> Result<(), String> {
    let execution = session_execution(result);
    let message = text(
        result
            .message
            .clone()
            .or_else(|| result.operation_error.clone())
            .unwrap_or_else(|| {
                format!(
                    "已移入 {} 项，跳过 {} 项，失败 {} 项。",
                    result.moved, result.skipped, result.failed
                )
            }),
    );
    history.update(id, move |record| {
        if let MaintenanceDetail::SessionTrash(detail) = &mut record.detail {
            detail.execution_total = Some(execution_total);
        }
        record.finished_at = Some(now());
        record.execution = execution;
        record.message = message;
        Ok(())
    })
}

fn session_execution(result: &SessionRemovalResult) -> ExecutionSummary {
    if result.operation_error.is_some() {
        return ExecutionSummary::NotExecuted;
    }
    execution_from_counts(
        result.items.len(),
        result.moved as usize,
        result.failed as usize,
        result.skipped as usize,
        0,
    )
}

fn vscode_detail(workspaces: Vec<VscodeWorkspaceSnapshotInput>) -> MaintenanceDetail {
    MaintenanceDetail::VscodeStorage(VscodeStorageDetail {
        scope: VscodeStorageScope {
            workspaces: workspaces
                .into_iter()
                .map(|workspace| VscodeWorkspaceSnapshot {
                    id: workspace.id,
                    name: workspace.name,
                    project_path: workspace.project_path,
                    storage_path: workspace.storage_path,
                    kind: workspace.kind,
                    project_status: workspace.project_status,
                    removable: workspace.removable,
                    removal_block_reason: workspace.removal_block_reason,
                    bytes: workspace.bytes,
                    usage_complete: workspace.usage_complete,
                })
                .collect(),
        },
        results: Vec::new(),
    })
}

pub(crate) fn remove_vscode_workspace_storage(
    history: &MaintenanceHistoryState,
    confirmed_workspaces: Vec<VscodeWorkspaceSnapshotInput>,
    execute: impl FnOnce(
        &mut dyn FnMut(&VscodeStorageRemovalItem),
    ) -> Result<VscodeStorageRemovalResult, String>,
) -> Result<Receipt<VscodeStorageRemovalResult>, String> {
    run(
        history,
        OperationHeader {
            domain: MaintenanceDomain::VscodeStorage,
            operation: MaintenanceOperation::RemoveWorkspaceStorage,
            detail: vscode_detail(confirmed_workspaces),
            before_snapshot_id: None,
        },
        execute,
        append_vscode_item,
        finish_vscode,
    )
}

fn vscode_item_snapshot(item: &VscodeStorageRemovalItem) -> VscodeStorageItemSnapshot {
    VscodeStorageItemSnapshot {
        id: item.id.clone(),
        status: format!("{:?}", item.status),
        reason: item.reason.as_ref().map(|reason| format!("{reason:?}")),
        message: optional_text(item.message.clone()),
    }
}

fn append_vscode_item(
    history: &MaintenanceHistoryState,
    id: &str,
    item: &VscodeStorageRemovalItem,
) -> Result<(), String> {
    let snapshot = vscode_item_snapshot(item);
    history.update(id, move |record| {
        if let MaintenanceDetail::VscodeStorage(detail) = &mut record.detail {
            detail.results.retain(|row| row.id != snapshot.id);
            detail.results.push(snapshot);
        }
        Ok(())
    })
}

fn finish_vscode(
    history: &MaintenanceHistoryState,
    id: &str,
    end: OperationEnd<'_, VscodeStorageRemovalResult>,
) -> Result<(), String> {
    match end {
        OperationEnd::Completed(result) => {
            let execution = vscode_execution(result);
            let message = text(
                result
                    .message
                    .clone()
                    .or_else(|| result.operation_error.clone())
                    .unwrap_or_else(|| {
                        format!(
                            "已移入 {} 项，跳过 {} 项，失败 {} 项。",
                            result.moved, result.skipped, result.failed
                        )
                    }),
            );
            history.finish(id, execution, message)
        }
        OperationEnd::Aborted(error) => abort(history, id, error),
    }
}

fn vscode_execution(result: &VscodeStorageRemovalResult) -> ExecutionSummary {
    if result.operation_error.is_some() {
        return ExecutionSummary::NotExecuted;
    }
    execution_from_counts(
        result.items.len(),
        result.moved as usize,
        result.failed as usize,
        result.skipped as usize,
        0,
    )
}

fn opencode_session_snapshot(record: &OpenCodeSessionRecord) -> OpenCodeSessionSnapshot {
    OpenCodeSessionSnapshot {
        id: record.id.clone(),
        title: record.title.clone(),
        working_directory: Some(record.working_directory.clone()),
        last_activity_ms: record.last_activity_ms,
        archived: record.archived,
        parent_id: record.parent_id.clone(),
    }
}

fn opencode_detail(plan: &DeletionPlan) -> MaintenanceDetail {
    MaintenanceDetail::OpenCodeDeletion(OpenCodeDeletionDetail {
        scope: OpenCodeDeletionScope {
            source: "opencode".into(),
            mode: opencode_mode(plan.kind),
            plan_id: plan.plan_id.clone(),
            days: plan.days,
            cutoff_ms: plan.cutoff_ms,
            confirmed_roots: plan.roots.iter().map(opencode_session_snapshot).collect(),
            confirmed_affected: plan
                .affected
                .iter()
                .map(opencode_session_snapshot)
                .collect(),
        },
        completed_ids: Vec::new(),
        results: Vec::new(),
    })
}

fn opencode_mode(kind: DeletionKind) -> SessionRemovalMode {
    match kind {
        DeletionKind::One => SessionRemovalMode::Single,
        DeletionKind::Selected => SessionRemovalMode::Selected,
        DeletionKind::Age => SessionRemovalMode::OlderThan,
    }
}

pub(crate) fn commit_opencode_deletion(
    history: &MaintenanceHistoryState,
    plan: &DeletionPlan,
    execute: impl FnOnce(
        &mut dyn FnMut(&OpenCodeDeletionItem),
    ) -> Result<OpenCodeDeletionResult, String>,
) -> Result<Receipt<OpenCodeDeletionResult>, String> {
    run(
        history,
        OperationHeader {
            domain: MaintenanceDomain::SessionRecord,
            operation: MaintenanceOperation::DeletePermanently,
            detail: opencode_detail(plan),
            before_snapshot_id: None,
        },
        execute,
        append_opencode_item,
        finish_opencode,
    )
}

fn append_opencode_item(
    history: &MaintenanceHistoryState,
    id: &str,
    item: &OpenCodeDeletionItem,
) -> Result<(), String> {
    let snapshot = OpenCodeDeletionItemSnapshot {
        id: item.id.clone(),
        status: format!("{:?}", item.status),
        message: optional_text(item.message.clone()),
    };
    history.update(id, move |record| {
        if let MaintenanceDetail::OpenCodeDeletion(detail) = &mut record.detail {
            detail.results.retain(|row| row.id != snapshot.id);
            detail.results.push(snapshot);
        }
        Ok(())
    })
}

fn finish_opencode(
    history: &MaintenanceHistoryState,
    id: &str,
    end: OperationEnd<'_, OpenCodeDeletionResult>,
) -> Result<(), String> {
    match end {
        OperationEnd::Completed(result) => {
            let execution = opencode_execution(result);
            let message = text(
                result
                    .preflight_error
                    .clone()
                    .or_else(|| {
                        result
                            .items
                            .iter()
                            .find(|item| item.message.is_some())
                            .and_then(|item| item.message.clone())
                    })
                    .unwrap_or_else(|| {
                        format!(
                            "已删除 {} 项，未完成 {} 项。",
                            result
                                .items
                                .iter()
                                .filter(|item| formats_item_status(&item.status, "Deleted"))
                                .count(),
                            result
                                .items
                                .iter()
                                .filter(|item| !formats_item_status(&item.status, "Deleted"))
                                .count()
                        )
                    }),
            );
            let completed_ids = result.completed_ids.clone();
            history.update(id, move |record| {
                if let MaintenanceDetail::OpenCodeDeletion(detail) = &mut record.detail {
                    detail.completed_ids = completed_ids;
                }
                record.finished_at = Some(now());
                record.execution = execution;
                record.message = message;
                Ok(())
            })
        }
        OperationEnd::Aborted(error) => abort(history, id, error),
    }
}

fn opencode_execution(result: &OpenCodeDeletionResult) -> ExecutionSummary {
    if result.preflight_error.is_some() {
        return ExecutionSummary::NotExecuted;
    }
    let total = result.items.len();
    let succeeded = result
        .items
        .iter()
        .filter(|item| formats_item_status(&item.status, "Deleted"))
        .count();
    let failed = result
        .items
        .iter()
        .filter(|item| formats_item_status(&item.status, "Failed"))
        .count();
    let not_attempted = result
        .items
        .iter()
        .filter(|item| formats_item_status(&item.status, "NotAttempted"))
        .count();
    execution_from_counts(total, succeeded, failed, 0, not_attempted)
}

pub(crate) fn run_manager_maintenance<T: Serialize>(
    history: &MaintenanceHistoryState,
    manager: ManagerId,
    operation: MaintenanceOperation,
    target: Option<String>,
    before_snapshot_id: Option<String>,
    execute: impl FnOnce() -> T,
    summarize: impl FnOnce(&T) -> (ExecutionSummary, String, Option<Vec<ManagerStep>>),
) -> Result<Receipt<T>, String> {
    run(
        history,
        OperationHeader {
            domain: MaintenanceDomain::Manager,
            operation,
            detail: MaintenanceDetail::Manager(ManagerDetail {
                manager_id: manager,
                target,
                steps: None,
            }),
            before_snapshot_id,
        },
        |_sink| Ok(execute()),
        |_, _, _: &()| Ok(()),
        |history, id, end| match end {
            OperationEnd::Completed(result) => {
                let (execution, message, steps) = summarize(result);
                history.update(id, move |record| {
                    if let MaintenanceDetail::Manager(detail) = &mut record.detail {
                        detail.steps = steps;
                    }
                    record.finished_at = Some(now());
                    record.execution = execution;
                    record.message = text(message);
                    if execution == ExecutionSummary::NotExecuted {
                        if let Some(verification) = &mut record.verification {
                            verification.status = VerificationStatus::Skipped;
                            verification.recorded_at = Some(now());
                            if verification.message.is_none() {
                                verification.message = Some("维护未执行，无需核对。".into());
                            }
                        }
                    }
                    Ok(())
                })
            }
            OperationEnd::Aborted(error) => abort(history, id, error),
        },
    )
}

pub(crate) fn append_project_result(
    history: &MaintenanceHistoryState,
    id: &str,
    result: &ProjectCleanupResult,
) -> Result<(), String> {
    let snapshot = ProjectCleanupTargetResult {
        candidate_id: result.candidate_id.clone(),
        status: format!("{:?}", result.status),
        command: result
            .command
            .as_ref()
            .map(|command| command.preview.clone()),
        before_bytes: Some(result.before_bytes),
        after_bytes: Some(result.after_bytes),
        cleaned_bytes: Some(result.cleaned_bytes),
        measurement_status: format!("{:?}", result.measurement.status),
        message: optional_text(result.message.clone()),
        failure_message: optional_text(
            result
                .failure
                .as_ref()
                .map(|failure| failure.message.clone()),
        ),
        effect_failure_message: None,
    };
    history.update(id, move |record| {
        if let MaintenanceDetail::ProjectCleanup(detail) = &mut record.detail {
            detail
                .results
                .retain(|item| item.candidate_id != snapshot.candidate_id);
            detail.results.push(snapshot);
        }
        Ok(())
    })
}

pub(crate) fn finish_project(
    history: &MaintenanceHistoryState,
    id: &str,
    finish: ProjectCleanupFinish,
    effect_failures: Vec<(String, String)>,
    message: String,
) -> Result<(), String> {
    history.update(id, move |record| {
        let MaintenanceDetail::ProjectCleanup(detail) = &mut record.detail else {
            return Err("维护记录类型不匹配".into());
        };
        detail.finish = finish;
        for (candidate_id, failure) in effect_failures {
            if !detail
                .scope
                .candidates
                .iter()
                .any(|candidate| candidate.candidate_id == candidate_id)
            {
                continue;
            }
            detail
                .results
                .retain(|item| item.candidate_id != candidate_id);
            detail.results.push(ProjectCleanupTargetResult {
                candidate_id,
                status: "Failed".into(),
                command: None,
                before_bytes: None,
                after_bytes: None,
                cleaned_bytes: None,
                measurement_status: "Error".into(),
                message: None,
                failure_message: None,
                effect_failure_message: Some(text(failure)),
            });
        }
        record.execution = project_execution(detail);
        record.finished_at = Some(now());
        record.message = text(message);
        Ok(())
    })
}

fn project_execution(detail: &ProjectCleanupDetail) -> ExecutionSummary {
    let total = detail.scope.candidates.len();
    let succeeded = detail
        .results
        .iter()
        .filter(|result| result.status == "Succeeded")
        .count();
    let failed = detail
        .results
        .iter()
        .filter(|result| {
            result.status == "Failed"
                || result.status == "Rejected"
                || result.effect_failure_message.is_some()
        })
        .count();
    let skipped = detail
        .results
        .iter()
        .filter(|result| result.status == "Skipped")
        .count();
    execution_from_counts(
        total,
        succeeded,
        failed,
        skipped,
        total.saturating_sub(detail.results.len()),
    )
}

pub(crate) fn update_verification(
    history: &MaintenanceHistoryState,
    id: &str,
    status: &str,
    message: Option<String>,
    after_snapshot_id: Option<String>,
) -> Result<(), String> {
    let status = match status {
        "succeeded" => VerificationStatus::Succeeded,
        "failed" => VerificationStatus::Failed,
        "skipped" => VerificationStatus::Skipped,
        "notStarted" => VerificationStatus::NotStarted,
        _ => return Err("无法识别的核对结果".into()),
    };
    history.update(id, move |record| {
        if record.domain != MaintenanceDomain::Manager {
            return Err("该维护记录没有核对步骤".into());
        }
        let manager = match &record.detail {
            MaintenanceDetail::Manager(detail) => detail.manager_id,
            _ => return Err("维护记录类型不匹配".into()),
        };
        let verification = record.verification.get_or_insert(Verification {
            status: VerificationStatus::NotStarted,
            recorded_at: None,
            message: None,
            before_snapshot_id: None,
            after_snapshot_id: None,
        });
        verification.status = status;
        verification.recorded_at = Some(now());
        verification.message = optional_text(message);
        verification.after_snapshot_id =
            after_snapshot_id.filter(|snapshot| history.snapshot_exists(manager, snapshot));
        Ok(())
    })
}

pub(crate) fn record_followup(
    history: &MaintenanceHistoryState,
    id: &str,
    status: &str,
    message: Option<String>,
) -> Result<(), String> {
    let status = match status {
        "notRequested" => FollowUpReadStatus::NotRequested,
        "ready" => FollowUpReadStatus::Ready,
        "failed" => FollowUpReadStatus::Failed,
        _ => return Err("无法识别的后续读取状态".into()),
    };
    history.update(id, move |record| {
        if !matches!(
            record.domain,
            MaintenanceDomain::SessionRecord | MaintenanceDomain::VscodeStorage
        ) {
            return Err("该维护记录没有后续读取步骤".into());
        }
        if record.finished_at.is_none() || record.interrupted {
            return Err("维护记录尚未关闭".into());
        }
        if record.follow_up_read.is_some() {
            return Err("后续读取结果已记录".into());
        }
        record.follow_up_read = Some(FollowUpRead {
            status,
            recorded_at: now(),
            message: optional_text(message),
        });
        Ok(())
    })
}

pub(crate) fn cleanup_summary(
    run: &CacheCleanupRun,
) -> (ExecutionSummary, String, Option<Vec<ManagerStep>>) {
    let steps = run
        .steps
        .iter()
        .map(|step| ManagerStep {
            label: step.label.clone(),
            state: match step.state {
                CleanupStepState::Succeeded => "succeeded".into(),
                CleanupStepState::Failed => "failed".into(),
                CleanupStepState::Skipped => "skipped".into(),
            },
            failure_message: step
                .failure
                .as_ref()
                .map(|failure| text(failure.message.clone())),
        })
        .collect::<Vec<_>>();
    let execution = match run.outcome {
        CleanupOutcome::Succeeded => ExecutionSummary::Succeeded,
        CleanupOutcome::PartiallyCompleted => ExecutionSummary::Partial,
        CleanupOutcome::Failed => ExecutionSummary::Failed,
        CleanupOutcome::NoPlan => ExecutionSummary::NotExecuted,
    };
    let step_text = steps
        .iter()
        .map(|step| {
            let state = match step.state.as_str() {
                "succeeded" => "已完成",
                "failed" => "失败",
                _ => "已跳过",
            };
            format!(
                "{}：{state}{}",
                step.label,
                step.failure_message
                    .as_ref()
                    .map(|message| format!(" · {message}"))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let message = run
        .message
        .as_ref()
        .map(|message| format!("{message}\n{step_text}"))
        .unwrap_or(step_text);
    (execution, text(message), Some(steps))
}

pub(crate) fn uninstall_summary(
    run: &MaintenanceRunPreview,
) -> (ExecutionSummary, String, Option<Vec<ManagerStep>>) {
    if matches!(run.status, crate::types::AsyncStatus::Ready) {
        (ExecutionSummary::Succeeded, "全局包卸载已完成".into(), None)
    } else {
        (
            ExecutionSummary::Failed,
            text(
                run.failure
                    .as_ref()
                    .map(|failure| failure.message.clone())
                    .or_else(|| run.message.clone())
                    .unwrap_or_else(|| run.stderr.clone()),
            ),
            None,
        )
    }
}

fn abort(history: &MaintenanceHistoryState, id: &str, error: &str) -> Result<(), String> {
    history.finish(id, ExecutionSummary::NotExecuted, error.to_string())
}

fn execution_from_counts(
    total: usize,
    succeeded: usize,
    failed: usize,
    skipped: usize,
    not_attempted: usize,
) -> ExecutionSummary {
    if succeeded == 0 && failed > 0 {
        return ExecutionSummary::Failed;
    }
    if succeeded > 0 && (failed > 0 || skipped > 0 || not_attempted > 0) {
        return ExecutionSummary::Partial;
    }
    if succeeded > 0 && total == succeeded {
        return ExecutionSummary::Succeeded;
    }
    ExecutionSummary::NotExecuted
}

fn formats_item_status<T: std::fmt::Debug>(status: &T, expected: &str) -> bool {
    format!("{status:?}") == expected
}

#[cfg(test)]
#[path = "maintenance_adapters_tests.rs"]
mod tests;
