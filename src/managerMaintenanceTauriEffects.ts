import { invoke } from "@tauri-apps/api/core";
import { readEnabledManagers, writeEnabledManagers } from "./managerSettings";
import type { ManagerMaintenanceEffects } from "./managerMaintenanceWorkflow";

export function createManagerMaintenanceTauriEffects(): ManagerMaintenanceEffects {
  return {
    readEnabled: readEnabledManagers,
    writeEnabled: writeEnabledManagers,
    scan: (manager) => invoke("scan_manager", { manager }),
    measure: (path) => invoke("measure_path_size", { path }),
    readHomebrewCleanup: () => invoke("hydrate_homebrew_cleanup"),
    readPipOutdated: (pythonExecutable) => invoke("hydrate_pip_outdated", { pythonExecutable }),
    saveSnapshot: (draft) => invoke("save_manager_snapshot", { draft }),
    recordVerification: (id, status, message, afterSnapshotId) => invoke("update_maintenance_verification", { id, status, message, afterSnapshotId }),
    clean: (manager, beforeSnapshotId) => invoke("run_cache_cleanup", { manager, beforeSnapshotId: beforeSnapshotId ?? null }),
    uninstall: (manager, packageName, beforeSnapshotId) => invoke(manager === "Pnpm" ? "run_pnpm_maintenance" : "run_npm_maintenance", {
      beforeSnapshotId: beforeSnapshotId ?? null,
      operation: { kind: "uninstallGlobalPackage", packageName },
    }),
  };
}
