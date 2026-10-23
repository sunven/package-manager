import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createManagerMaintenanceWorkflow } from "../managerMaintenanceWorkflow";
import { createManagerMaintenanceTauriEffects } from "../managerMaintenanceTauriEffects";
import type { HomebrewFilter, ManagerId, MavenFilter, PackageRow, PipFilter, UiMessage } from "../types";
import type { MaintenanceRequest } from "../state";
import { actionFailureTitle, countedSizePath, errorToString, formatBytes, formatHomePathsInText, managerLabel } from "../utils/format";

export interface PackageManagerActions {
  refresh: (managerId?: ManagerId) => Promise<void>;
  refreshEnabled: () => Promise<void>;
  retrySupplement: (kind: "paths" | "homebrew" | "pip") => Promise<void>;
  selectManager: (managerId: ManagerId) => void;
  setManagerEnabled: (managerId: ManagerId, enabled: boolean) => void;
  selectPackage: (index: number | null) => void;
  togglePackageActions: (index: number) => void;
  closePackageActions: () => void;
  copyPath: (path: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
  copyCommand: (payload: string) => Promise<void>;
  copyCleanupCommand: () => Promise<void>;
  requestPackageUninstall: (index: number) => void;
  requestCacheCleanup: () => void;
  cancelMaintenance: () => void;
  confirmMaintenance: () => Promise<void>;
  retryVerification: () => Promise<void>;
  copyPackageAction: (index: number, actionIndex: number) => Promise<void>;
  copyPackage: (index: number) => Promise<void>;
  openPackage: (index: number) => Promise<void>;
  setHomebrewFilter: (filter: HomebrewFilter) => void;
  setMavenFilter: (filter: MavenFilter) => void;
  setPipFilter: (filter: PipFilter) => void;
}

export function usePackageManagers() {
  const [workflow] = useState(() => createManagerMaintenanceWorkflow(createManagerMaintenanceTauriEffects()));
  const view = useSyncExternalStore(workflow.subscribe, workflow.read);
  const {
    enabledManagers, managerSnapshots, scanStates, scanningAll, scanningManagers,
    scanDurationMsByManager, pendingSizeScansByManager, pendingHomebrewCleanup,
    pendingPipOutdated, maintenance, maintenanceBusy, lockedManager,
  } = view;
  const [selectedManager, setSelectedManager] = useState<ManagerId>(() => view.enabledManagers[0] ?? "Npm");
  const [selectedPackageIndex, setSelectedPackageIndex] = useState<number | null>(null);
  const [openPackageActionMenuIndex, setOpenPackageActionMenuIndex] = useState<number | null>(null);
  const [selectedHomebrewFilter, setSelectedHomebrewFilter] = useState<HomebrewFilter>("All");
  const [selectedMavenFilter, setSelectedMavenFilter] = useState<MavenFilter>("All");
  const [selectedPipFilter, setSelectedPipFilter] = useState<PipFilter>("All");
  const [lastCopied, setLastCopied] = useState("");
  const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
  const [uiMessage, setUiMessage] = useState<UiMessage | null>(null);

  const selectedManagerRef = useRef(selectedManager);
  const currentManager = managerSnapshots[selectedManager] ?? null;
  const selectedScanPhase = scanStates[selectedManager]?.phase;
  useEffect(() => {
    if (selectedScanPhase === "queued" || selectedScanPhase === "reading") {
      setSelectedPackageIndex(null);
      setOpenPackageActionMenuIndex(null);
    }
  }, [selectedManager, selectedScanPhase]);

  useEffect(() => {
    setSelectedPackageIndex(null);
    setOpenPackageActionMenuIndex(null);
  }, [currentManager?.packages]);

  const renderMeta = useMemo(() => {
    const parts: string[] = [];
    const pendingSizeScans = pendingSizeScansByManager[selectedManager] ?? 0;
    const scanDurationMs = scanDurationMsByManager[selectedManager];
    if (scanningManagers.has(selectedManager)) parts.push(`正在扫描 ${managerLabel(selectedManager)}...`);
    if (pendingSizeScans > 0) parts.push(`正在统计 ${pendingSizeScans} 个路径...`);
    if (selectedManager === "Homebrew" && pendingHomebrewCleanup) parts.push("正在加载清理预演...");
    if (selectedManager === "Pip" && pendingPipOutdated) parts.push("正在检查 pip 可更新包...");
    if (scanDurationMs !== undefined) parts.push(`扫描耗时 ${scanDurationMs} 毫秒`);
    if (lastCopied) parts.push(`已复制 ${formatHomePathsInText(lastCopied, homeDirectory)}`);
    return parts.join(" · ");
  }, [
    homeDirectory,
    lastCopied,
    pendingHomebrewCleanup,
    pendingPipOutdated,
    pendingSizeScansByManager,
    scanDurationMsByManager,
    scanningManagers,
    selectedManager,
  ]);

  const overview = useMemo(() => {
    const managers = enabledManagers.flatMap((managerId) => {
      const manager = managerSnapshots[managerId];
      return manager ? [manager] : [];
    });
    const totalBytes = managers.reduce((sum, manager) => {
      return (
        sum +
        manager.paths.reduce((pathSum, path) => {
          return countedSizePath(path.kind) ? pathSum + (path.size.bytes ?? 0) : pathSum;
        }, 0)
      );
    }, 0);

    return {
      managerCount: `${managers.length}/${enabledManagers.length}`,
      readyManagers: String(managers.filter((manager) => manager.status === "Ready").length),
      totalPackages: String(managers.reduce((sum, manager) => sum + manager.packages.length, 0)),
      totalBytes: formatBytes(totalBytes),
      unsupported: String(managers.filter((manager) => manager.status === "Unsupported").length),
    };
  }, [enabledManagers, managerSnapshots]);

  const showError = useCallback((title: string, error: unknown) => {
    setUiMessage({
      tone: "bad",
      title,
      message: errorToString(error),
    });
  }, []);

  const clearMessage = useCallback(() => {
    setUiMessage(null);
  }, []);

  const markCopied = useCallback(
    (value: string) => {
      setLastCopied(value);
      clearMessage();
    },
    [clearMessage],
  );

  const refresh = useCallback((managerId = selectedManagerRef.current) => workflow.refresh(managerId), [workflow]);
  const retrySupplement = useCallback((kind: "paths" | "homebrew" | "pip") =>
    workflow.retrySupplement(selectedManagerRef.current, kind), [workflow]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void workflow.refresh(workflow.read().enabledManagers[0] ?? "Npm");
    });
    return () => cancelAnimationFrame(frame);
  }, [workflow]);

  useEffect(() => {
    let active = true;
    void homeDir()
      .then((path) => {
        if (active) setHomeDirectory(path);
      })
      .catch(() => {
        if (active) setHomeDirectory(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const packageAt = useCallback(
    (index: number): PackageRow | null => {
      const manager = workflow.read().managerSnapshots[selectedManagerRef.current];
      if (!manager) return null;
      return manager.packages[index] ?? null;
    },
    [workflow],
  );

  const selectManager = useCallback(
    (managerId: ManagerId) => {
      if (!workflow.read().enabledManagers.includes(managerId)) return;
      selectedManagerRef.current = managerId;
      setSelectedManager(managerId);
      setSelectedPackageIndex(null);
      setOpenPackageActionMenuIndex(null);
      if (!workflow.read().managerSnapshots[managerId] && !workflow.read().scanningManagers.has(managerId)) {
        void refresh(managerId);
      }
    },
    [refresh, workflow],
  );

  const setManagerEnabled = useCallback(
    (managerId: ManagerId, enabled: boolean) => {
      if (!workflow.setManagerEnabled(managerId, enabled)) return;
      const next = workflow.read().enabledManagers;

      if (!next.includes(selectedManagerRef.current)) {
        const nextSelectedManager = next[0] ?? "Npm";
        selectedManagerRef.current = nextSelectedManager;
        setSelectedManager(nextSelectedManager);
        setSelectedPackageIndex(null);
        setOpenPackageActionMenuIndex(null);
        if (!workflow.read().managerSnapshots[nextSelectedManager] && !workflow.read().scanningManagers.has(nextSelectedManager)) {
          void refresh(nextSelectedManager);
        }
      }
    },
    [refresh, workflow],
  );

  const selectPackage = useCallback((index: number | null) => {
    setSelectedPackageIndex(index);
    setOpenPackageActionMenuIndex(null);
  }, []);

  const togglePackageActions = useCallback((index: number) => {
    setOpenPackageActionMenuIndex((current) => (current === index ? null : index));
  }, []);

  const closePackageActions = useCallback(() => {
    setOpenPackageActionMenuIndex(null);
  }, []);

  const copyPathValue = useCallback(
    async (path: string) => {
      try {
        await writeText(path);
        markCopied(path);
      } catch (error) {
        showError(actionFailureTitle("copy-path"), error);
      }
    },
    [markCopied, showError],
  );

  const openPathValue = useCallback(
    async (path: string) => {
      try {
        await openPath(path);
        clearMessage();
      } catch (error) {
        showError(actionFailureTitle("open-path"), error);
      }
    },
    [clearMessage, showError],
  );

  const copyCommand = useCallback(
    async (payload: string) => {
      try {
        await writeText(payload);
        markCopied("命令详情");
      } catch (error) {
        showError(actionFailureTitle("copy-command"), error);
      }
    },
    [markCopied, showError],
  );

  const copyCleanupCommand = useCallback(async () => {
    const cleanup = workflow.read().managerSnapshots.Homebrew?.homebrew?.cleanup;
    if (!cleanup) return;
    try {
      await writeText(cleanup.command.preview);
      markCopied(cleanup.command.preview);
    } catch (error) {
      showError(actionFailureTitle("copy-cleanup-command"), error);
    }
  }, [markCopied, showError, workflow]);

  const copyPackageAction = useCallback(
    async (index: number, actionIndex: number) => {
      const pkg = packageAt(index);
      const packageAction = Number.isNaN(actionIndex) ? null : pkg?.actions[actionIndex];
      if (!packageAction) return;
      try {
        await writeText(packageAction.preview);
        setOpenPackageActionMenuIndex(null);
        markCopied(packageAction.preview);
      } catch (error) {
        showError(actionFailureTitle("copy-package-action"), error);
      }
    },
    [markCopied, packageAt, showError],
  );

  const copyPackage = useCallback(
    async (index: number) => {
      const pkg = packageAt(index);
      if (!pkg) return;
      try {
        await writeText(`${pkg.name}@${pkg.version}`);
        setOpenPackageActionMenuIndex(null);
        markCopied(`${pkg.name}@${pkg.version}`);
      } catch (error) {
        showError(actionFailureTitle("copy-package"), error);
      }
    },
    [markCopied, packageAt, showError],
  );

  const openPackage = useCallback(
    async (index: number) => {
      const pkg = packageAt(index);
      if (!pkg?.path) return;
      try {
        await openPath(pkg.path);
        setOpenPackageActionMenuIndex(null);
        clearMessage();
      } catch (error) {
        showError(actionFailureTitle("open-package"), error);
      }
    },
    [clearMessage, packageAt, showError],
  );

  const requestPackageUninstall = useCallback((index: number) => {
    const managerId = selectedManagerRef.current;
    const pkg = packageAt(index);
    if (!pkg) {
      setUiMessage({ tone: "warn", title: "暂时无法卸载全局包", message: "清单中的软件包已不存在；请刷新后重新选择。" });
      return;
    }
    if (managerId !== "Npm" && managerId !== "Pnpm") return;
    const request: MaintenanceRequest = { kind: "uninstallGlobalPackage", managerId, packageName: pkg.name, packageIndex: index };
    const blocked = workflow.maintenanceBlockReason(request);
    if (blocked) {
      setUiMessage({ tone: "warn", title: "暂时无法卸载全局包", message: blocked });
      return;
    }
    if (workflow.requestPackageUninstall(managerId, pkg.name)) setOpenPackageActionMenuIndex(null);
  }, [packageAt, workflow]);

  const requestCacheCleanupAction = useCallback(() => {
    const managerId = selectedManagerRef.current;
    const request: MaintenanceRequest = { kind: "cleanupCache", managerId };
    const blocked = workflow.maintenanceBlockReason(request);
    if (blocked) {
      setUiMessage({ tone: "warn", title: "暂时无法准备清理", message: blocked });
      return;
    }
    workflow.requestCacheCleanup(managerId);
  }, [workflow]);

  // Capture the rendered operation ID so callbacks from an old dialog cannot
  // confirm or dismiss a newer request.
  const operationId = maintenance?.id;
  const cancelMaintenance = () => {
    if (operationId !== undefined) workflow.cancelMaintenance(operationId);
  };
  const confirmMaintenance = () => operationId === undefined ? Promise.resolve() : workflow.confirmMaintenance(operationId);
  const retryVerification = () => operationId === undefined ? Promise.resolve() : workflow.retryVerification(operationId);

  const actions: PackageManagerActions = {
    refresh,
    refreshEnabled: workflow.refreshEnabled,
    retrySupplement,
    selectManager,
    setManagerEnabled,
    selectPackage,
    togglePackageActions,
    closePackageActions,
    copyPath: copyPathValue,
    openPath: openPathValue,
    copyCommand,
    copyCleanupCommand,
    requestPackageUninstall,
    requestCacheCleanup: requestCacheCleanupAction,
    cancelMaintenance,
    confirmMaintenance,
    retryVerification,
    copyPackageAction,
    copyPackage,
    openPackage,
    setHomebrewFilter: (filter) => {
      setSelectedHomebrewFilter(filter);
      setSelectedPackageIndex(null);
      setOpenPackageActionMenuIndex(null);
    },
    setMavenFilter: (filter) => {
      setSelectedMavenFilter(filter);
      setSelectedPackageIndex(null);
      setOpenPackageActionMenuIndex(null);
    },
    setPipFilter: (filter) => {
      setSelectedPipFilter(filter);
      setSelectedPackageIndex(null);
      setOpenPackageActionMenuIndex(null);
    },
  };

  return {
    historyRevision: view.historyRevision,
    historyWarning: view.historyWarning,
    actions,
    currentManager,
    enabledManagers,
    homeDirectory,
    managerSnapshots,
    openPackageActionMenuIndex,
    overview,
    pendingHomebrewCleanup,
    pendingPipOutdated,
    maintenance,
    maintenanceBusy,
    lockedManager,
    maintenancePending: lockedManager ? maintenance!.request : null,
    pendingSizeScansByManager,
    scanMeta: renderMeta,
    scanStates,
    scanningAll,
    scanningManagers,
    selectedHomebrewFilter,
    selectedManager,
    selectedMavenFilter,
    selectedPackageIndex,
    selectedPipFilter,
    uiMessage,
  };
}
