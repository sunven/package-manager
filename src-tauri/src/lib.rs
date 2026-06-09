mod command;
mod disk_usage;
mod managers;
mod types;

use crate::command::{run_command, run_command_owned};
use crate::disk_usage::disk_usage;
use crate::managers::{
    hydrate_homebrew_cleanup_with_runner, hydrate_pip_outdated_with_runner, scan_manager_snapshot,
};
use crate::types::{
    DiskUsage, HomebrewCleanupPreview, ManagerId, ManagerScanSnapshot, PipOutdatedPreview,
};
use std::path::Path;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_manager,
            measure_path_size,
            hydrate_homebrew_cleanup,
            hydrate_pip_outdated
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
