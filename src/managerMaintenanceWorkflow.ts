import { managerOrder } from "./constants";
import { cleanupCopyFor, cleanupPreviewDetails, cleanupReady, cleanupReclaimable, type CleanupSpaceInfo } from "./cleanupCopy";
import { createManagerScanQueue } from "./managerScanQueue";
import { scanProblems, type ManagerScanState } from "./managerScanning";
import { applyPipOutdatedPreview, cacheCleanupFailureMessage, cacheCleanupPartialMessage, cacheCleanupStepSummary, type MaintenanceRequest } from "./state";
import type { CacheCleanupRun, DiskUsage, HomebrewCleanupPreview, MaintenanceRunPreview, ManagerId, ManagerScanSnapshot, ManagerSnapshot, PipOutdatedPreview } from "./types";
import { errorToString, managerLabel, sizeScanError, trimTail } from "./utils/format";

export interface ManagerMaintenanceEffects {
  readEnabled(): ManagerId[];
  writeEnabled(managers: ManagerId[]): void;
  scan(manager: ManagerId): Promise<ManagerScanSnapshot>;
  measure(path: string): Promise<DiskUsage>;
  readHomebrewCleanup(): Promise<HomebrewCleanupPreview>;
  readPipOutdated(pythonExecutable: string): Promise<PipOutdatedPreview>;
  clean(manager: ManagerId): Promise<CacheCleanupRun>;
  uninstall(manager: "Npm" | "Pnpm", packageName: string): Promise<MaintenanceRunPreview>;
}

export interface MaintenanceExecution {
  status: "succeeded" | "partial" | "failed" | "unconfirmed" | "notExecuted";
  title: string;
  message: string;
}

export interface MaintenanceOperation {
  id: number;
  request: MaintenanceRequest;
  phase: "confirming" | "executing" | "verifying" | "finished" | "invalidated";
  reclaimable: CleanupSpaceInfo | null;
  reclaimDetails: string | null;
  execution: MaintenanceExecution | null;
  verification: { status: "notStarted" | "reading" | "succeeded" | "failed" | "skipped"; message: string | null };
  invalidation: string | null;
}

export interface ManagerMaintenanceView {
  enabledManagers: ManagerId[];
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  scanStates: Partial<Record<ManagerId, ManagerScanState>>;
  scanDurationMsByManager: Partial<Record<ManagerId, number>>;
  pendingSizeScansByManager: Partial<Record<ManagerId, number>>;
  pendingHomebrewCleanup: boolean;
  pendingPipOutdated: boolean;
  scanningManagers: Set<ManagerId>;
  scanningAll: boolean;
  maintenance: MaintenanceOperation | null;
  maintenanceBusy: boolean;
  lockedManager: ManagerId | null;
}

export type ManagerMaintenanceWorkflow = ReturnType<typeof createManagerMaintenanceWorkflow>;

