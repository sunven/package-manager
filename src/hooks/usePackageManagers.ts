import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import {
  applyPipOutdatedPreview,
  cancelMaintenanceConfirmation,
  completeMaintenanceOperation,
  failMaintenanceOperation,
  finishMaintenanceOperation,
  requestNpmCacheClean,
  requestPnpmStorePrune,
  requestPackageUninstall as requestMaintenancePackageUninstall,
  shouldApplyHydrationResult,
  startConfirmedMaintenanceOperation,
  type MaintenanceRequest,
  type MaintenanceUiState,
} from "../state";
import { managerOrder } from "../constants";
import type {
  DiskUsage,
  HomebrewCleanupPreview,
  HomebrewFilter,
  MaintenanceRunPreview,
  ManagerId,
  ManagerScanSnapshot,
  ManagerSnapshot,
  MavenFilter,
  NpmMaintenanceOperation,
  PackageRow,
  PipFilter,
  PipOutdatedPreview,
  PnpmMaintenanceOperation,
  UiMessage,
} from "../types";
import {
  actionFailureTitle,
  countedSizePath,
  errorToString,
  formatBytes,
  formatHomePathsInText,
  managerLabel,
  sizeScanError,
  trimTail,
} from "../utils/format";

type ManagerMap = Partial<Record<ManagerId, ManagerSnapshot>>;
type NumberByManager = Record<ManagerId, number>;

const initialCounters: NumberByManager = {
  Npm: 0,
  Pnpm: 0,
  Yarn: 0,
  Nvm: 0,
  Homebrew: 0,
  Maven: 0,
  Pip: 0,
  Cargo: 0,
  Docker: 0,
  Bun: 0,
  Uv: 0,
};

