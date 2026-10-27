mod claude_cli;
mod claude_documents;
mod claude_hooks;
mod claude_plugin_details;
mod claude_plugins;
mod claude_skills;
mod codex_cli;
mod codex_hooks;
mod codex_marketplaces;
mod codex_plugin_details;
mod codex_plugins;
mod codex_skills;
mod command;
mod command_location_association;
mod disk_usage;
mod environment_inspection;
mod grok_sessions;
mod maintenance_history;
mod manager_history;
mod managers;
mod observation_ledger;
mod observed_file;
mod opencode_deletion;
mod opencode_sessions;
mod project_cleanup;
mod project_scan_history;
mod scan_diagnostics;
mod session_records;
mod skill_installation_copy;
mod types;
mod vscode_removal;
mod vscode_storage;

use crate::command::{run_command, run_command_owned};
use crate::disk_usage::disk_usage;
use crate::managers::{
    hydrate_homebrew_cleanup_with_runner, hydrate_pip_outdated_with_runner,
    run_cache_cleanup_with_runner, run_npm_maintenance_with_runner,
    run_pnpm_maintenance_with_runner, scan_manager_snapshot,
};
use crate::project_cleanup::{
    discover_project_data, measure_project_data, run_project_cleanup_with_runner,
    DirectoryMeasurement, ProjectCleanupResult, ProjectCleanupSettings, ProjectCleanupState,
    ProjectDataOpenTarget, ProjectDataScan, ToolAvailability,
};
use crate::types::{
    CacheCleanupRun, DiskUsage, HomebrewCleanupPreview, MaintenanceRunPreview, ManagerId,
    ManagerScanSnapshot, NpmMaintenanceOperation, PipOutdatedPreview, PnpmMaintenanceOperation,
};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
async fn scan_codex_skills(
    state: tauri::State<'_, codex_skills::SkillsState>,
) -> Result<codex_skills::Scan, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.scan())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn prepare_codex_skill(
    request: codex_skills::Request,
    state: tauri::State<'_, codex_skills::SkillsState>,
) -> Result<codex_skills::Preview, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.prepare(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn commit_codex_skill(
    plan_id: String,
    state: tauri::State<'_, codex_skills::SkillsState>,
) -> Result<codex_skills::Outcome, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.commit(&plan_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_codex_skill(
    plan_id: String,
    state: tauri::State<'_, codex_skills::SkillsState>,
) -> Result<(), String> {
    state.cancel(&plan_id)
}

#[tauri::command]
async fn read_codex_skill(
    snapshot_id: String,
    path: String,
    state: tauri::State<'_, codex_skills::SkillsState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.details(&snapshot_id, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_claude_skills(
    state: tauri::State<'_, claude_skills::SkillsState>,
) -> Result<claude_skills::Scan, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.scan())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn prepare_claude_skill(
    request: claude_skills::Request,
    state: tauri::State<'_, claude_skills::SkillsState>,
) -> Result<claude_skills::Preview, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.prepare(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn commit_claude_skill(
    plan_id: String,
    state: tauri::State<'_, claude_skills::SkillsState>,
) -> Result<claude_skills::Outcome, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.commit(&plan_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_claude_skill(
    plan_id: String,
    state: tauri::State<'_, claude_skills::SkillsState>,
) -> Result<(), String> {
    state.cancel(&plan_id)
}

#[tauri::command]
async fn read_claude_skill(
    snapshot_id: String,
    path: String,
    state: tauri::State<'_, claude_skills::SkillsState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.details(&snapshot_id, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_claude_extensions(
    state: tauri::State<'_, claude_plugins::ExtensionsState>,
) -> Result<claude_plugins::ExtensionScan, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.scan())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn change_claude_extension(
    request: claude_plugins::ChangeRequest,
    state: tauri::State<'_, claude_plugins::ExtensionsState>,
) -> Result<claude_plugins::ChangeResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.change(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_claude_hooks(
    state: tauri::State<'_, claude_hooks::HooksState>,
) -> Result<claude_hooks::HookScan, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.scan())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn prepare_claude_hook(
    request: claude_hooks::DefinitionRequest,
    state: tauri::State<'_, claude_hooks::HooksState>,
) -> Result<claude_hooks::Preview, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.prepare(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn commit_claude_hook(
    request: claude_hooks::CommitRequest,
    state: tauri::State<'_, claude_hooks::HooksState>,
) -> Result<claude_plugins::ChangeResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.commit(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn choose_claude_marketplace_path(
    app: tauri::AppHandle,
    file: bool,
) -> Result<Option<String>, String> {
    let picker = app.dialog().file();
    let selected = if file {
        picker
            .add_filter("Marketplace JSON", &["json"])
            .blocking_pick_file()
    } else {
        picker.blocking_pick_folder()
    };
    selected
        .map(|file| {
            file.into_path()
                .map(|p| p.display().to_string())
                .map_err(|e| e.to_string())
        })
        .transpose()
}

#[tauri::command]
async fn scan_codex_hooks(
    state: tauri::State<'_, codex_hooks::HooksState>,
) -> Result<codex_hooks::HookScan, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.scan())
        .await
        .map_err(|error| format!("Hooks 清单读取失败：{error}"))?
}

#[tauri::command]
async fn prepare_codex_hook_definition(
    request: codex_hooks::DefinitionRequest,
    state: tauri::State<'_, codex_hooks::HooksState>,
) -> Result<codex_hooks::DefinitionPreview, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.prepare_definition(request))
        .await
        .map_err(|error| format!("无法准备 Hook 变更：{error}"))?
}

