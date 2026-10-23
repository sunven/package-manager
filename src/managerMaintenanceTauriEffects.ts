import { Channel, invoke } from "@tauri-apps/api/core";
import { readEnabledManagers, writeEnabledManagers } from "./managerSettings";
import type { ManagerMaintenanceEffects } from "./managerMaintenanceWorkflow";
import type { ManagerScanProgress, ManagerScanSnapshot } from "./types";

export function createManagerMaintenanceTauriEffects(): ManagerMaintenanceEffects {
  return {
    readEnabled: readEnabledManagers,
    writeEnabled: writeEnabledManagers,
    scan: (manager, onProgress) => {
      const progress = new Channel<ManagerScanProgress>(onProgress);
      return invoke<ManagerScanSnapshot>("scan_manager", { manager, onProgress: progress });
    },
    saveSnapshot: (draft) => invoke("save_manager_snapshot", { draft }),
    recordVerification: (id, status, message, afterSnapshotId) => invoke("update_maintenance_verification", { id, status, message, afterSnapshotId }),
    clean: (manager, beforeSnapshotId) => invoke("run_cache_cleanup", { manager, beforeSnapshotId: beforeSnapshotId ?? null }),
    uninstall: (manager, packageName, beforeSnapshotId) => invoke(manager === "Pnpm" ? "run_pnpm_maintenance" : "run_npm_maintenance", {
      beforeSnapshotId: beforeSnapshotId ?? null,
      operation: { kind: "uninstallGlobalPackage", packageName },
    }),
  };
}
