mod claude_cli;
mod claude_documents;
mod claude_hooks;
mod claude_plugin_details;
mod claude_plugins;
mod codex_cli;
mod codex_hooks;
mod codex_marketplaces;
mod codex_plugin_details;
mod codex_plugins;
mod command;
mod disk_usage;
mod managers;
mod project_cleanup;
mod scan_diagnostics;
mod session_records;
mod types;
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
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

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

#[tauri::command]
async fn remove_session_records_older_than(
    source: session_records::SessionSourceKind,
    days: u64,
) -> Result<session_records::SessionRemovalResult, String> {
    tauri::async_runtime::spawn_blocking(move || session_records::remove_older_default(source, days))
        .await
        .map_err(|error| format!("会话记录移除失败：{error}"))?
}

#[tauri::command]
async fn remove_session_record(
    source: session_records::SessionSourceKind,
    id: String,
) -> Result<session_records::SessionRemovalResult, String> {
    tauri::async_runtime::spawn_blocking(move || session_records::remove_default(source, &id))
        .await
        .map_err(|error| format!("会话记录移除失败：{error}"))?
}

#[tauri::command]
async fn remove_session_records(
    source: session_records::SessionSourceKind,
    ids: Vec<String>,
) -> Result<session_records::SessionRemovalResult, String> {
    tauri::async_runtime::spawn_blocking(move || session_records::remove_selected_default(source, &ids))
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
async fn scan_vscode_storage() -> Result<vscode_storage::VscodeStorageScan, String> {
    tauri::async_runtime::spawn_blocking(vscode_storage::scan_default)
        .await
        .map_err(|error| format!("VS Code 占用扫描失败：{error}"))?
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
) -> Result<ProjectCleanupSettings, String> {
    state.remove_preset(&preset_id)
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

#[tauri::command]
async fn clean_project_data_candidate(
    scan_id: String,
    candidate_id: String,
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<ProjectCleanupResult, String> {
    let (root_path, candidate) = state.cleanup_context(&scan_id, &candidate_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_project_cleanup_with_runner(&root_path, &candidate, &run_command_owned)
    })
    .await
    .map_err(|err| format!("Project cleanup failed: {err}"))?;
    state.apply_cleanup_result(&scan_id, &result)?;
    Ok(result)
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
) -> Result<MaintenanceRunPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_npm_maintenance_with_runner(operation, &run_command_owned)
    })
    .await
    .map_err(|err| format!("npm maintenance failed: {err}"))
}

#[tauri::command]
async fn run_pnpm_maintenance(
    operation: PnpmMaintenanceOperation,
) -> Result<MaintenanceRunPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_pnpm_maintenance_with_runner(operation, &run_command_owned)
    })
    .await
    .map_err(|err| format!("pnpm maintenance failed: {err}"))
}

/// Runs the cleanup plan for `manager`.
///
/// `manager` is the entire parameter surface on purpose: the frontend cannot
/// express which command runs, so the allowlist is the static plan table in
/// `managers::cleanup` rather than a convention. See ADR-0001.
#[tauri::command]
async fn run_cache_cleanup(manager: ManagerId) -> Result<CacheCleanupRun, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_cache_cleanup_with_runner(manager, &run_command_owned)
    })
    .await
    .map_err(|err| format!("Cache cleanup failed: {err}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(codex_hooks::HooksState::default())
        .manage(claude_plugins::ExtensionsState::default())
        .manage(claude_hooks::HooksState::default())
        .manage(codex_plugins::CodexPluginsState::default())
        .manage(codex_marketplaces::MarketplacesState::default())
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
            app.manage(ProjectCleanupState::load(settings_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            scan_vscode_storage,
            get_project_cleanup_settings,
            choose_project_cleanup_root,
            select_project_cleanup_preset,
            remove_project_cleanup_preset,
            update_project_cleanup_depth,
            scan_project_data,
            measure_project_data_candidate,
            clean_project_data_candidate,
            open_project_cleanup_root,
            open_project_data_path,
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