export interface PackageManagerActions {
  refresh: (managerId?: ManagerId) => Promise<void>;
  selectManager: (managerId: ManagerId) => void;
  selectPackage: (index: number) => void;
  togglePackageActions: (index: number) => void;
  closePackageActions: () => void;
  copyPath: (path: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
  copyCommand: (payload: string) => Promise<void>;
  copyCleanupCommand: () => Promise<void>;
  requestPackageUninstall: (index: number) => void;
  requestCacheClean: () => void;
  requestStorePrune: () => void;
  cancelMaintenance: () => void;
  confirmMaintenance: () => Promise<void>;
  copyPackageAction: (index: number, actionIndex: number) => Promise<void>;
  copyPackage: (index: number) => Promise<void>;
  openPackage: (index: number) => Promise<void>;
  setHomebrewFilter: (filter: HomebrewFilter) => void;
  setMavenFilter: (filter: MavenFilter) => void;
  setPipFilter: (filter: PipFilter) => void;
}

export function usePackageManagers() {
  const [managerSnapshots, setManagerSnapshots] = useState<ManagerMap>({});
  const [scanDurationMsByManager, setScanDurationMsByManager] = useState<Partial<NumberByManager>>({});
  const [selectedManager, setSelectedManager] = useState<ManagerId>("Npm");
  const [selectedPackageIndex, setSelectedPackageIndex] = useState<number | null>(null);
  const [openPackageActionMenuIndex, setOpenPackageActionMenuIndex] = useState<number | null>(null);
  const [selectedHomebrewFilter, setSelectedHomebrewFilter] = useState<HomebrewFilter>("All");
  const [selectedMavenFilter, setSelectedMavenFilter] = useState<MavenFilter>("All");
  const [selectedPipFilter, setSelectedPipFilter] = useState<PipFilter>("All");
  const [lastCopied, setLastCopied] = useState("");
  const [scanningManagers, setScanningManagers] = useState<Set<ManagerId>>(() => new Set());
  const [pendingSizeScansByManager, setPendingSizeScansByManager] = useState<NumberByManager>(initialCounters);
  const [pendingHomebrewCleanup, setPendingHomebrewCleanup] = useState(false);
  const [pendingPipOutdated, setPendingPipOutdated] = useState(false);
  const [maintenanceState, setMaintenanceState] = useState<MaintenanceUiState>({
    confirmation: null,
    pending: null,
  });
  const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
  const [uiMessage, setUiMessage] = useState<UiMessage | null>(null);

  const selectedManagerRef = useRef(selectedManager);
  const selectedPackageIndexRef = useRef(selectedPackageIndex);
  const managerSnapshotsRef = useRef(managerSnapshots);
  const scanningManagersRef = useRef(scanningManagers);
  const sizeScanTokensRef = useRef<NumberByManager>({ ...initialCounters });
  const homebrewCleanupTokenRef = useRef(0);
  const pipOutdatedTokenRef = useRef(0);
  const maintenanceStateRef = useRef(maintenanceState);

  useEffect(() => {
    selectedManagerRef.current = selectedManager;
  }, [selectedManager]);

  useEffect(() => {
    selectedPackageIndexRef.current = selectedPackageIndex;
  }, [selectedPackageIndex]);

  useEffect(() => {
    managerSnapshotsRef.current = managerSnapshots;
  }, [managerSnapshots]);

  useEffect(() => {
    scanningManagersRef.current = scanningManagers;
  }, [scanningManagers]);

  useEffect(() => {
    maintenanceStateRef.current = maintenanceState;
  }, [maintenanceState]);

  const currentManager = managerSnapshots[selectedManager] ?? null;

  const updateManager = useCallback((managerId: ManagerId, updater: (manager: ManagerSnapshot) => ManagerSnapshot) => {
    setManagerSnapshots((current) => {
      const base = current[managerId] ? current : managerSnapshotsRef.current;
      const manager = base[managerId];
      if (!manager) return current;
      const next = {
        ...base,
        [managerId]: updater(manager),
      };
      managerSnapshotsRef.current = next;
      return next;
    });
  }, []);

  const renderMeta = useMemo(() => {
    const parts: string[] = [];
    const pendingSizeScans = pendingSizeScansByManager[selectedManager];
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
    const managers = managerOrder.flatMap((managerId) => {
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
      managerCount: `${managers.length}/${managerOrder.length}`,
      readyManagers: String(managers.filter((manager) => manager.status === "Ready").length),
      totalPackages: String(managers.reduce((sum, manager) => sum + manager.packages.length, 0)),
      totalBytes: formatBytes(totalBytes),
      unsupported: String(managers.filter((manager) => manager.status === "Unsupported").length),
    };
  }, [managerSnapshots]);

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

  const updateMaintenanceState = useCallback((updater: (state: MaintenanceUiState) => MaintenanceUiState) => {
    setMaintenanceState((current) => {
      const next = updater(current);
      maintenanceStateRef.current = next;
      return next;
    });
  }, []);

  const markCopied = useCallback(
    (value: string) => {
      setLastCopied(value);
      clearMessage();
    },
    [clearMessage],
  );

  const hydratePipOutdated = useCallback(
    async (token: number, pythonExecutable: string) => {
      setPendingPipOutdated(true);

      try {
        const preview = await invoke<PipOutdatedPreview>("hydrate_pip_outdated", { pythonExecutable });
        if (!shouldApplyHydrationResult(token, pipOutdatedTokenRef.current)) return;
        updateManager("Pip", (manager) => {
          if (!manager.pip) return manager;
          return applyPipOutdatedPreview({ ...manager, packages: manager.packages.map((pkg) => ({ ...pkg, signals: [...pkg.signals] })) }, preview);
        });
      } catch (error) {
        if (!shouldApplyHydrationResult(token, pipOutdatedTokenRef.current)) return;
        updateManager("Pip", (manager) => {
          if (!manager.pip) return manager;
          const failedPreview: PipOutdatedPreview = {
            status: "Failed",
            command: {
              program: pythonExecutable,
              args: ["-m", "pip", "list", "--outdated", "--format=json"],
              preview: `${pythonExecutable} -m pip list --outdated --format=json`,
              timeoutMs: 30000,
            },
            outdated: [],
            message: errorToString(error),
            failure: null,
          };
          return applyPipOutdatedPreview({ ...manager, packages: manager.packages.map((pkg) => ({ ...pkg, signals: [...pkg.signals] })) }, failedPreview);
        });
      } finally {
        if (shouldApplyHydrationResult(token, pipOutdatedTokenRef.current)) {
          setPendingPipOutdated(false);
        }
      }
    },
    [updateManager],
  );

  const hydrateHomebrewCleanup = useCallback(
    async (token: number) => {
      setPendingHomebrewCleanup(true);

      try {
        const cleanup = await invoke<HomebrewCleanupPreview>("hydrate_homebrew_cleanup");
        if (token !== homebrewCleanupTokenRef.current) return;
        updateManager("Homebrew", (manager) =>
          manager.homebrew
            ? {
                ...manager,
                homebrew: { ...manager.homebrew, cleanup },
              }
            : manager,
        );
      } catch (error) {
        if (token !== homebrewCleanupTokenRef.current) return;
        updateManager("Homebrew", (manager) =>
          manager.homebrew
            ? {
                ...manager,
                homebrew: {
                  ...manager.homebrew,
                  cleanup: {
                    status: "Failed",
                    command: manager.homebrew.cleanup.command,
                    rawOutput: "",
                    reclaimedBytes: null,
                    reclaimedHuman: null,
                    message: errorToString(error),
                    failure: null,
                  },
                },
              }
            : manager,
        );
      } finally {
        if (token === homebrewCleanupTokenRef.current) {
          setPendingHomebrewCleanup(false);
        }
      }
    },
    [updateManager],
  );

  const hydratePathSizes = useCallback(async (managerId: ManagerId, token: number, scannedManager?: ManagerSnapshot) => {
    const activeManager = scannedManager ?? managerSnapshotsRef.current[managerId];
    if (!activeManager) return;

    const pendingPaths = activeManager.paths.filter((path) => path.size.status === "Pending");
    setPendingSizeScansByManager((current) => ({ ...current, [managerId]: pendingPaths.length }));

    await Promise.all(
      pendingPaths.map(async (pathInfo) => {
        try {
          const size = await invoke<DiskUsage>("measure_path_size", { path: pathInfo.path });
          if (token !== sizeScanTokensRef.current[managerId]) return;
          updateManager(managerId, (manager) => ({
            ...manager,
            paths: manager.paths.map((path) => (path.path === pathInfo.path ? { ...path, size } : path)),
          }));
        } catch (error) {
          if (token !== sizeScanTokensRef.current[managerId]) return;
          updateManager(managerId, (manager) => ({
            ...manager,
            paths: manager.paths.map((path) => (path.path === pathInfo.path ? { ...path, size: sizeScanError(error) } : path)),
          }));
        } finally {
          if (token === sizeScanTokensRef.current[managerId]) {
            setPendingSizeScansByManager((current) => ({ ...current, [managerId]: Math.max(0, current[managerId] - 1) }));
          }
        }
      }),
    );
  }, [updateManager]);

  const refresh = useCallback(
    async (managerId = selectedManagerRef.current) => {
      if (scanningManagersRef.current.has(managerId)) return;

      scanningManagersRef.current = new Set(scanningManagersRef.current).add(managerId);
      setScanningManagers(scanningManagersRef.current);
      sizeScanTokensRef.current = { ...sizeScanTokensRef.current, [managerId]: sizeScanTokensRef.current[managerId] + 1 };
      if (managerId === "Homebrew") {
        homebrewCleanupTokenRef.current += 1;
        setPendingHomebrewCleanup(false);
      }
      if (managerId === "Pip") {
        pipOutdatedTokenRef.current += 1;
        setPendingPipOutdated(false);
      }
      setPendingSizeScansByManager((current) => ({ ...current, [managerId]: 0 }));
      setUiMessage(null);

      try {
        const result = await invoke<ManagerScanSnapshot>("scan_manager", { manager: managerId });
        managerSnapshotsRef.current = { ...managerSnapshotsRef.current, [result.manager.id]: result.manager };
        setManagerSnapshots(managerSnapshotsRef.current);
        setScanDurationMsByManager((current) => ({ ...current, [result.manager.id]: result.scanDurationMs }));
        if (
          result.manager.id === selectedManagerRef.current &&
          selectedPackageIndexRef.current !== null &&
          selectedPackageIndexRef.current >= result.manager.packages.length
        ) {
          setSelectedPackageIndex(null);
        }

        const pathToken = sizeScanTokensRef.current[result.manager.id];
        void hydratePathSizes(result.manager.id, pathToken, result.manager);
        if (result.manager.id === "Homebrew" && result.manager.homebrew?.cleanup.status === "Pending") {
          void hydrateHomebrewCleanup(homebrewCleanupTokenRef.current);
        }
        if (result.manager.id === "Pip" && result.manager.pip?.outdatedStatus === "Pending") {
          void hydratePipOutdated(pipOutdatedTokenRef.current, result.manager.pip.pythonExecutable);
        }
      } catch (error) {
        if (managerId === selectedManagerRef.current) showError(`${managerLabel(managerId)} 扫描失败`, error);
      } finally {
        const next = new Set(scanningManagersRef.current);
        next.delete(managerId);
        scanningManagersRef.current = next;
        setScanningManagers(next);
      }
    },
    [hydrateHomebrewCleanup, hydratePathSizes, hydratePipOutdated, showError],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void refresh("Npm");
    });
    return () => cancelAnimationFrame(frame);
  }, [refresh]);

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
      const manager = managerSnapshotsRef.current[selectedManagerRef.current];
      if (!manager) return null;
      return manager.packages[index] ?? null;
    },
    [],
  );

  const selectManager = useCallback(
    (managerId: ManagerId) => {
      setSelectedManager(managerId);
      setSelectedPackageIndex(null);
      setOpenPackageActionMenuIndex(null);
      if (!managerSnapshotsRef.current[managerId] && !scanningManagersRef.current.has(managerId)) {
        void refresh(managerId);
      }
    },
    [refresh],
  );

  const selectPackage = useCallback((index: number) => {
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
    const cleanup = managerSnapshotsRef.current.Homebrew?.homebrew?.cleanup;
    if (!cleanup) return;
    try {
      await writeText(cleanup.command.preview);
      markCopied(cleanup.command.preview);
    } catch (error) {
      showError(actionFailureTitle("copy-cleanup-command"), error);
    }
  }, [markCopied, showError]);

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

  const requestPackageUninstall = useCallback(
    (index: number) => {
      const managerId = selectedManagerRef.current;
      if (managerId !== "Npm" && managerId !== "Pnpm") return;
      const pkg = packageAt(index);
      if (!pkg) return;
      setOpenPackageActionMenuIndex(null);
      updateMaintenanceState((state) => requestMaintenancePackageUninstall(state, managerId, index, pkg.name));
    },
    [packageAt, updateMaintenanceState],
  );

  const requestCacheCleanAction = useCallback(() => {
    if (selectedManagerRef.current !== "Npm") return;
    updateMaintenanceState(requestNpmCacheClean);
  }, [updateMaintenanceState]);

  const requestStorePruneAction = useCallback(() => {
    if (selectedManagerRef.current !== "Pnpm") return;
    updateMaintenanceState(requestPnpmStorePrune);
  }, [updateMaintenanceState]);

  const cancelMaintenance = useCallback(() => {
    updateMaintenanceState(cancelMaintenanceConfirmation);
  }, [updateMaintenanceState]);

  const confirmMaintenance = useCallback(async () => {
    const request = maintenanceStateRef.current.confirmation;
    if (!request || maintenanceStateRef.current.pending) return;

    const started = startConfirmedMaintenanceOperation(maintenanceStateRef.current);
    maintenanceStateRef.current = started;
    setMaintenanceState(started);

    try {
      const commandName = request.managerId === "Pnpm" ? "run_pnpm_maintenance" : "run_npm_maintenance";
      const operation = request.managerId === "Pnpm" ? pnpmMaintenanceOperation(request) : npmMaintenanceOperation(request);
      const preview = await invoke<MaintenanceRunPreview>(commandName, { operation });
      if (preview.status !== "Ready") {
        throw new Error(maintenanceFailureMessage(preview));
      }

      await refresh(request.managerId);
      updateMaintenanceState(completeMaintenanceOperation);
      toast.success(maintenanceSuccessTitle(request), {
        description: preview.command.preview,
      });
    } catch (error) {
      const message = errorToString(error);
      updateMaintenanceState((state) => failMaintenanceOperation(state, message));
      toast.error(maintenanceFailureTitle(request), {
        description: message,
      });
    } finally {
      updateMaintenanceState((state) => state.pending ? finishMaintenanceOperation(state) : state);
    }
  }, [refresh, updateMaintenanceState]);

  const actions: PackageManagerActions = {
    refresh,
    selectManager,
    selectPackage,
    togglePackageActions,
    closePackageActions,
    copyPath: copyPathValue,
    openPath: openPathValue,
    copyCommand,
    copyCleanupCommand,
    requestPackageUninstall,
    requestCacheClean: requestCacheCleanAction,
    requestStorePrune: requestStorePruneAction,
    cancelMaintenance,
    confirmMaintenance,
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
    actions,
    currentManager,
    homeDirectory,
    managerSnapshots,
    openPackageActionMenuIndex,
    overview,
    pendingHomebrewCleanup,
    pendingPipOutdated,
    maintenanceConfirmation: maintenanceState.confirmation,
    maintenancePending: maintenanceState.pending,
    maintenanceResult: maintenanceState.result ?? null,
    pendingSizeScansByManager,
    scanMeta: renderMeta,
    scanningManagers,
    selectedHomebrewFilter,
    selectedManager,
    selectedMavenFilter,
    selectedPackageIndex,
    selectedPipFilter,
    uiMessage,
  };
}

