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
    clean: (manager) => invoke("run_cache_cleanup", { manager }),
    uninstall: (manager, packageName) => invoke(manager === "Pnpm" ? "run_pnpm_maintenance" : "run_npm_maintenance", {
      operation: { kind: "uninstallGlobalPackage", packageName },
    }),
  };
}
