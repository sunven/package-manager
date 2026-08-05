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
    scan: (input) => invoke<ProjectDataScan>("scan_project_data", input),
    measure: (input) =>
      invoke<DirectoryMeasurement>("measure_project_data_candidate", input),
    clean: (input) =>
      invoke<ProjectCleanupResult>("clean_project_data_candidate", input),
    openRoot: (rootId) => invoke("open_project_cleanup_root", { rootId }),
    openCandidate: (input) => invoke("open_project_data_path", input),
  };
}
