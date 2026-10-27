use crate::command::run_command_owned;
use crate::maintenance_adapters::{append_project_result, finish_project};
use crate::maintenance_history::{
    ExecutionSummary, MaintenanceDetail, MaintenanceDomain, MaintenanceHistoryState,
    MaintenanceOperation, ProjectCleanupCandidateSnapshot, ProjectCleanupDetail,
    ProjectCleanupFinish, ProjectCleanupScope,
};
use crate::maintenance_operation::{run, OperationEnd, OperationHeader, Receipt};
use crate::project_cleanup::{
    remove_dependency_directory, run_project_cleanup_with_runner_and_deleter, ProjectCleanupResult,
    ProjectCleanupState, ProjectCleanupStatus,
};
use crate::types::{CommandFailure, CommandRun};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum ProjectCleanupBatchOutcome {
    Result {
        result: Box<ProjectCleanupResult>,
    },
    EffectFailed {
        #[serde(rename = "candidateId")]
        candidate_id: String,
        message: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub(crate) enum ProjectCleanupBatchProgress {
    Started {
        total: usize,
    },
    Advanced {
        #[serde(rename = "candidateId")]
        candidate_id: String,
        outcome: ProjectCleanupBatchOutcome,
        #[serde(rename = "completedCount")]
        completed_count: usize,
        #[serde(rename = "cleanedBytes")]
        cleaned_bytes: u64,
    },
}

pub(crate) type ProjectCleanupBatchSummary = Receipt<BatchOutcome>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchOutcome {
    finish: ProjectCleanupFinish,
    total_count: usize,
    completed_count: usize,
    failed_count: usize,
    cleaned_bytes: u64,
    #[serde(skip)]
    effect_failures: Vec<(String, String)>,
}

pub(crate) struct BatchScope<'a> {
    scan_id: &'a str,
    batch_id: &'a str,
    candidate_ids: &'a [String],
}

pub(crate) fn run_batch(
    state: &ProjectCleanupState,
    history: &MaintenanceHistoryState,
    scan_id: &str,
    batch_id: &str,
    candidate_ids: &[String],
    progress: &mut dyn FnMut(ProjectCleanupBatchProgress),
) -> Result<ProjectCleanupBatchSummary, String> {
    let scope = BatchScope {
        scan_id,
        batch_id,
        candidate_ids,
    };
    run_batch_with_runner_and_deleter(
        state,
        history,
        &scope,
        progress,
        &run_command_owned,
        &remove_dependency_directory,
    )
}

pub(crate) fn run_batch_with_runner_and_deleter<F, D>(
    state: &ProjectCleanupState,
    history: &MaintenanceHistoryState,
    scope: &BatchScope<'_>,
    progress: &mut dyn FnMut(ProjectCleanupBatchProgress),
    runner: &F,
    deleter: &D,
) -> Result<ProjectCleanupBatchSummary, String>
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
    D: Fn(&Path) -> Result<(), String>,
{
    if scope.candidate_ids.is_empty() {
        return Err("项目清理批次没有目标".into());
    }
    let mut seen = HashSet::new();
    if scope
        .candidate_ids
        .iter()
        .any(|candidate_id| !seen.insert(candidate_id.as_str()))
    {
        return Err("项目清理批次包含重复目标".into());
    }

    let _guard = state.begin_batch(scope.batch_id)?;
    let detail = match state.history_scope(scope.scan_id, scope.candidate_ids) {
        Ok((root_id, root_path, candidates)) => project_detail(
            scope.scan_id,
            scope.batch_id,
            root_id,
            root_path,
            candidates,
        ),
        Err(error) => {
            let outcome = execute_batch(state, scope, progress, &mut |_| {}, runner, deleter)?;
            return Ok(Receipt {
                result: outcome,
                history_id: None,
                history_warning: Some(error),
            });
        }
    };

    run(
        history,
        OperationHeader {
            domain: MaintenanceDomain::ProjectCleanup,
            operation: MaintenanceOperation::CleanBatch,
            detail,
            before_snapshot_id: None,
        },
        |sink| execute_batch(state, scope, progress, sink, runner, deleter),
        |history, id, outcome| match outcome {
            ProjectCleanupBatchOutcome::Result { result } => {
                append_project_result(history, id, result)
            }
            ProjectCleanupBatchOutcome::EffectFailed { .. } => Ok(()),
        },
        |history, id, end| match end {
            OperationEnd::Completed(outcome) => finish_project(
                history,
                id,
                outcome.finish,
                outcome.effect_failures.clone(),
                "项目清理批次已结束".into(),
            ),
            OperationEnd::Aborted(error) => {
                history.finish(id, ExecutionSummary::NotExecuted, error.to_string())
            }
        },
    )
}

fn execute_batch<F, D>(
    state: &ProjectCleanupState,
    scope: &BatchScope<'_>,
    progress: &mut dyn FnMut(ProjectCleanupBatchProgress),
    record: &mut dyn FnMut(&ProjectCleanupBatchOutcome),
    runner: &F,
    deleter: &D,
) -> Result<BatchOutcome, String>
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
    D: Fn(&Path) -> Result<(), String>,
{
    let total_count = scope.candidate_ids.len();
    progress(ProjectCleanupBatchProgress::Started { total: total_count });

    let mut completed_count = 0;
    let mut failed_count = 0;
    let mut cleaned_bytes = 0u64;
    let mut effect_failures = Vec::new();

    for candidate_id in scope.candidate_ids {
        if state.batch_stopped(scope.batch_id) {
            break;
        }
        let outcome = match state.cleanup_context(scope.scan_id, candidate_id) {
            Ok((root, candidate)) => {
                let result =
                    run_project_cleanup_with_runner_and_deleter(&root, &candidate, runner, deleter);
                match state.apply_cleanup_result(scope.scan_id, &result) {
                    Ok(()) => ProjectCleanupBatchOutcome::Result {
                        result: Box::new(result),
                    },
                    Err(message) => ProjectCleanupBatchOutcome::EffectFailed {
                        candidate_id: candidate_id.clone(),
                        message,
                    },
                }
            }
            Err(message) => ProjectCleanupBatchOutcome::EffectFailed {
                candidate_id: candidate_id.clone(),
                message,
            },
        };

        completed_count += 1;
        match &outcome {
            ProjectCleanupBatchOutcome::Result { result } => {
                cleaned_bytes = cleaned_bytes.saturating_add(result.cleaned_bytes);
                if cleanup_failed(result) {
                    failed_count += 1;
                }
            }
            ProjectCleanupBatchOutcome::EffectFailed {
                candidate_id,
                message,
            } => {
                failed_count += 1;
                effect_failures.push((candidate_id.clone(), message.clone()));
            }
        }
        record(&outcome);
        progress(ProjectCleanupBatchProgress::Advanced {
            candidate_id: candidate_id.clone(),
            outcome,
            completed_count,
            cleaned_bytes,
        });
    }

    Ok(BatchOutcome {
        finish: if state.batch_stopped(scope.batch_id) {
            ProjectCleanupFinish::Stopped
        } else {
            ProjectCleanupFinish::Completed
        },
        total_count,
        completed_count,
        failed_count,
        cleaned_bytes,
        effect_failures,
    })
}

fn cleanup_failed(result: &ProjectCleanupResult) -> bool {
    !matches!(
        result.status,
        ProjectCleanupStatus::Succeeded | ProjectCleanupStatus::Skipped
    )
}

fn project_detail(
    scan_id: &str,
    batch_id: &str,
    root_id: String,
    root_path: String,
    candidates: Vec<crate::project_cleanup::ProjectCleanupHistoryCandidate>,
) -> MaintenanceDetail {
    MaintenanceDetail::ProjectCleanup(ProjectCleanupDetail {
        scope: ProjectCleanupScope {
            scan_id: scan_id.into(),
            scan_root_id: root_id,
            scan_root_path: root_path,
            batch_id: batch_id.into(),
            candidates: candidates
                .into_iter()
                .enumerate()
                .map(|(order, candidate)| ProjectCleanupCandidateSnapshot {
                    candidate_id: candidate.candidate_id,
                    kind: candidate.kind,
                    project_path: candidate.project_path,
                    directory_path: candidate.directory_path,
                    order,
                    confirmed_bytes: candidate.confirmed_bytes,
                    confirmed_complete: candidate.confirmed_complete,
                })
                .collect(),
        },
        finish: ProjectCleanupFinish::Completed,
        results: Vec::new(),
    })
}

#[cfg(test)]
#[path = "project_cleanup_batch_tests.rs"]
mod tests;
