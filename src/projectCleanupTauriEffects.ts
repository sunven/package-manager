import { invoke } from "@tauri-apps/api/core";
import type { ProjectCleanupEffects } from "./projectCleanupWorkflow";
import type {
  DirectoryMeasurement,
  ProjectCleanupResult,
  ProjectCleanupSettings,
  ProjectDataScan,
} from "./types";

export function createTauriProjectCleanupEffects(): ProjectCleanupEffects {
  return {
    readSettings: () =>
      invoke<ProjectCleanupSettings>("get_project_cleanup_settings"),
    chooseRoot: () =>
      invoke<ProjectCleanupSettings | null>("choose_project_cleanup_root"),
    selectPreset: (presetId) => invoke<ProjectCleanupSettings>("select_project_cleanup_preset", { presetId }),
    removePreset: (presetId) => invoke<ProjectCleanupSettings>("remove_project_cleanup_preset", { presetId }),
    updateDepth: (presetId, maxDepth) => invoke<ProjectCleanupSettings>("update_project_cleanup_depth", { presetId, maxDepth }),
    scan: (input) => invoke<ProjectDataScan>("scan_project_data", input),
    measure: (input) =>
      invoke<DirectoryMeasurement>("measure_project_data_candidate", input),
    clean: (input) =>
      invoke<ProjectCleanupResult>("clean_project_data_candidate", input),
    beginHistory: (input) => invoke("begin_project_cleanup_history", input),
    finishHistory: (input) => invoke<string | null>("finish_project_cleanup_history", input),
    openRoot: (rootId) => invoke("open_project_cleanup_root", { rootId }),
    openCandidate: (input) => invoke("open_project_data_path", input),
  };
}