#[tauri::command]
async fn commit_codex_hook_definition(
    request: codex_hooks::DefinitionCommitRequest,
    state: tauri::State<'_, codex_hooks::HooksState>,
) -> Result<codex_hooks::DefinitionResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.commit_definition(request))
        .await
        .map_err(|error| format!("无法确认 Hook 保存结果：{error}"))?
}

#[tauri::command]
async fn set_codex_hook_enabled(
    request: codex_hooks::HookChangeRequest,
    state: tauri::State<'_, codex_hooks::HooksState>,
) -> Result<codex_hooks::HookChangeResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.set_enabled(request))
        .await
        .map_err(|error| format!("Hook 设置保存失败：{error}"))?
}

#[tauri::command]
async fn scan_codex_marketplaces(
    state: tauri::State<'_, codex_marketplaces::MarketplacesState>,
) -> Result<codex_marketplaces::MarketplaceScan, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.scan())
        .await
        .map_err(|error| format!("市场清单读取失败：{error}"))?
}

#[tauri::command]
async fn change_codex_marketplace(
    request: codex_marketplaces::MarketplaceRequest,
    state: tauri::State<'_, codex_marketplaces::MarketplacesState>,
) -> Result<codex_marketplaces::MarketplaceResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.change(request))
        .await
        .map_err(|error| format!("市场操作未能完成：{error}"))?
}

#[tauri::command]
async fn choose_codex_marketplace_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let selected = app.dialog().file().blocking_pick_folder();
    selected
        .map(|file| {
            file.into_path()
                .map(|path| path.display().to_string())
                .map_err(|error| format!("无法读取所选目录：{error}"))
        })
        .transpose()
}

#[tauri::command]
async fn scan_codex_plugins(
    state: tauri::State<'_, codex_plugins::CodexPluginsState>,
) -> Result<codex_plugins::PluginScan, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.scan())
        .await
        .map_err(|error| format!("插件清单读取失败：{error}"))?
}

#[tauri::command]
async fn set_codex_plugin_enabled(
    request: codex_plugins::PluginChangeRequest,
    state: tauri::State<'_, codex_plugins::CodexPluginsState>,
) -> Result<codex_plugins::PluginChangeResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.set_enabled(request))
        .await
        .map_err(|error| format!("插件设置保存失败：{error}"))?
}

#[tauri::command]
async fn change_codex_plugin(
    request: codex_plugins::PluginLifecycleRequest,
    state: tauri::State<'_, codex_plugins::CodexPluginsState>,
) -> Result<codex_plugins::PluginChangeResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.change(request))
        .await
        .map_err(|error| error.to_string())?
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionRecordSnapshotInput {
    id: String,
    title: String,
    working_directory: Option<String>,
    last_activity_ms: Option<i64>,
}

fn session_record_snapshot(
    record: SessionRecordSnapshotInput,
) -> maintenance_history::SessionRecordSnapshot {
    maintenance_history::SessionRecordSnapshot {
        id: record.id,
        title: record.title,
        working_directory: record.working_directory,
        last_activity_ms: record.last_activity_ms,
    }
}

fn session_history_scope(
    source: session_records::SessionSourceKind,
    mode: maintenance_history::SessionRemovalMode,
    days: Option<u64>,
    confirmed_count: Option<usize>,
    confirmed_records: Option<Vec<SessionRecordSnapshotInput>>,
    directory: Option<String>,
    cutoff_ms: Option<i64>,
) -> maintenance_history::MaintenanceDetail {
    maintenance_history::MaintenanceDetail::SessionTrash(maintenance_history::SessionTrashDetail {
        scope: maintenance_history::SessionTrashScope {
            source,
            mode,
            days,
            confirmed_count,
            directory,
            cutoff_ms,
            confirmed_records: confirmed_records
                .map(|records| records.into_iter().map(session_record_snapshot).collect()),
        },
        execution_total: None,
        results: Vec::new(),
    })
}

fn append_session_history(
    history: &maintenance_history::MaintenanceHistoryState,
    history_id: Option<&String>,
    result: &session_records::SessionRemovalResult,
    warning: &mut Option<String>,
) {
    let Some(history_id) = history_id else {
        return;
    };
    for item in &result.items {
        if let Err(error) = history.append_session_item(history_id, item) {
            warning.get_or_insert(error);
            return;
        }
    }
    if let Err(error) = history.finish_session_trash(history_id, result.items.len(), result) {
        warning.get_or_insert(error);
    }
}

fn finish_session_history(
    history: &maintenance_history::MaintenanceHistoryState,
    history_id: Option<&String>,
    result: &session_records::SessionRemovalResult,
    warning: &mut Option<String>,
) {
    if let Some(history_id) = history_id {
        if let Err(error) = history.finish_session_trash(history_id, result.items.len(), result) {
            warning.get_or_insert(error);
        }
    }
}

fn abort_session_history(
    history: &maintenance_history::MaintenanceHistoryState,
    history_id: Option<&String>,
    error: &str,
) {
    if let Some(history_id) = history_id {
        let _ = history.finish(
            history_id,
            maintenance_history::ExecutionSummary::NotExecuted,
            error.to_string(),
        );
    }
}

