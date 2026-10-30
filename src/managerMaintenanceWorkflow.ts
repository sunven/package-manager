import { snapshotDraft, failedSnapshotDraft, type SnapshotDraft, type ArchivedSnapshot } from "./managerHistory";
import { managerOrder } from "./constants";
import { androidSdkRemovalCommand } from "./androidSdk";
import { cleanupCopyFor, cleanupPreviewDetails, cleanupReady, cleanupReclaimable, type CleanupSpaceInfo } from "./cleanupCopy";
import { createManagerScanQueue } from "./managerScanQueue";
import type { ManagerScanState } from "./managerScanning";
import { managerObservationFacts, recordObservationFacts } from "./observationFacts";
import { managerObservationId } from "./observationItems";
import { cacheCleanupFailureMessage, cacheCleanupPartialMessage, cacheCleanupStepSummary, type MaintenanceRequest } from "./state";
import type { CacheCleanupRun, MaintenanceRunPreview, ManagerId, ManagerScanProgress, ManagerScanSnapshot, ManagerSnapshot } from "./types";
import { errorToString, managerLabel, trimTail } from "./utils/format";

export interface ManagerMaintenanceEffects {
  readEnabled(): ManagerId[];
  writeEnabled(managers: ManagerId[]): void;
  scan(
    manager: ManagerId,
    onProgress: (progress: ManagerScanProgress) => void,
  ): Promise<ManagerScanSnapshot>;
  clean(manager: ManagerId, beforeSnapshotId?: string): Promise<CacheCleanupRun>;
  uninstall(manager: "Npm" | "Pnpm" | "AndroidSdk", packageName: string, beforeSnapshotId?: string, sdkRoot?: string): Promise<MaintenanceRunPreview>;
  saveSnapshot?: (draft: SnapshotDraft) => Promise<ArchivedSnapshot>;
  recordVerification?: (id: string, status: string, message: string | null, afterSnapshotId: string | null) => Promise<void>;
}

export interface MaintenanceExecution {
  status: "succeeded" | "partial" | "failed" | "unconfirmed" | "notExecuted";
  title: string;
  message: string;
}