export function createManagerMaintenanceWorkflow(effects: ManagerMaintenanceEffects) {
  const listeners = new Set<() => void>();
  const queue = createManagerScanQueue();
  const revisions: Partial<Record<ManagerId, number>> = {};
  let confirmationRevision = 0;
  let sequence = 0;
  let view: ManagerMaintenanceView = {
    enabledManagers: [...effects.readEnabled()], managerSnapshots: {}, scanStates: {},
    scanDurationMsByManager: {}, pendingSizeScansByManager: {},
    pendingHomebrewCleanup: false, pendingPipOutdated: false,
    scanningManagers: new Set(), scanningAll: false,
    maintenance: null, maintenanceBusy: false, lockedManager: null,
  };

  function publish(patch: Partial<ManagerMaintenanceView>) {
    view = { ...view, ...patch };
    const operation = view.maintenance;
    view.maintenanceBusy = Boolean(operation && ["confirming", "executing", "verifying"].includes(operation.phase));
    view.lockedManager = operation && ["executing", "verifying"].includes(operation.phase) ? operation.request.managerId : null;
    listeners.forEach((listener) => listener());
  }

  function setOperation(patch: Partial<MaintenanceOperation>) {
    if (view.maintenance) publish({ maintenance: { ...view.maintenance, ...patch } });
  }

  function setScanState(manager: ManagerId, patch: Partial<ManagerScanState>) {
    publish({ scanStates: { ...view.scanStates, [manager]: { phase: "idle", scannedAt: null, error: null, ...view.scanStates[manager], ...patch } } });
  }

  function updateManager(manager: ManagerId, update: (previous: ManagerSnapshot) => ManagerSnapshot) {
    const previous = view.managerSnapshots[manager];
    if (previous) installSnapshot(manager, update(previous));
  }

  function installSnapshot(manager: ManagerId, snapshot: ManagerSnapshot) {
    revisions[manager] = (revisions[manager] ?? 0) + 1;
    const operation = view.maintenance;
    publish({
      managerSnapshots: { ...view.managerSnapshots, [manager]: snapshot },
      ...(operation?.phase === "confirming" && operation.request.managerId === manager
        ? { maintenance: { ...operation, phase: "invalidated" as const, invalidation: "目标快照已变化，请关闭后重新确认。" } } : {}),
    });
  }

  async function hydratePaths(manager: ManagerId, retry = false) {
    const paths = view.managerSnapshots[manager]?.paths.filter((path) => retry
      ? path.size.status !== "Ready" || path.size.skipped > 0 : path.size.status === "Pending") ?? [];
    publish({ pendingSizeScansByManager: { ...view.pendingSizeScansByManager, [manager]: paths.length } });
    await Promise.all(paths.map(async (path) => {
      let size: DiskUsage;
      try { size = await effects.measure(path.path); }
      catch (error) { size = sizeScanError(error); }
      updateManager(manager, (current) => ({ ...current, paths: current.paths.map((item) => item.path === path.path ? { ...item, size } : item) }));
      publish({ pendingSizeScansByManager: { ...view.pendingSizeScansByManager, [manager]: (view.pendingSizeScansByManager[manager] ?? 1) - 1 } });
    }));
  }

  async function hydrateHomebrew() {
    const previous = view.managerSnapshots.Homebrew?.homebrew?.cleanup;
    if (!previous) return;
    publish({ pendingHomebrewCleanup: true });
    let cleanup: HomebrewCleanupPreview;
    try { cleanup = await effects.readHomebrewCleanup(); }
    catch (error) { cleanup = { ...previous, status: "Failed", rawOutput: "", reclaimedBytes: null, reclaimedHuman: null, message: errorToString(error), failure: null }; }
    updateManager("Homebrew", (manager) => manager.homebrew ? { ...manager, homebrew: { ...manager.homebrew, cleanup } } : manager);
    publish({ pendingHomebrewCleanup: false });
  }

  async function hydratePip() {
    const pythonExecutable = view.managerSnapshots.Pip?.pip?.pythonExecutable;
    if (!pythonExecutable) return;
    publish({ pendingPipOutdated: true });
    let preview: PipOutdatedPreview;
    try { preview = await effects.readPipOutdated(pythonExecutable); }
    catch (error) {
      preview = { status: "Failed", command: { program: pythonExecutable, args: ["-m", "pip", "list", "--outdated", "--format=json"], preview: `${pythonExecutable} -m pip list --outdated --format=json`, timeoutMs: 30000 }, outdated: [], message: errorToString(error), failure: null };
    }
    updateManager("Pip", (manager) => manager.pip ? applyPipOutdatedPreview({
      ...manager, pip: { ...manager.pip, outdatedFailure: preview.failure },
      packages: manager.packages.map((pkg) => ({ ...pkg, signals: [...pkg.signals] })),
    }, preview) : manager);
    publish({ pendingPipOutdated: false });
  }

  function schedule(manager: ManagerId, job: () => Promise<void>) {
    if (!view.scanningManagers.has(manager)) {
      publish({ scanningManagers: new Set(view.scanningManagers).add(manager) });
      setScanState(manager, { phase: "queued" });
    }
    // A task owns this manager until all supplements settle. Reads cannot overlap
    // within a manager, so late supplements cannot overwrite a newer scan.
    return queue.run(manager, async () => {
      try { if (view.enabledManagers.includes(manager)) await job(); }
      finally {
        const scanningManagers = new Set(view.scanningManagers);
        scanningManagers.delete(manager);
        publish({ scanningManagers });
        setScanState(manager, { phase: "idle" });
      }
    });
  }

  function readFull(manager: ManagerId) {
    return schedule(manager, async () => {
      setScanState(manager, { phase: "reading", error: null });
      try {
        const result = await effects.scan(manager);
        publish({ scanDurationMsByManager: { ...view.scanDurationMsByManager, [manager]: result.scanDurationMs } });
        setScanState(manager, { diagnostics: result.diagnostics, failures: result.manager.failures });
        if (result.manager.status === "Failed" && view.managerSnapshots[manager]) {
          setScanState(manager, { error: scanProblems(result.manager) });
          return;
        }
        installSnapshot(manager, result.manager);
        setScanState(manager, { phase: "enriching", scannedAt: Date.now() });
        const supplements = [hydratePaths(manager)];
        if (manager === "Homebrew" && result.manager.homebrew?.cleanup.status === "Pending") supplements.push(hydrateHomebrew());
        if (manager === "Pip" && result.manager.pip?.outdatedStatus === "Pending") supplements.push(hydratePip());
        await Promise.all(supplements);
        const current = view.managerSnapshots[manager]!;
        setScanState(manager, { error: scanProblems(current), failures: current.failures });
      } catch (error) { setScanState(manager, { error: errorToString(error) }); }
    });
  }

  function refresh(manager: ManagerId): Promise<void> {
    if (view.maintenanceBusy || !view.enabledManagers.includes(manager)) return Promise.resolve();
    return readFull(manager);
  }

  async function refreshEnabled() {
    if (view.maintenanceBusy || view.scanningAll) return;
    publish({ scanningAll: true });
    try { await Promise.allSettled(view.enabledManagers.map(refresh)); }
    finally { publish({ scanningAll: false }); }
  }

  function retrySupplement(manager: ManagerId, kind: "paths" | "homebrew" | "pip"): Promise<void> {
    if (view.maintenanceBusy || !view.enabledManagers.includes(manager)) return Promise.resolve();
    return schedule(manager, async () => {
      if (!view.managerSnapshots[manager]) return;
      setScanState(manager, { phase: "enriching" });
      if (kind === "paths") await hydratePaths(manager, true);
      if (kind === "homebrew" && manager === "Homebrew") await hydrateHomebrew();
      if (kind === "pip" && manager === "Pip") await hydratePip();
      const current = view.managerSnapshots[manager]!;
      setScanState(manager, { error: scanProblems(current), failures: current.failures });
    });
  }

  function setManagerEnabled(manager: ManagerId, enabled: boolean) {
    if (!enabled && (view.lockedManager === manager || (view.enabledManagers.length === 1 && view.enabledManagers.includes(manager)))) return false;
    if (view.enabledManagers.includes(manager) === enabled) return true;
    const enabledManagers = managerOrder.filter((id) => id === manager ? enabled : view.enabledManagers.includes(id));
    effects.writeEnabled(enabledManagers);
    const operation = view.maintenance;
    publish({ enabledManagers, ...(!enabled && operation?.phase === "confirming" && operation.request.managerId === manager
      ? { maintenance: { ...operation, phase: "invalidated" as const, invalidation: "目标管理器已停用，请重新启用并确认。" } } : {}) });
    return true;
  }

  function requestMaintenance(request: MaintenanceRequest) {
    const manager = view.managerSnapshots[request.managerId];
    if (view.maintenanceBusy || view.scanningManagers.has(request.managerId) || !view.enabledManagers.includes(request.managerId) || !manager) return false;
    if (request.kind === "cleanupCache" ? !cleanupReady(manager) : !manager.packages.some((pkg) => pkg.name === request.packageName)) return false;
    confirmationRevision = revisions[request.managerId] ?? 0;
    publish({ maintenance: {
      id: ++sequence, request: { ...request }, phase: "confirming",
      reclaimable: request.kind === "cleanupCache" ? cleanupReclaimable(manager) : null,
      reclaimDetails: request.kind === "cleanupCache" ? cleanupPreviewDetails(manager) : null,
      execution: null, verification: { status: "notStarted", message: null }, invalidation: null,
    } });
    return true;
  }

  function requestCacheCleanup(manager: ManagerId) {
    return requestMaintenance({ kind: "cleanupCache", managerId: manager });
  }

  function requestPackageUninstall(manager: "Npm" | "Pnpm", packageName: string) {
    const packageIndex = view.managerSnapshots[manager]?.packages.findIndex((pkg) => pkg.name === packageName) ?? -1;
    return requestMaintenance({ kind: "uninstallGlobalPackage", managerId: manager, packageName, packageIndex });
  }

  async function execute(request: MaintenanceRequest): Promise<MaintenanceExecution> {
    const label = managerLabel(request.managerId);
    try {
      if (request.kind === "cleanupCache") {
        const run = await awaitMaintenanceReply(effects.clean(request.managerId), 11 * 60_000);
        if (run.outcome === "Succeeded") return { status: "succeeded", title: cleanupCopyFor(request.managerId)!.succeeded, message: cacheCleanupStepSummary(run) };
        if (run.outcome === "PartiallyCompleted") return { status: "partial", title: `${label} 清理部分完成`, message: cacheCleanupPartialMessage(run) };
        return { status: run.outcome === "NoPlan" ? "notExecuted" : "failed", title: run.outcome === "NoPlan" ? "没有可执行的清理方案" : `${label} 清理未完成`, message: cacheCleanupFailureMessage(run) };
      }
      const run = await awaitMaintenanceReply(effects.uninstall(request.managerId, request.packageName), 60_000);
      return run.status === "Ready"
        ? { status: "succeeded", title: `${label} 全局包已卸载`, message: run.command.preview }
        : { status: "failed", title: `${label} 全局包卸载未完成`, message: trimTail(run.stderr || run.stdout || run.message || "全局包卸载未完成") };
    } catch (error) { return { status: "unconfirmed", title: "执行结果未确认", message: `${errorToString(error)}。无法确认维护是否完成，请核对最新快照；不会自动重复执行。` }; }
  }

  // Native cleanup can run two 300-second steps; uninstall has a 30-second
  // command budget. Allow reply overhead, then report uncertainty. This timer
  // neither cancels the native operation nor treats a late reply as a new run.
  async function awaitMaintenanceReply<T>(reply: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([reply, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("等待执行回执超时")), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  async function verify() {
    const operation = view.maintenance!;
    setOperation({ phase: "verifying", verification: { status: "reading", message: null } });
    await readFull(operation.request.managerId);
    const error = view.scanStates[operation.request.managerId]?.error;
    setOperation({ phase: "finished", verification: { status: error ? "failed" : "succeeded", message: error ?? null } });
  }

  async function confirmMaintenance(id: number) {
    const operation = view.maintenance;
    if (!operation || operation.id !== id || operation.phase !== "confirming") return;
    if (confirmationRevision !== revisions[operation.request.managerId] || !view.enabledManagers.includes(operation.request.managerId)) {
      setOperation({ phase: "invalidated", invalidation: "确认依据已变化，请关闭后重新确认。" });
      return;
    }
    setOperation({ phase: "executing" });
    const execution = await execute(operation.request);
    setOperation({ execution });
    if (execution.status === "notExecuted") setOperation({ phase: "finished", verification: { status: "skipped", message: "维护未执行，无需核对。" } });
    else await verify();
  }

  function cancelMaintenance(id: number) {
    const operation = view.maintenance;
    if (operation?.id !== id || operation.phase === "executing" || operation.phase === "verifying") return false;
    publish({ maintenance: null });
    return true;
  }

  async function retryVerification(id: number) {
    const operation = view.maintenance;
    if (operation?.id !== id || operation.phase !== "finished" || operation.execution?.status === "notExecuted") return;
    if (!view.enabledManagers.includes(operation.request.managerId)) {
      setOperation({ verification: { status: "failed", message: "目标管理器已停用，请重新启用后再读取。" } });
      return;
    }
    // Let a manual read already in progress finish, then perform a fresh full
    // read rather than mistaking a targeted supplement for complete verification.
    setOperation({ phase: "verifying", verification: { status: "reading", message: null } });
    if (view.scanningManagers.has(operation.request.managerId)) await queue.run(operation.request.managerId, async () => {});
    await verify();
  }

  return {
    read: () => view,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh, refreshEnabled, retrySupplement, setManagerEnabled,
    requestCacheCleanup, requestPackageUninstall, confirmMaintenance, cancelMaintenance, retryVerification,
  };
}