#[tauri::command]
async fn remove_session_records_older_than(
    source: session_records::SessionSourceKind,
    days: u64,
    confirmed_count: Option<usize>,
    expected_directory: Option<String>,
    cutoff_ms: Option<i64>,
    on_progress: tauri::ipc::Channel<session_records::SessionRemovalProgress>,
    history: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> Result<maintenance_history::Receipt<session_records::SessionRemovalResult>, String> {
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (history_id, mut warning) = match history.begin(
            maintenance_history::MaintenanceDomain::SessionRecord,
            maintenance_history::MaintenanceOperation::RemoveToTrash,
            session_history_scope(
                source,
                maintenance_history::SessionRemovalMode::OlderThan,
                Some(days),
                confirmed_count,
                None,
                expected_directory.clone(),
                cutoff_ms,
            ),
            None,
        ) {
            Ok(id) => (Some(id), None),
            Err(error) => (None, Some(error)),
        };
        let item_warning = Arc::new(Mutex::new(None::<String>));
        let item_sink = item_warning.clone();
        let item_history = history.clone();
        let item_history_id = history_id.clone();
        let mut on_item = move |item: &session_records::SessionRemovalItem| {
            if let Some(id) = &item_history_id {
                if let Err(error) = item_history.append_session_item(id, item) {
                    *item_sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(error);
                }
            }
        };
        let mut report = |progress| {
            let _ = on_progress.send(progress);
        };
        let execution = if matches!(source, session_records::SessionSourceKind::Grok) {
            if !matches!(days, 7 | 30)
                || !cutoff_ms.is_some_and(|cutoff| {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|value| value.as_millis().min(i64::MAX as u128) as i64)
                        .unwrap_or(0);
                    cutoff <= now.saturating_sub((days as i64).saturating_mul(86_400_000))
                })
            {
                Err("Grok Build 按年龄移除需要已确认的 7／30 天门槛".into())
            } else {
                grok_sessions::remove_default(
                    expected_directory.as_deref(),
                    None,
                    cutoff_ms,
                    &mut report,
                    &mut on_item,
                )
            }
        } else {
            session_records::remove_older_default_with_reporter(
                source,
                days,
                &mut report,
                &mut on_item,
            )
        };
        let result = match execution {
            Ok(result) => result,
            Err(error) => {
                abort_session_history(&history, history_id.as_ref(), &error);
                return Err(error);
            }
        };
        if let Some(error) = item_warning
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            warning.get_or_insert(error);
        }
        finish_session_history(&history, history_id.as_ref(), &result, &mut warning);
        Ok(maintenance_history::Receipt {
            result,
            history_id,
            history_warning: warning,
        })
    })
    .await
    .map_err(|error| format!("会话记录移除失败：{error}"))?
}

#[tauri::command]
async fn remove_session_record(
    source: session_records::SessionSourceKind,
    id: String,
    confirmed_record: Option<SessionRecordSnapshotInput>,
    expected_directory: Option<String>,
    history: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> Result<maintenance_history::Receipt<session_records::SessionRemovalResult>, String> {
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (history_id, mut warning) = match history.begin(
            maintenance_history::MaintenanceDomain::SessionRecord,
            maintenance_history::MaintenanceOperation::RemoveToTrash,
            session_history_scope(
                source,
                maintenance_history::SessionRemovalMode::Single,
                None,
                Some(1),
                confirmed_record.map(|record| vec![record]),
                expected_directory.clone(),
                None,
            ),
            None,
        ) {
            Ok(id) => (Some(id), None),
            Err(error) => (None, Some(error)),
        };
        let execution = if matches!(source, session_records::SessionSourceKind::Grok) {
            grok_sessions::remove_default(
                expected_directory.as_deref(),
                Some(&[id.clone()]),
                None,
                &mut |_| {},
                &mut |_| {},
            )
        } else {
            session_records::remove_default(source, &id)
        };
        let result = match execution {
            Ok(result) => result,
            Err(error) => {
                abort_session_history(&history, history_id.as_ref(), &error);
                return Err(error);
            }
        };
        append_session_history(&history, history_id.as_ref(), &result, &mut warning);
        Ok(maintenance_history::Receipt {
            result,
            history_id,
            history_warning: warning,
        })
    })
    .await
    .map_err(|error| format!("会话记录移除失败：{error}"))?
}