function npmMaintenanceOperation(request: Extract<MaintenanceRequest, { managerId: "Npm" }>): NpmMaintenanceOperation {
  if (request.kind === "cleanCache") return { kind: "cleanCache" };
  return {
    kind: "uninstallGlobalPackage",
    packageName: request.packageName,
  };
}

function pnpmMaintenanceOperation(request: Extract<MaintenanceRequest, { managerId: "Pnpm" }>): PnpmMaintenanceOperation {
  if (request.kind === "storePrune") return { kind: "storePrune" };
  return {
    kind: "uninstallGlobalPackage",
    packageName: request.packageName,
  };
}

function maintenanceSuccessTitle(request: MaintenanceRequest) {
  if (request.kind === "cleanCache") return "npm 缓存已清理";
  if (request.kind === "storePrune") return "pnpm store 已清理";
  return request.managerId === "Pnpm" ? "pnpm 全局包已卸载" : "npm 全局包已卸载";
}

function maintenanceFailureTitle(request: MaintenanceRequest) {
  if (request.kind === "cleanCache") return "npm 缓存清理失败";
  if (request.kind === "storePrune") return "pnpm store 清理失败";
  return request.managerId === "Pnpm" ? "pnpm 全局包卸载失败" : "npm 全局包卸载失败";
}

function maintenanceFailureMessage(preview: MaintenanceRunPreview) {
  return trimTail(preview.stderr || preview.stdout || preview.message || "npm maintenance failed");
}
