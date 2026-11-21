import { Channel, invoke } from "@tauri-apps/api/core";
import type { CleanupBatchSummary, ProjectCleanupEffects } from "./projectCleanupWorkflow";
import type {
  ProjectCleanupBatchProgress,
  ProjectCleanupSettings,
  ProjectScanHistoryRead,
  ProjectScanSummary,
  ProjectScanProgress,
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
    runScan: ({ rootId, maxDepth, onProgress }) => {
      const progress = new Channel<ProjectScanProgress>(onProgress);
      return invoke<ProjectScanSummary>("run_project_scan", { rootId, maxDepth, onProgress: progress });
    },
    requestScanStop: (scanId) => invoke("request_project_scan_stop", { scanId }),
    runBatch: ({ scanId, batchId, candidateIds, onProgress }) => {
      const progress = new Channel<ProjectCleanupBatchProgress>(onProgress);
      return invoke<CleanupBatchSummary>("run_project_cleanup_batch", {
        scanId,
        batchId,
        candidateIds,
        onProgress: progress,
      });
    },
    requestStop: (batchId) =>
      invoke("request_project_cleanup_stop", { batchId }),
    openRoot: (rootId) => invoke("open_project_cleanup_root", { rootId }),
    openCandidate: (input) => invoke("open_project_data_path", input),
    readScanHistory: (presetIds) =>
      invoke<ProjectScanHistoryRead>("list_project_scan_history", { presetIds }),
  };
}