#[tauri::command]
async fn remove_session_records(
    source: session_records::SessionSourceKind,
    ids: Vec<String>,
    confirmed_records: Vec<SessionRecordSnapshotInput>,
    expected_directory: Option<String>,
    on_progress: tauri::ipc::Channel<session_records::SessionRemovalProgress>,
    history: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> Result<maintenance_history::Receipt<session_records::SessionRemovalResult>, String> {
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (history_id, mut warning) = match history.begin(
            maintenance_history::MaintenanceDomain::SessionRecord,
            maintenance_history::MaintenanceOperation::RemoveToTrash,
            session_history_scope(
                source,
                maintenance_history::SessionRemovalMode::Selected,
                None,
                Some(confirmed_records.len()),
                Some(confirmed_records),
                expected_directory.clone(),
                None,
            ),
            None,
        ) {
            Ok(id) => (Some(id), None),
            Err(error) => (None, Some(error)),
        };
        let item_warning = Arc::new(Mutex::new(None::<String>));
        let item_sink = item_warning.clone();
        let item_history = history.clone();
        let item_history_id = history_id.clone();
        let mut on_item = move |item: &session_records::SessionRemovalItem| {
            if let Some(id) = &item_history_id {
                if let Err(error) = item_history.append_session_item(id, item) {
                    *item_sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(error);
                }
            }
        };
        let mut report = |progress| {
            let _ = on_progress.send(progress);
        };
        let execution = if matches!(source, session_records::SessionSourceKind::Grok) {
            grok_sessions::remove_default(
                expected_directory.as_deref(),
                Some(&ids),
                None,
                &mut report,
                &mut on_item,
            )
        } else {
            session_records::remove_selected_default_with_reporter(
                source,
                &ids,
                &mut report,
                &mut on_item,
            )
        };
        let result = match execution {
            Ok(result) => result,
            Err(error) => {
                abort_session_history(&history, history_id.as_ref(), &error);
                return Err(error);
            }
        };
        if let Some(error) = item_warning
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            warning.get_or_insert(error);
        }
        finish_session_history(&history, history_id.as_ref(), &result, &mut warning);
        Ok(maintenance_history::Receipt {
            result,
            history_id,
            history_warning: warning,
        })
    })
    .await
    .map_err(|error| format!("会话记录移除失败：{error}"))?
}

#[tauri::command]
async fn scan_session_records() -> Result<session_records::SessionRecordScan, String> {
    tauri::async_runtime::spawn_blocking(session_records::scan_default)
        .await
        .map_err(|error| format!("会话记录读取失败：{error}"))?
}

#[tauri::command]
async fn scan_session_source(
    source: session_records::SessionSourceKind,
) -> Result<session_records::SessionSourceScan, String> {
    tauri::async_runtime::spawn_blocking(move || session_records::scan_source_default(source))
        .await
        .map_err(|error| format!("会话记录读取失败：{error}"))?
}

#[tauri::command]
async fn scan_opencode_sessions() -> opencode_sessions::OpenCodeSessionScan {
    tauri::async_runtime::spawn_blocking(opencode_sessions::scan_default)
        .await
        .unwrap_or_else(|_| opencode_sessions::OpenCodeSessionScan {
            status: opencode_sessions::OpenCodeScanStatus::Failed,
            records: Vec::new(),
            message: Some("OpenCode 会话读取任务未能完成。".into()),
            active_session_ids: None,
            activity_message: None,
        })
}

#[tauri::command]
async fn open_grok_session(id: String, expected_directory: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        grok_sessions::open_default(&id, &expected_directory)
    })
    .await
    .map_err(|_| "无法启动 Grok Build 会话".to_string())?
}

#[tauri::command]
async fn open_opencode_session(session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || opencode_sessions::open_default(&session_id))
        .await
        .map_err(|_| "OpenCode 会话打开任务未能完成。".to_string())?
}

#[tauri::command]
async fn prepare_opencode_deletion(
    request: opencode_deletion::PrepareRequest,
    state: tauri::State<'_, opencode_deletion::DeletionState>,
) -> Result<opencode_deletion::DeletionPlan, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.prepare(request))
        .await
        .map_err(|_| "OpenCode 删除计划准备任务未能完成。".to_string())?
}

fn opencode_mode(kind: opencode_deletion::DeletionKind) -> maintenance_history::SessionRemovalMode {
    match kind {
        opencode_deletion::DeletionKind::One => {
            maintenance_history::SessionRemovalMode::Single
        }
        opencode_deletion::DeletionKind::Selected => {
            maintenance_history::SessionRemovalMode::Selected
        }
        opencode_deletion::DeletionKind::Age => {
            maintenance_history::SessionRemovalMode::OlderThan
        }
    }
}

fn opencode_session_snapshot(
    record: &opencode_sessions::OpenCodeSessionRecord,
) -> maintenance_history::OpenCodeSessionSnapshot {
    maintenance_history::OpenCodeSessionSnapshot {
        id: record.id.clone(),
        title: record.title.clone(),
        working_directory: Some(record.working_directory.clone()),
        last_activity_ms: record.last_activity_ms,
        archived: record.archived,
        parent_id: record.parent_id.clone(),
    }
}

#[tauri::command]
async fn commit_opencode_deletion(
    plan_id: String,
    state: tauri::State<'_, opencode_deletion::DeletionState>,
    history: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> Result<maintenance_history::Receipt<opencode_deletion::OpenCodeDeletionResult>, String> {
    let state = state.inner().clone();
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let plan = state.peek_plan(&plan_id)?;
        let detail = maintenance_history::MaintenanceDetail::OpenCodeDeletion(
            maintenance_history::OpenCodeDeletionDetail {
                scope: maintenance_history::OpenCodeDeletionScope {
                    source: "opencode".into(),
                    mode: opencode_mode(plan.kind),
                    plan_id: plan.plan_id.clone(),
                    days: plan.days,
                    cutoff_ms: plan.cutoff_ms,
                    confirmed_roots: plan
                        .roots
                        .iter()
                        .map(opencode_session_snapshot)
                        .collect(),
                    confirmed_affected: plan
                        .affected
                        .iter()
                        .map(opencode_session_snapshot)
                        .collect(),
                },
                completed_ids: Vec::new(),
                results: Vec::new(),
            },
        );
        let (history_id, mut warning) = match history.begin(
            maintenance_history::MaintenanceDomain::SessionRecord,
            maintenance_history::MaintenanceOperation::DeletePermanently,
            detail,
            None,
        ) {
            Ok(id) => (Some(id), None),
            Err(error) => (None, Some(error)),
        };
        let item_warning = Arc::new(Mutex::new(None::<String>));
        let item_sink = item_warning.clone();
        let item_history = history.clone();
        let item_history_id = history_id.clone();
        let mut on_item = move |item: &opencode_deletion::OpenCodeDeletionItem| {
            if let Some(id) = &item_history_id {
                if let Err(error) = item_history.append_opencode_item(id, item) {
                    *item_sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(error);
                }
            }
        };
        let result = match state.commit_with_reporter(&plan_id, &mut on_item) {
            Ok(result) => result,
            Err(error) => {
                if let Some(id) = &history_id {
                    let _ = history.finish(
                        id,
                        maintenance_history::ExecutionSummary::NotExecuted,
                        error.clone(),
                    );
                }
                return Err(error);
            }
        };
        if let Some(error) = item_warning
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            warning.get_or_insert(error);
        }
        if let Some(id) = &history_id {
            if let Err(error) = history.finish_opencode(id, &result) {
                warning.get_or_insert(error);
            }
        }
        Ok(maintenance_history::Receipt {
            result,
            history_id,
            history_warning: warning,
        })
    })
    .await
    .map_err(|_| "OpenCode 会话删除任务未能完成。".to_string())?
}

