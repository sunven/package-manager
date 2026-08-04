mod build_artifacts;
mod command;
mod disk_usage;
mod managers;
mod types;

use crate::build_artifacts::{
    discover_build_artifacts, measure_build_artifact, run_build_artifact_cleanup_with_runner,
    BuildArtifactCleanupResult, BuildArtifactMeasurement, BuildArtifactOpenTarget,
    BuildArtifactScan, BuildArtifactSettings, BuildArtifactState,
};
use crate::command::{run_command, run_command_owned};
use crate::disk_usage::disk_usage;
use crate::managers::{
    hydrate_homebrew_cleanup_with_runner, hydrate_pip_outdated_with_runner,
    run_cache_cleanup_with_runner, run_npm_maintenance_with_runner,
    run_pnpm_maintenance_with_runner, scan_manager_snapshot,
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
fn get_build_artifact_settings(
    state: tauri::State<'_, BuildArtifactState>,
) -> Result<BuildArtifactSettings, String> {
    state.settings()
}

#[tauri::command]
async fn choose_build_artifact_root(
    app: tauri::AppHandle,
    state: tauri::State<'_, BuildArtifactState>,
) -> Result<Option<BuildArtifactSettings>, String> {
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
        Err("Build artifact directory selection is only available on desktop".to_string())
    }
}

#[tauri::command]
async fn scan_build_artifacts(
    root_id: String,
    max_depth: u8,
    state: tauri::State<'_, BuildArtifactState>,
) -> Result<BuildArtifactScan, String> {
    let (root_path, max_depth, scan_id) = state.prepare_scan(&root_id, max_depth)?;
    let scan_root = root_path.clone();
    let (discovery, cargo_available, cargo_message) =
        tauri::async_runtime::spawn_blocking(move || {
            let discovery = discover_build_artifacts(&scan_root, max_depth);
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
        .map_err(|err| format!("Build artifact scan failed: {err}"))?;
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
async fn measure_build_artifact_candidate(
    scan_id: String,
    candidate_id: String,
    state: tauri::State<'_, BuildArtifactState>,
) -> Result<BuildArtifactMeasurement, String> {
    let candidate = state.candidate_for_measurement(&scan_id, &candidate_id)?;
    let target_path = candidate.target_path.clone();
    let measurement =
        tauri::async_runtime::spawn_blocking(move || measure_build_artifact(&target_path))
            .await
            .map_err(|err| format!("Build artifact measurement failed: {err}"))?;
    state.apply_measurement(&scan_id, &candidate_id, measurement)
}

#[tauri::command]
async fn clean_build_artifact_candidate(
    scan_id: String,
    candidate_id: String,
    state: tauri::State<'_, BuildArtifactState>,
) -> Result<BuildArtifactCleanupResult, String> {
    let (root_path, candidate) = state.cleanup_context(&scan_id, &candidate_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_build_artifact_cleanup_with_runner(&root_path, &candidate, &run_command_owned)
    })
    .await
    .map_err(|err| format!("Build artifact cleanup failed: {err}"))?;
    state.apply_cleanup_result(&scan_id, &result)?;
    Ok(result)
}

#[tauri::command]
fn open_build_artifact_root(
    app: tauri::AppHandle,
    root_id: String,
    state: tauri::State<'_, BuildArtifactState>,
) -> Result<(), String> {
    let path = state.root_path(&root_id)?;
    app.opener()
        .open_path(path.display().to_string(), None::<String>)
        .map_err(|err| format!("Could not open build artifact root: {err}"))
}

#[tauri::command]
fn open_build_artifact_path(
    app: tauri::AppHandle,
    scan_id: String,
    candidate_id: String,
    target: BuildArtifactOpenTarget,
    state: tauri::State<'_, BuildArtifactState>,
) -> Result<(), String> {
    let path = state.candidate_path(&scan_id, &candidate_id, target)?;
    app.opener()
        .open_path(path.display().to_string(), None::<String>)
        .map_err(|err| format!("Could not open build artifact path: {err}"))
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
            let settings_path = app
                .path()
                .app_config_dir()
                .map_err(|err| format!("Could not resolve app config directory: {err}"))?
                .join("build-artifacts.json");
            app.manage(BuildArtifactState::load(settings_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_build_artifact_settings,
            choose_build_artifact_root,
            scan_build_artifacts,
            measure_build_artifact_candidate,
            clean_build_artifact_candidate,
            open_build_artifact_root,
            open_build_artifact_path,
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