export interface MaintenanceOperation {
  historyId?: string | null;
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
  historyWarning: string | null;
  historyRevision: number;
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

export function createManagerMaintenanceWorkflow(effects: ManagerMaintenanceEffects) {
  const listeners = new Set<() => void>();
  const queue = createManagerScanQueue();
  const revisions: Partial<Record<ManagerId, number>> = {};
  let confirmationRevision = 0;
  let sequence = 0;
  const completeArchives: Partial<Record<ManagerId, string>> = {};
  const attemptArchives: Partial<Record<ManagerId, string>> = {};
  const historyWarnings: Partial<Record<ManagerId | "maintenance" | "verification", string>> = {};
  let view: ManagerMaintenanceView = {
    historyWarning: null, historyRevision: 0,
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

  function updateHistoryWarning(source: keyof typeof historyWarnings, message: string | null) {
    if (message) historyWarnings[source] = message;
    else delete historyWarnings[source];
    return Object.values(historyWarnings).join("\n") || null;
  }

  function setScanState(manager: ManagerId, patch: Partial<ManagerScanState>) {
    publish({ scanStates: { ...view.scanStates, [manager]: { phase: "idle", scannedAt: null, error: null, ...view.scanStates[manager], ...patch } } });
  }

  function recordManagerObservation(manager: ManagerId, snapshot: ManagerSnapshot | undefined, state: ManagerScanState) {
    recordObservationFacts(managerObservationId(manager), managerObservationFacts(snapshot, state));
  }

  function clearPending(manager: ManagerId) {
    publish({
      pendingSizeScansByManager: { ...view.pendingSizeScansByManager, [manager]: 0 },
      ...(manager === "Homebrew" ? { pendingHomebrewCleanup: false } : {}),
      ...(manager === "Pip" ? { pendingPipOutdated: false } : {}),
    });
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

  async function archive(draft: SnapshotDraft) {
    if (!effects.saveSnapshot) return;
    try {
      const saved = await effects.saveSnapshot(draft);
      attemptArchives[draft.managerId] = saved.id;
      if (draft.complete) completeArchives[draft.managerId] = saved.id;
      publish({ historyRevision: view.historyRevision + 1, historyWarning: updateHistoryWarning(draft.managerId, null) });
    } catch (error) { publish({ historyWarning: updateHistoryWarning(draft.managerId, `${managerLabel(draft.managerId)} 历史未保存：${errorToString(error)}。本次观察与操作结果仍保留。`) }); }
  }

  function readFull(manager: ManagerId) {
    return schedule(manager, async () => {
      delete attemptArchives[manager];
      setScanState(manager, { phase: "reading", error: null, lastReadFailed: false });
      let draft: SnapshotDraft;
      try {
        const result = await effects.scan(manager, (progress) => {
          if (progress.phase === "reading") {
            setScanState(manager, { phase: "reading" });
          } else if (progress.phase === "measuring") {
            setScanState(manager, { phase: "enriching" });
            publish({
              pendingSizeScansByManager: {
                ...view.pendingSizeScansByManager,
                [manager]: Math.max(0, progress.total - progress.completed),
              },
            });
          } else if (progress.phase === "hydratingHomebrew") {
            publish({ pendingHomebrewCleanup: true });
          } else if (progress.phase === "hydratingPip") {
            publish({ pendingPipOutdated: true });
          }
        });
        publish({ scanDurationMsByManager: { ...view.scanDurationMsByManager, [manager]: result.scanDurationMs } });
        const failed = result.manager.status === "Failed";
        const error = result.problems ?? null;
        const previous = failed ? view.managerSnapshots[manager] : undefined;
        if (!previous) installSnapshot(manager, result.manager);
        const success = ["Ready", "Partial", "Unsupported"].includes(result.manager.status);
        const scannedAt = success ? Date.now() : view.scanStates[manager]?.scannedAt ?? null;
        setScanState(manager, {
          ...(previous ? {} : { phase: "enriching" as const }),
          error,
          failures: result.manager.failures,
          diagnostics: result.diagnostics,
          lastReadFailed: failed,
          ...(success ? { scannedAt } : {}),
        });
        recordManagerObservation(manager, previous ?? result.manager, {
          phase: previous ? "reading" : "enriching",
          scannedAt,
          lastReadFailed: failed,
          error,
        });
        draft = snapshotDraft(result.manager, error);
      } catch (error) {
        const message = errorToString(error);
        setScanState(manager, { error: message, lastReadFailed: true });
        recordManagerObservation(manager, view.managerSnapshots[manager], {
          phase: "reading",
          scannedAt: view.scanStates[manager]?.scannedAt ?? null,
          lastReadFailed: true,
          error: message,
        });
        draft = failedSnapshotDraft(manager, message);
      }
      clearPending(manager);
      await archive(draft);
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
    if (maintenanceBlockReason(request)) return false;
    const manager = view.managerSnapshots[request.managerId];
    if (!manager) return false;
    confirmationRevision = revisions[request.managerId] ?? 0;
    publish({ maintenance: {
      id: ++sequence, request: { ...request }, phase: "confirming",
      reclaimable: request.kind === "cleanupCache" ? cleanupReclaimable(manager) : null,
      reclaimDetails: request.kind === "cleanupCache" ? cleanupPreviewDetails(manager) : null,
      execution: null, verification: { status: "notStarted", message: null }, invalidation: null,
    } });
    return true;
  }

  function maintenanceBlockReason(request: MaintenanceRequest): string | null {
    if (view.maintenanceBusy) return "另一项维护操作正在确认或执行；完成后请重试。";
    if (view.scanningManagers.has(request.managerId)) return `正在扫描 ${managerLabel(request.managerId)}；扫描完成后请重试。`;
    if (!view.enabledManagers.includes(request.managerId)) return `${managerLabel(request.managerId)} 来源未启用；请在设置中启用后重试。`;

    const manager = view.managerSnapshots[request.managerId];
    if (!manager) return `尚未读取 ${managerLabel(request.managerId)} 清单；请刷新后重试。`;
    if (request.kind === "cleanupCache") {
      if (!cleanupReady(manager)) {
        if (manager.status === "Missing") return `${managerLabel(request.managerId)} 尚未安装，无法执行清理。`;
        if (request.managerId === "Homebrew") {
          const preview = manager.homebrew?.cleanup;
          return preview?.message ?? "Homebrew 清理预演尚未就绪；预演完成后请重试。";
        }
        return `${managerLabel(request.managerId)} 清理方案当前不可用；请刷新后重试。`;
      }
      return null;
    }
    if (request.kind === "uninstallSdkComponent") {
      if (!manager.androidSdk?.cli) return "未找到可用的 SDK CLI，无法卸载组件。";
      if (request.packageName.startsWith("cmdline-tools;")) {
        return "cmdline-tools 提供维护 CLI，不能在应用内卸载。";
      }
    }
    return manager.packages.some((pkg) => pkg.name === request.packageName)
      ? null
      : `清单中已不存在 ${request.packageName}；请刷新后重新选择。`;
  }

  function requestCacheCleanup(manager: ManagerId) {
    return requestMaintenance({ kind: "cleanupCache", managerId: manager });
  }

  function requestPackageUninstall(manager: "Npm" | "Pnpm" | "AndroidSdk", packageName: string) {
    const snapshot = view.managerSnapshots[manager];
    const packageIndex = snapshot?.packages.findIndex((pkg) => pkg.name === packageName) ?? -1;
    if (manager === "AndroidSdk") {
      const cli = snapshot?.androidSdk?.cli;
      return requestMaintenance({
        kind: "uninstallSdkComponent",
        managerId: manager,
        packageName,
        packageIndex,
        sdkRoot: cli?.sdkRoot ?? "",
        commandPreview: cli ? androidSdkRemovalCommand(cli, packageName) : null,
      });
    }
    return requestMaintenance({ kind: "uninstallGlobalPackage", managerId: manager, packageName, packageIndex });
  }

  function receiveHistory(run: { historyId?: string | null; historyWarning?: string | null }) {
    setOperation({ historyId: run.historyId });
    publish({ historyRevision: view.historyRevision + 1, ...(run.historyWarning ? { historyWarning: updateHistoryWarning("maintenance", `维护历史未完整保存：${run.historyWarning}`) } : {}) });
  }

  async function execute(request: MaintenanceRequest): Promise<MaintenanceExecution> {
    const label = managerLabel(request.managerId);
    try {
      if (request.kind === "cleanupCache") {
        const run = await awaitMaintenanceReply((completeArchives[request.managerId] ? effects.clean(request.managerId, completeArchives[request.managerId]) : effects.clean(request.managerId)), 11 * 60_000);
        receiveHistory(run);
        if (run.outcome === "Succeeded") return { status: "succeeded", title: cleanupCopyFor(request.managerId)!.succeeded, message: cacheCleanupStepSummary(run) };
        if (run.outcome === "PartiallyCompleted") return { status: "partial", title: `${label} 清理部分完成`, message: cacheCleanupPartialMessage(run) };
        return { status: run.outcome === "NoPlan" ? "notExecuted" : "failed", title: run.outcome === "NoPlan" ? "没有可执行的清理方案" : `${label} 清理未完成`, message: cacheCleanupFailureMessage(run) };
      }
      if (request.kind === "uninstallSdkComponent") {
        const run = await awaitMaintenanceReply(effects.uninstall(request.managerId, request.packageName, completeArchives[request.managerId], request.sdkRoot), 6 * 60_000);
        receiveHistory(run);
        return run.status === "Ready"
          ? { status: "succeeded", title: "Android SDK 组件已卸载", message: run.command.preview }
          : { status: "failed", title: "Android SDK 组件卸载未完成", message: trimTail(run.stderr || run.stdout || run.message || "SDK 组件卸载未完成") };
      }
      const run = await awaitMaintenanceReply((completeArchives[request.managerId] ? effects.uninstall(request.managerId, request.packageName, completeArchives[request.managerId]) : effects.uninstall(request.managerId, request.packageName)), 60_000);
      receiveHistory(run);
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
    const status = error ? "failed" : "succeeded";
    setOperation({ phase: "finished", verification: { status, message: error ?? null } });
    const historyId = view.maintenance?.historyId;
    if (historyId && effects.recordVerification) {
      try {
        await effects.recordVerification(historyId, status, error ?? null, attemptArchives[operation.request.managerId] ?? null);
        publish({ historyRevision: view.historyRevision + 1, historyWarning: updateHistoryWarning("verification", null) });
      } catch (failure) { publish({ historyWarning: updateHistoryWarning("verification", `核对历史未保存：${errorToString(failure)}`) }); }
    }
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
    refresh, refreshEnabled, setManagerEnabled,
    requestCacheCleanup, requestPackageUninstall, maintenanceBlockReason, confirmMaintenance, cancelMaintenance, retryVerification,
  };
}