#[tauri::command]
async fn scan_vscode_storage() -> Result<vscode_storage::VscodeStorageScan, String> {
    tauri::async_runtime::spawn_blocking(vscode_storage::scan_default)
        .await
        .map_err(|error| format!("VS Code 占用扫描失败：{error}"))?
}

#[tauri::command]
async fn get_vscode_editor_status() -> vscode_removal::VscodeEditorStatus {
    tauri::async_runtime::spawn_blocking(vscode_removal::detect_editor_status)
        .await
        .unwrap_or(vscode_removal::VscodeEditorStatus::Unknown)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct VscodeWorkspaceSnapshotInput {
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

#[tauri::command]
async fn remove_vscode_workspace_storage(
    ids: Vec<String>,
    confirmed_workspaces: Vec<VscodeWorkspaceSnapshotInput>,
    on_progress: tauri::ipc::Channel<vscode_removal::VscodeStorageRemovalProgress>,
    history: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> Result<maintenance_history::Receipt<vscode_removal::VscodeStorageRemovalResult>, String> {
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let detail = maintenance_history::MaintenanceDetail::VscodeStorage(
            maintenance_history::VscodeStorageDetail {
                scope: maintenance_history::VscodeStorageScope {
                    workspaces: confirmed_workspaces
                        .into_iter()
                        .map(|workspace| maintenance_history::VscodeWorkspaceSnapshot {
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
            },
        );
        let (history_id, mut warning) = match history.begin(
            maintenance_history::MaintenanceDomain::VscodeStorage,
            maintenance_history::MaintenanceOperation::RemoveWorkspaceStorage,
            detail,
            None,
        ) {
            Ok(id) => (Some(id), None),
            Err(error) => (None, Some(error)),
        };
        let item_warning = Arc::new(Mutex::new(None::<String>));
        let item_sink = item_warning.clone();
        let item_history = history.clone();
        let item_history_id = history_id.clone();
        let mut on_item = move |item: &vscode_removal::VscodeStorageRemovalItem| {
            if let Some(id) = &item_history_id {
                if let Err(error) = item_history.append_vscode_item(id, item) {
                    *item_sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(error);
                }
            }
        };
        let result = match vscode_removal::remove_selected_default_with_reporter(
            &ids,
            &mut |progress| {
                let _ = on_progress.send(progress);
            },
            &mut on_item,
        ) {
            Ok(result) => result,
            Err(error) => {
                if let Some(id) = &history_id {
                    let _ = history.finish(
                        id,
                        maintenance_history::ExecutionSummary::NotExecuted,
                        error.clone(),
                    );
                }
                return Err(error);
            }
        };
        if let Some(error) = item_warning
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            warning.get_or_insert(error);
        }
        if let Some(id) = &history_id {
            if let Err(error) = history.finish_vscode(id, &result) {
                warning.get_or_insert(error);
            }
        }
        Ok(maintenance_history::Receipt {
            result,
            history_id,
            history_warning: warning,
        })
    })
    .await
    .map_err(|error| format!("VS Code 工作区存储移除失败：{error}"))?
}

#[tauri::command]
fn get_project_cleanup_settings(
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<ProjectCleanupSettings, String> {
    state.settings()
}

#[tauri::command]
fn select_project_cleanup_preset(
    preset_id: String,
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<ProjectCleanupSettings, String> {
    state.select_preset(&preset_id)
}

#[tauri::command]
fn remove_project_cleanup_preset(
    preset_id: String,
    state: tauri::State<'_, ProjectCleanupState>,
    scan_history: tauri::State<'_, project_scan_history::ProjectScanHistoryState>,
) -> Result<ProjectCleanupSettings, String> {
    let settings = state.remove_preset(&preset_id)?;
    // Preset removal must still succeed if the history file is unreadable;
    // orphaned entries are pruned on the next launch.
    let _ = scan_history.remove_preset(&preset_id);
    Ok(settings)
}

#[tauri::command]
fn update_project_cleanup_depth(
    preset_id: String,
    max_depth: u8,
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<ProjectCleanupSettings, String> {
    state.update_depth(&preset_id, max_depth)
}

#[tauri::command]
async fn list_project_scan_history(
    preset_ids: Vec<String>,
    state: tauri::State<'_, project_scan_history::ProjectScanHistoryState>,
) -> Result<project_scan_history::ProjectScanHistoryRead, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.list(&preset_ids))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn record_project_scan_history(
    draft: project_scan_history::ProjectScanRecordDraft,
    state: tauri::State<'_, project_scan_history::ProjectScanHistoryState>,
) -> Result<project_scan_history::ProjectScanRecord, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.record(draft))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn choose_project_cleanup_root(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<Option<ProjectCleanupSettings>, String> {
    #[cfg(desktop)]
    {
        let selected = app.dialog().file().blocking_pick_folder();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected
            .into_path()
            .map_err(|err| format!("Could not resolve selected directory: {err}"))?;
        return state.authorize_root(path).map(Some);
    }

    #[cfg(mobile)]
    {
        let _ = app;
        let _ = state;
        Err("Project cleanup directory selection is only available on desktop".to_string())
    }
}

#[tauri::command]
async fn scan_project_data(
    root_id: String,
    max_depth: u8,
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<ProjectDataScan, String> {
    let (root_path, max_depth, scan_id) = state.prepare_scan(&root_id, max_depth)?;
    let scan_root = root_path.clone();
    let (discovery, tools) = tauri::async_runtime::spawn_blocking(move || {
        let discovery = discover_project_data(&scan_root, max_depth);
        let (cargo_available, cargo_message) = probe_tool("cargo");
        let (maven_available, maven_message) = if discovery.has_maven_candidates() {
            probe_tool("mvn")
        } else {
            (true, None)
        };
        (
            discovery,
            ToolAvailability {
                cargo_available,
                cargo_message,
                maven_available,
                maven_message,
            },
        )
    })
    .await
    .map_err(|err| format!("Project data scan failed: {err}"))?;
    state.install_scan(&root_id, scan_id, root_path, max_depth, discovery, tools)
}

fn probe_tool(program: &str) -> (bool, Option<String>) {
    match run_command(program, &["--version"], std::time::Duration::from_secs(5)) {
        Ok(run) if run.exit_code == Some(0) => (true, None),
        Ok(run) => (
            false,
            Some(run.stderr.trim().to_string()).filter(|message| !message.is_empty()),
        ),
        Err(failure) => (false, Some(failure.message)),
    }
}

#[tauri::command]
async fn measure_project_data_candidate(
    scan_id: String,
    candidate_id: String,
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<DirectoryMeasurement, String> {
    let candidate = state.candidate_for_measurement(&scan_id, &candidate_id)?;
    let kind = candidate.kind;
    let directory_path = candidate.directory_path.clone();
    let measurement =
        tauri::async_runtime::spawn_blocking(move || measure_project_data(kind, &directory_path))
            .await
            .map_err(|err| format!("Project data measurement failed: {err}"))?;
    state.apply_measurement(&scan_id, &candidate_id, measurement)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MaintenanceHistoryBegin {
    history_id: Option<String>,
    history_warning: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectCleanupEffectFailure {
    candidate_id: String,
    message: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanProjectDataCandidateReceipt {
    #[serde(flatten)]
    result: ProjectCleanupResult,
    history_warning: Option<String>,
}

#[tauri::command]
fn begin_project_cleanup_history(
    scan_id: String,
    batch_id: String,
    candidate_ids: Vec<String>,
    state: tauri::State<'_, ProjectCleanupState>,
    history: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> MaintenanceHistoryBegin {
    let (root_id, root_path, candidates) = match state.history_scope(&scan_id, &candidate_ids) {
        Ok(scope) => scope,
        Err(warning) => {
            return MaintenanceHistoryBegin {
                history_id: None,
                history_warning: Some(warning),
            }
        }
    };
    let detail = maintenance_history::MaintenanceDetail::ProjectCleanup(
        maintenance_history::ProjectCleanupDetail {
            scope: maintenance_history::ProjectCleanupScope {
                scan_id,
                scan_root_id: root_id,
                scan_root_path: root_path,
                batch_id,
                candidates: candidates
                    .into_iter()
                    .enumerate()
                    .map(|(order, candidate)| maintenance_history::ProjectCleanupCandidateSnapshot {
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
            finish: maintenance_history::ProjectCleanupFinish::Completed,
            results: Vec::new(),
        },
    );
    match history.begin(
        maintenance_history::MaintenanceDomain::ProjectCleanup,
        maintenance_history::MaintenanceOperation::CleanBatch,
        detail,
        None,
    ) {
        Ok(history_id) => MaintenanceHistoryBegin {
            history_id: Some(history_id),
            history_warning: None,
        },
        Err(warning) => MaintenanceHistoryBegin {
            history_id: None,
            history_warning: Some(warning),
        },
    }
}

#[tauri::command]
async fn clean_project_data_candidate(
    scan_id: String,
    candidate_id: String,
    history_id: Option<String>,
    state: tauri::State<'_, ProjectCleanupState>,
    history: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> Result<CleanProjectDataCandidateReceipt, String> {
    let (root_path, candidate) = state.cleanup_context(&scan_id, &candidate_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_project_cleanup_with_runner(&root_path, &candidate, &run_command_owned)
    })
    .await
    .map_err(|err| format!("Project cleanup failed: {err}"))?;
    state.apply_cleanup_result(&scan_id, &result)?;
    let history_warning = history_id.and_then(|id| {
        history
            .append_project_result(&id, &result)
            .err()
    });
    Ok(CleanProjectDataCandidateReceipt {
        result,
        history_warning,
    })
}

#[tauri::command]
fn finish_project_cleanup_history(
    history_id: String,
    finish: maintenance_history::ProjectCleanupFinish,
    effect_failures: Vec<ProjectCleanupEffectFailure>,
    message: Option<String>,
    history: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> Option<String> {
    history
        .finish_project(
            &history_id,
            finish,
            effect_failures
                .into_iter()
                .map(|failure| (failure.candidate_id, failure.message))
                .collect(),
            message.unwrap_or_else(|| "项目清理批次已结束".into()),
        )
        .err()
}

#[tauri::command]
fn open_project_cleanup_root(
    app: tauri::AppHandle,
    root_id: String,
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<(), String> {
    let path = state.root_path(&root_id)?;
    app.opener()
        .open_path(path.display().to_string(), None::<String>)
        .map_err(|err| format!("Could not open project cleanup root: {err}"))
}

#[tauri::command]
fn open_project_data_path(
    app: tauri::AppHandle,
    scan_id: String,
    candidate_id: String,
    target: ProjectDataOpenTarget,
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<(), String> {
    let path = state.candidate_path(&scan_id, &candidate_id, target)?;
    app.opener()
        .open_path(path.display().to_string(), None::<String>)
        .map_err(|err| format!("Could not open project data path: {err}"))
}

#[tauri::command]
async fn inspect_environment(managers: Vec<ManagerId>) -> Result<environment_inspection::Inspection, String> {
    tauri::async_runtime::spawn_blocking(move || environment_inspection::inspect(&managers)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn associate_command_locations(
    request: command_location_association::Request,
) -> Result<command_location_association::Association, String> {
    tauri::async_runtime::spawn_blocking(move || command_location_association::associate(request))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_observation_ledger(state: tauri::State<'_, observation_ledger::ObservationLedgerState>) -> Result<observation_ledger::LedgerLoad, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.load()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn record_observation(event: observation_ledger::ObservationEvent, state: tauri::State<'_, observation_ledger::ObservationLedgerState>) -> Result<observation_ledger::LedgerWrite, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.record(event)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn load_observation_scopes(enabled_managers: Vec<ManagerId>) -> Result<std::collections::BTreeMap<String, Option<observation_ledger::ObservationScope>>, String> {
    tauri::async_runtime::spawn_blocking(move || observation_ledger::scopes(&enabled_managers)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_manager_snapshot(draft: manager_history::SnapshotDraft, state: tauri::State<'_, manager_history::HistoryState>) -> Result<manager_history::ArchivedSnapshot, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.save(draft)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_manager_history(manager: ManagerId, state: tauri::State<'_, manager_history::HistoryState>) -> Result<manager_history::History, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.list(manager)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_maintenance_verification(id: String, status: String, message: Option<String>, after_snapshot_id: Option<String>, state: tauri::State<'_, maintenance_history::MaintenanceHistoryState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.verify(&id, &status, message, after_snapshot_id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_maintenance_history(state: tauri::State<'_, maintenance_history::MaintenanceHistoryState>) -> Result<maintenance_history::History, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.list()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_maintenance_record(id: String, state: tauri::State<'_, maintenance_history::MaintenanceHistoryState>) -> Result<maintenance_history::MaintenanceRecord, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.get(&id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn record_maintenance_followup(id: String, status: String, message: Option<String>, state: tauri::State<'_, maintenance_history::MaintenanceHistoryState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.record_followup(&id, &status, message)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_manager(manager: ManagerId) -> Result<ManagerScanSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || scan_manager_snapshot(manager))
        .await
        .map_err(|err| format!("Package manager scan failed: {err}"))
}

#[tauri::command]
async fn measure_path_size(path: String) -> Result<DiskUsage, String> {
    tauri::async_runtime::spawn_blocking(move || disk_usage(Path::new(&path)))
        .await
        .map_err(|err| format!("Size scan failed: {err}"))
}

#[tauri::command]
async fn hydrate_homebrew_cleanup() -> Result<HomebrewCleanupPreview, String> {
    tauri::async_runtime::spawn_blocking(move || hydrate_homebrew_cleanup_with_runner(&run_command))
        .await
        .map_err(|err| format!("Homebrew cleanup dry-run failed: {err}"))
}

#[tauri::command]
async fn hydrate_pip_outdated(python_executable: String) -> Result<PipOutdatedPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        hydrate_pip_outdated_with_runner(&python_executable, &run_command_owned)
    })
    .await
    .map_err(|err| format!("pip outdated hydration failed: {err}"))
}

#[tauri::command]
async fn run_npm_maintenance(
    operation: NpmMaintenanceOperation,
    before_snapshot_id: Option<String>,
    state: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> Result<maintenance_history::Receipt<MaintenanceRunPreview>, String> {
    let state = state.inner().clone();
    let NpmMaintenanceOperation::UninstallGlobalPackage { ref package_name } = operation;
    let target = package_name.clone();
    tauri::async_runtime::spawn_blocking(move || state.run(ManagerId::Npm, maintenance_history::MaintenanceOperation::UninstallGlobalPackage, Some(target), before_snapshot_id,
        || run_npm_maintenance_with_runner(operation, &run_command_owned), maintenance_history::uninstall_summary))
        .await.map_err(|err| format!("npm maintenance failed: {err}"))
}

#[tauri::command]
async fn run_pnpm_maintenance(
    operation: PnpmMaintenanceOperation,
    before_snapshot_id: Option<String>,
    state: tauri::State<'_, maintenance_history::MaintenanceHistoryState>,
) -> Result<maintenance_history::Receipt<MaintenanceRunPreview>, String> {
    let state = state.inner().clone();
    let PnpmMaintenanceOperation::UninstallGlobalPackage { ref package_name } = operation;
    let target = package_name.clone();
    tauri::async_runtime::spawn_blocking(move || state.run(ManagerId::Pnpm, maintenance_history::MaintenanceOperation::UninstallGlobalPackage, Some(target), before_snapshot_id,
        || run_pnpm_maintenance_with_runner(operation, &run_command_owned), maintenance_history::uninstall_summary))
        .await.map_err(|err| format!("pnpm maintenance failed: {err}"))
}

/// Execution remains manager-only and allowlisted. The optional archive ID is
/// observation metadata and grants no authority over commands or paths.
#[tauri::command]
async fn run_cache_cleanup(manager: ManagerId, before_snapshot_id: Option<String>, state: tauri::State<'_, maintenance_history::MaintenanceHistoryState>) -> Result<maintenance_history::Receipt<CacheCleanupRun>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.run(manager, maintenance_history::MaintenanceOperation::CleanupCache, None, before_snapshot_id,
        || run_cache_cleanup_with_runner(manager, &run_command_owned), maintenance_history::cleanup_summary))
        .await.map_err(|err| format!("Cache cleanup failed: {err}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(codex_hooks::HooksState::default())
        .manage(codex_skills::SkillsState::default())
        .manage(claude_plugins::ExtensionsState::default())
        .manage(claude_hooks::HooksState::default())
        .manage(claude_skills::SkillsState::default())
        .manage(codex_plugins::CodexPluginsState::default())
        .manage(codex_marketplaces::MarketplacesState::default())
        .manage(opencode_deletion::DeletionState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Keep the existing filename so an upgrade preserves the selected root.
            let settings_path = app
                .path()
                .app_config_dir()
                .map_err(|err| format!("Could not resolve app config directory: {err}"))?
                .join("build-artifacts.json");
            let project_cleanup_state = ProjectCleanupState::load(settings_path);
            let preset_ids = project_cleanup_state.settings().ok().map(|settings| {
                settings
                    .presets
                    .into_iter()
                    .map(|preset| preset.id)
                    .collect::<Vec<_>>()
            });
            app.manage(project_cleanup_state);
            let data_directory = app.path().app_data_dir()?;
            let history_directory = data_directory.join("manager-history");
            app.manage(manager_history::HistoryState::new(history_directory.clone()));
            app.manage(maintenance_history::MaintenanceHistoryState::new(history_directory));
            app.manage(observation_ledger::ObservationLedgerState::new(
                data_directory.join("observation-ledger.json"),
            ));
            let project_scan_history = project_scan_history::ProjectScanHistoryState::new(
                data_directory.join("project-scan-history.json"),
            );
            if let Some(preset_ids) = preset_ids {
                let _ = project_scan_history.prune_presets(&preset_ids);
            }
            app.manage(project_scan_history);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_claude_skills,
            prepare_claude_skill,
            commit_claude_skill,
            cancel_claude_skill,
            read_claude_skill,
            scan_codex_skills,
            prepare_codex_skill,
            commit_codex_skill,
            cancel_codex_skill,
            read_codex_skill,
            scan_claude_extensions,
            change_claude_extension,
            scan_claude_hooks,
            prepare_claude_hook,
            commit_claude_hook,
            choose_claude_marketplace_path,
            scan_codex_hooks,
            prepare_codex_hook_definition,
            commit_codex_hook_definition,
            set_codex_hook_enabled,
            scan_codex_marketplaces,
            change_codex_marketplace,
            choose_codex_marketplace_directory,
            scan_codex_plugins,
            set_codex_plugin_enabled,
            change_codex_plugin,
            remove_session_record,
            remove_session_records,
            remove_session_records_older_than,
            scan_session_records,
            scan_session_source,
            scan_opencode_sessions,
            open_opencode_session,
            open_grok_session,
            prepare_opencode_deletion,
            commit_opencode_deletion,
            scan_vscode_storage,
            get_vscode_editor_status,
            remove_vscode_workspace_storage,
            get_project_cleanup_settings,
            choose_project_cleanup_root,
            select_project_cleanup_preset,
            remove_project_cleanup_preset,
            update_project_cleanup_depth,
            list_project_scan_history,
            record_project_scan_history,
            scan_project_data,
            measure_project_data_candidate,
            begin_project_cleanup_history,
            clean_project_data_candidate,
            finish_project_cleanup_history,
            open_project_cleanup_root,
            open_project_data_path,
            inspect_environment,
            associate_command_locations,
            load_observation_ledger,
            record_observation,
            load_observation_scopes,
            save_manager_snapshot,
            list_manager_history,
            list_maintenance_history,
            get_maintenance_record,
            record_maintenance_followup,
            update_maintenance_verification,
            scan_manager,
            measure_path_size,
            hydrate_homebrew_cleanup,
            hydrate_pip_outdated,
            run_npm_maintenance,
            run_pnpm_maintenance,
            run_cache_cleanup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
