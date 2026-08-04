mod command;
mod disk_usage;
mod managers;
mod project_cleanup;
mod types;

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
    ProjectDataOpenTarget, ProjectDataScan,
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
fn get_project_cleanup_settings(
    state: tauri::State<'_, ProjectCleanupState>,
) -> Result<ProjectCleanupSettings, String> {
    state.settings()
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
    let (discovery, cargo_available, cargo_message) =
        tauri::async_runtime::spawn_blocking(move || {
            let discovery = discover_project_data(&scan_root, max_depth);
            let cargo_probe =
                run_command("cargo", &["--version"], std::time::Duration::from_secs(5));
            match cargo_probe {
                Ok(run) if run.exit_code == Some(0) => (discovery, true, None),
                Ok(run) => (
                    discovery,
                    false,
                    Some(run.stderr.trim().to_string()).filter(|message| !message.is_empty()),
                ),
                Err(failure) => (discovery, false, Some(failure.message)),
            }
        })
        .await
        .map_err(|err| format!("Project data scan failed: {err}"))?;
    state.install_scan(
        &root_id,
        scan_id,
        root_path,
        max_depth,
        discovery,
        cargo_available,
        cargo_message,
    )
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
            get_project_cleanup_settings,
            choose_project_cleanup_root,
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
