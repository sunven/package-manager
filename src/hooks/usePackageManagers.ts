import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { applyPipOutdatedPreview, shouldApplyHydrationResult } from "../state";
import { managerOrder } from "../constants";
import type {
  DiskUsage,
  HomebrewCleanupPreview,
  HomebrewFilter,
  ManagerId,
  ManagerScanSnapshot,
  ManagerSnapshot,
  MavenFilter,
  PackageRow,
  PipFilter,
  PipOutdatedPreview,
  UiMessage,
} from "../types";
import {
  actionFailureTitle,
  countedSizePath,
  errorToString,
  formatBytes,
  managerLabel,
  sizeScanError,
} from "../utils/format";

type ManagerMap = Partial<Record<ManagerId, ManagerSnapshot>>;
type NumberByManager = Record<ManagerId, number>;

const initialCounters: NumberByManager = {
  Npm: 0,
  Pnpm: 0,
  Yarn: 0,
  Homebrew: 0,
  Maven: 0,
  Pip: 0,
  Cargo: 0,
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
  const [selectedPackageIndex, setSelectedPackageIndex] = useState(0);
  const [openPackageActionMenuIndex, setOpenPackageActionMenuIndex] = useState<number | null>(null);
  const [selectedHomebrewFilter, setSelectedHomebrewFilter] = useState<HomebrewFilter>("All");
  const [selectedMavenFilter, setSelectedMavenFilter] = useState<MavenFilter>("All");
  const [selectedPipFilter, setSelectedPipFilter] = useState<PipFilter>("All");
  const [lastCopied, setLastCopied] = useState("");
  const [scanningManagers, setScanningManagers] = useState<Set<ManagerId>>(() => new Set());
  const [pendingSizeScansByManager, setPendingSizeScansByManager] = useState<NumberByManager>(initialCounters);
  const [pendingHomebrewCleanup, setPendingHomebrewCleanup] = useState(false);
  const [pendingPipOutdated, setPendingPipOutdated] = useState(false);
  const [uiMessage, setUiMessage] = useState<UiMessage | null>(null);

  const selectedManagerRef = useRef(selectedManager);
  const selectedPackageIndexRef = useRef(selectedPackageIndex);
  const managerSnapshotsRef = useRef(managerSnapshots);
  const scanningManagersRef = useRef(scanningManagers);
  const sizeScanTokensRef = useRef<NumberByManager>({ ...initialCounters });
  const homebrewCleanupTokenRef = useRef(0);
  const pipOutdatedTokenRef = useRef(0);

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
    if (lastCopied) parts.push(`已复制 ${lastCopied}`);
    return parts.join(" · ");
  }, [
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
        if (result.manager.id === selectedManagerRef.current && selectedPackageIndexRef.current >= result.manager.packages.length) {
          setSelectedPackageIndex(0);
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
      setSelectedPackageIndex(0);
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
    copyPackageAction,
    copyPackage,
    openPackage,
    setHomebrewFilter: (filter) => {
      setSelectedHomebrewFilter(filter);
      setSelectedPackageIndex(0);
      setOpenPackageActionMenuIndex(null);
    },
    setMavenFilter: (filter) => {
      setSelectedMavenFilter(filter);
      setSelectedPackageIndex(0);
      setOpenPackageActionMenuIndex(null);
    },
    setPipFilter: (filter) => {
      setSelectedPipFilter(filter);
      setSelectedPackageIndex(0);
      setOpenPackageActionMenuIndex(null);
    },
  };

  return {
    actions,
    currentManager,
    managerSnapshots,
    openPackageActionMenuIndex,
    overview,
    pendingHomebrewCleanup,
    pendingPipOutdated,
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
