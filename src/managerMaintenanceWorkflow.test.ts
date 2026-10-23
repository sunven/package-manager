import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagerMaintenanceWorkflow, type ManagerMaintenanceEffects } from "./managerMaintenanceWorkflow";
import { getObservationLedgerSnapshot, resetObservationLedgerForTests } from "./observationLedger";
import { managerFixture } from "./test/fixtures";
import type {
  CacheCleanupRun,
  DiskUsage,
  HomebrewCleanupPreview,
  MaintenanceRunPreview,
  ManagerId,
  ManagerScanProgress,
  ManagerScanSnapshot,
} from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const command = { program: "test", args: [], preview: "test maintenance", timeoutMs: 30000 };
const size: DiskUsage = { status: "Ready", bytes: 42, human: "42 B", files: 1, directories: 0, skipped: 0, message: null };
const cleanup: HomebrewCleanupPreview = { status: "Ready", command, rawOutput: "old formula", reclaimedBytes: 42, reclaimedHuman: "42 B", message: null, failure: null };
const success: CacheCleanupRun = { manager: "Npm", outcome: "Succeeded", steps: [{ label: "clean", command, state: "Succeeded", stdout: "", stderr: "", failure: null }], message: null };
const uninstallSuccess: MaintenanceRunPreview = { status: "Ready", command, stdout: "", stderr: "", message: null, failure: null };

function scanResult(id: ManagerId): ManagerScanSnapshot {
  return { manager: managerFixture(id), scanDurationMs: 1, problems: null };
}

function completeResult(id: "Homebrew" | "Pip", rawOutput = "old formula"): ManagerScanSnapshot {
  return {
    ...scanResult(id),
    manager: managerFixture(id, {
      paths: [{ label: "cache", kind: "Cache", path: "/cache", size }],
      ...(id === "Homebrew"
        ? {
            homebrew: {
              formulaCount: 1,
              caskCount: 0,
              outdatedCount: 0,
              leafCount: 0,
              outdated: [],
              leaves: [],
              cleanup: { ...cleanup, rawOutput },
            },
          }
        : {
            pip: {
              pythonVersion: "3",
              pythonExecutable: "python3",
              pipVersion: "24",
              environmentKind: "System",
              sitePackages: null,
              userSite: null,
              installedCount: 0,
              outdatedCount: 0,
              editableCount: 0,
              directUrlCount: 0,
              cache: { dir: null, rawInfo: "" },
              inspectStatus: "Ready",
              outdatedStatus: "Ready",
              outdatedMessage: null,
              outdatedFailure: null,
            },
          }),
    }),
  };
}

function problemResult(id: "Homebrew" | "Pip", problem: string): ManagerScanSnapshot {
  return { ...completeResult(id), problems: problem };
}

function setup(enabled: ManagerId[] = ["Npm", "Pnpm", "Yarn", "Homebrew", "Pip", "Docker"]) {
  const effects = {
    readEnabled: vi.fn(() => enabled),
    writeEnabled: vi.fn(),
    scan: vi.fn<ManagerMaintenanceEffects["scan"]>(async (id) => scanResult(id)),
    clean: vi.fn<ManagerMaintenanceEffects["clean"]>(async () => success),
    uninstall: vi.fn<ManagerMaintenanceEffects["uninstall"]>(async () => uninstallSuccess),
  };
  return { effects, workflow: createManagerMaintenanceWorkflow(effects) };
}

afterEach(() => {
  vi.useRealTimers();
  resetObservationLedgerForTests();
});

describe("persistent observations and maintenance receipts", () => {
  it("reports operation qualification reasons before opening maintenance confirmation", async () => {
    const { workflow } = setup(["Npm"]);
    const cleanupRequest = { kind: "cleanupCache" as const, managerId: "Npm" as const };
    expect(workflow.maintenanceBlockReason(cleanupRequest)).toContain("尚未读取 npm 清单");
    await workflow.refresh("Npm");
    expect(workflow.maintenanceBlockReason(cleanupRequest)).toBeNull();
    expect(workflow.requestCacheCleanup("Npm")).toBe(true);
    expect(workflow.maintenanceBlockReason(cleanupRequest)).toContain("另一项维护操作");
  });

  it("records manager completion and keeps the last success on a failed read", async () => {
    const { effects, workflow } = setup(["Npm"]);
    await workflow.refresh("Npm");
    const first = getObservationLedgerSnapshot().records["manager:npm"];
    expect(first?.lastSuccess?.completeness).toBe("complete");
    expect(first?.lastSuccess?.at).toBeGreaterThan(0);
    expect(workflow.read().scanStates.Npm?.lastReadFailed).toBe(false);

    effects.scan.mockRejectedValue(new Error("offline"));
    await workflow.refresh("Npm");
    const second = getObservationLedgerSnapshot().records["manager:npm"];
    expect(second?.lastSuccess?.at).toBe(first?.lastSuccess?.at);
    expect(second?.lastAttempt).toMatchObject({ outcome: "failed" });
    expect(workflow.read().scanStates.Npm?.lastReadFailed).toBe(true);
    expect(workflow.read().scanStates.Npm?.scannedAt).toBe(first?.lastSuccess?.at);
  });

  it("archives each completed read and records failed scans without relabeling old data", async () => {
    const { effects, workflow } = setup(["Homebrew"]);
    effects.scan.mockResolvedValue(completeResult("Homebrew"));
    const saveSnapshot = vi.fn(async (draft: import("./managerHistory").SnapshotDraft) => ({ ...draft, id: `saved-${saveSnapshot.mock.calls.length}`, capturedAt: 1 }));
    Object.assign(effects, { saveSnapshot });
    await workflow.refresh("Homebrew");
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    expect(saveSnapshot.mock.calls[0][0].paths[0].bytes).toBe(42);
    const previous = workflow.read().managerSnapshots.Homebrew;
    effects.scan.mockRejectedValue(new Error("offline"));
    await workflow.refresh("Homebrew");
    expect(workflow.read().managerSnapshots.Homebrew).toBe(previous);
    expect(saveSnapshot.mock.calls[1][0]).toMatchObject({ status: "Failed", packages: [], complete: false });
  });

  it("keeps execution and journal warnings when verification fails; retry only updates verification", async () => {
    const { effects, workflow } = setup(["Npm"]);
    let sequence = 0;
    const recordVerification = vi.fn(async () => {});
    Object.assign(effects, {
      saveSnapshot: vi.fn(async (draft: import("./managerHistory").SnapshotDraft) => ({ ...draft, id: `snapshot-${++sequence}`, capturedAt: sequence })),
      recordVerification,
    });
    await workflow.refresh("Npm");
    effects.clean.mockResolvedValue({ ...success, historyId: "operation-1", historyWarning: "disk full" });
    effects.scan.mockRejectedValue(new Error("read failed"));
    workflow.requestCacheCleanup("Npm");
    const id = workflow.read().maintenance!.id;
    await workflow.confirmMaintenance(id);
    expect(workflow.read().maintenance?.execution?.status).toBe("succeeded");
    expect(workflow.read().historyWarning).toContain("disk full");
    expect(recordVerification).toHaveBeenCalledWith("operation-1", "failed", "read failed", "snapshot-2");
    effects.scan.mockResolvedValue(scanResult("Npm"));
    await workflow.retryVerification(id);
    expect(recordVerification).toHaveBeenLastCalledWith("operation-1", "succeeded", null, "snapshot-3");
    expect(effects.clean).toHaveBeenCalledTimes(1);
    expect(effects.clean).toHaveBeenCalledWith("Npm", "snapshot-1");
  });

  it("does not turn successful scanning into failure when archive writes fail", async () => {
    const { effects, workflow } = setup(["Npm"]);
    Object.assign(effects, { saveSnapshot: vi.fn().mockRejectedValue(new Error("read only")) });
    await workflow.refresh("Npm");
    expect(workflow.read().scanStates.Npm?.error).toBeNull();
    expect(workflow.read().managerSnapshots.Npm?.status).toBe("Ready");
    expect(workflow.read().historyWarning).toContain("read only");
  });

  it("retains each manager's archive warning until that manager saves successfully", async () => {
    const { effects, workflow } = setup(["Npm", "Pnpm"]);
    const failing = new Set<ManagerId>(["Npm", "Pnpm"]);
    Object.assign(effects, { saveSnapshot: vi.fn(async (draft: import("./managerHistory").SnapshotDraft) => {
      if (failing.has(draft.managerId)) throw new Error(`${draft.managerId} archive unavailable`);
      return { ...draft, id: draft.managerId, capturedAt: 1 };
    }) });
    await workflow.refreshEnabled();
    expect(workflow.read().historyWarning).toContain("Npm archive unavailable");
    expect(workflow.read().historyWarning).toContain("Pnpm archive unavailable");
    failing.delete("Pnpm");
    await workflow.refresh("Pnpm");
    expect(workflow.read().historyWarning).toContain("Npm archive unavailable");
    expect(workflow.read().historyWarning).not.toContain("Pnpm archive unavailable");
    failing.delete("Npm");
    await workflow.refresh("Npm");
    expect(workflow.read().historyWarning).toBeNull();
  });
});

describe("manager maintenance workflow", () => {
  it("excludes new reads and maintenance during confirmation while admitted scans keep their two slots", async () => {
    const { effects, workflow } = setup();
    await workflow.refresh("Npm");
    const gates = { Pnpm: deferred<ManagerScanSnapshot>(), Yarn: deferred<ManagerScanSnapshot>(), Pip: deferred<ManagerScanSnapshot>() };
    effects.scan.mockImplementation((id) => gates[id as keyof typeof gates].promise);
    const scans = [workflow.refresh("Pnpm"), workflow.refresh("Yarn"), workflow.refresh("Pip")];
    expect(workflow.refresh("Pnpm")).toBe(scans[0]);
    await vi.waitFor(() => expect(effects.scan).toHaveBeenCalledTimes(3));
    expect(workflow.read().scanStates.Pip?.phase).toBe("queued");
    expect(workflow.requestCacheCleanup("Pnpm")).toBe(false);
    expect(workflow.requestCacheCleanup("Npm")).toBe(true);
    await workflow.refresh("Homebrew");
    await workflow.refreshEnabled();
    await workflow.retrySupplement("Pip", "pip");
    expect(workflow.requestCacheCleanup("Npm")).toBe(false);
    gates.Pnpm.resolve(scanResult("Pnpm"));
    await vi.waitFor(() => expect(effects.scan).toHaveBeenCalledWith("Pip", expect.any(Function)));
    gates.Yarn.resolve(scanResult("Yarn"));
    gates.Pip.resolve(scanResult("Pip"));
    await Promise.all(scans);
    expect(effects.scan).toHaveBeenCalledTimes(4);
    expect(workflow.read().maintenance?.phase).toBe("confirming");
    expect(workflow.read().scanningManagers.size).toBe(0);
  });

  it("streams read progress and keeps the manager occupied until the command returns", async () => {
    const { effects, workflow } = setup();
    const completion = deferred<ManagerScanSnapshot>();
    let onProgress!: (progress: ManagerScanProgress) => void;
    effects.scan.mockImplementation((_id, report) => {
      onProgress = report;
      return completion.promise;
    });
    const scan = workflow.refresh("Homebrew");
    await vi.waitFor(() => expect(onProgress).toBeDefined());

    onProgress({ phase: "reading" });
    expect(workflow.read().scanStates.Homebrew?.phase).toBe("reading");
    onProgress({ phase: "measuring", completed: 0, total: 1 });
    expect(workflow.read().scanStates.Homebrew?.phase).toBe("enriching");
    expect(workflow.read().pendingSizeScansByManager.Homebrew).toBe(1);
    expect(workflow.requestCacheCleanup("Homebrew")).toBe(false);
    onProgress({ phase: "hydratingHomebrew" });
    expect(workflow.read().pendingHomebrewCleanup).toBe(true);
    expect(workflow.read().scanningManagers.has("Homebrew")).toBe(true);

    completion.resolve(completeResult("Homebrew"));
    await scan;
    expect(workflow.read().managerSnapshots.Homebrew?.paths[0].size).toEqual(size);
    expect(workflow.read().pendingSizeScansByManager.Homebrew).toBe(0);
    expect(workflow.read().pendingHomebrewCleanup).toBe(false);
    expect(workflow.read().scanningManagers.size).toBe(0);
  });

  it("freezes the preview, invalidates disabled targets, and rejects callbacks from an old confirmation", async () => {
    const { effects, workflow } = setup();
    effects.scan.mockResolvedValue(completeResult("Homebrew"));
    await workflow.refresh("Homebrew");
    workflow.requestCacheCleanup("Homebrew");
    const original = workflow.read().maintenance!;
    await workflow.refresh("Homebrew");
    expect(original.reclaimDetails).toBe("old formula");
    expect(original.reclaimable?.value).toBe("42 B");
    expect(effects.scan).toHaveBeenCalledTimes(1);
    expect(workflow.setManagerEnabled("Homebrew", false)).toBe(true);
    expect(workflow.read().maintenance?.phase).toBe("invalidated");
    expect(workflow.read().maintenanceBusy).toBe(false);
    await workflow.confirmMaintenance(original.id);
    expect(effects.clean).not.toHaveBeenCalled();
    workflow.cancelMaintenance(original.id);
    workflow.setManagerEnabled("Homebrew", true);
    effects.scan.mockResolvedValueOnce(completeResult("Homebrew", "new formula"));
    await workflow.refresh("Homebrew");
    workflow.requestCacheCleanup("Homebrew");
    expect(workflow.read().maintenance?.reclaimDetails).toBe("new formula");
    expect(original.reclaimDetails).toBe("old formula");
    await workflow.confirmMaintenance(original.id);
    expect(workflow.cancelMaintenance(original.id)).toBe(false);
    expect(effects.clean).not.toHaveBeenCalled();
    await workflow.confirmMaintenance(workflow.read().maintenance!.id);
    expect(effects.clean).toHaveBeenCalledTimes(1);
  });

  it("publishes execution before verification finishes, keeps the lock, and invokes duplicate confirmation only once", async () => {
    const { effects, workflow } = setup();
    await workflow.refresh("Npm");
    const execution = deferred<CacheCleanupRun>();
    const verification = deferred<ManagerScanSnapshot>();
    effects.clean.mockReturnValue(execution.promise);
    effects.scan.mockReturnValue(verification.promise);
    workflow.requestCacheCleanup("Npm");
    const id = workflow.read().maintenance!.id;
    const finished = workflow.confirmMaintenance(id);
    await workflow.confirmMaintenance(id);
    expect(effects.clean).toHaveBeenCalledTimes(1);
    expect(workflow.read().maintenance?.phase).toBe("executing");
    expect(workflow.setManagerEnabled("Npm", false)).toBe(false);
    expect(workflow.cancelMaintenance(id)).toBe(false);
    await workflow.refreshEnabled();
    execution.resolve(success);
    await vi.waitFor(() => expect(workflow.read().maintenance?.phase).toBe("verifying"));
    expect(workflow.read().maintenance?.execution?.status).toBe("succeeded");
    expect(workflow.read().lockedManager).toBe("Npm");
    expect(workflow.setManagerEnabled("Npm", false)).toBe(false);
    expect(workflow.cancelMaintenance(id)).toBe(false);
    expect(workflow.requestCacheCleanup("Npm")).toBe(false);
    await workflow.refresh("Pnpm");
    await workflow.retrySupplement("Npm", "paths");
    expect(effects.scan).toHaveBeenCalledTimes(2);
    verification.resolve(scanResult("Npm"));
    await finished;
    expect(workflow.read().maintenance?.verification.status).toBe("succeeded");
    expect(workflow.read().maintenanceBusy).toBe(false);
    expect(workflow.read().lockedManager).toBeNull();
    expect(workflow.setManagerEnabled("Npm", false)).toBe(true);
  });

  it("retains successful execution and the old snapshot on verification failure; retry reads only the target", async () => {
    const { effects, workflow } = setup();
    await workflow.refresh("Npm");
    const snapshot = workflow.read().managerSnapshots.Npm;
    workflow.requestCacheCleanup("Npm");
    const id = workflow.read().maintenance!.id;
    effects.scan.mockRejectedValueOnce(new Error("bridge disconnected"));
    await workflow.confirmMaintenance(id);
    const execution = workflow.read().maintenance!.execution;
    expect(execution?.status).toBe("succeeded");
    expect(workflow.read().maintenance?.verification).toEqual({ status: "failed", message: "bridge disconnected" });
    expect(workflow.read().managerSnapshots.Npm).toBe(snapshot);
    expect(workflow.read().maintenanceBusy).toBe(false);
    await workflow.retryVerification(id);
    expect(workflow.read().maintenance?.execution).toBe(execution);
    expect(workflow.read().maintenance?.verification.status).toBe("succeeded");
    expect(effects.clean).toHaveBeenCalledTimes(1);
    expect(effects.scan.mock.calls.map(([id]) => id)).toEqual(["Npm", "Npm", "Npm"]);
  });

  it.each(["Homebrew", "Pip"] as const)("verifies %s read problems and retries the full read", async (manager) => {
    const { effects, workflow } = setup();
    effects.scan.mockResolvedValueOnce(completeResult(manager));
    await workflow.refresh(manager);
    workflow.requestCacheCleanup(manager);
    const id = workflow.read().maintenance!.id;
    effects.scan.mockResolvedValueOnce(problemResult(manager, "permission denied"));
    await workflow.confirmMaintenance(id);
    expect(workflow.read().maintenance?.execution?.status).toBe("succeeded");
    expect(workflow.read().maintenance?.verification.status).toBe("failed");
    effects.scan.mockResolvedValueOnce(completeResult(manager));
    await workflow.retryVerification(id);
    expect(workflow.read().maintenance?.verification.status).toBe("succeeded");
    expect(effects.clean).toHaveBeenCalledTimes(1);
    expect(effects.scan.mock.calls.map(([id]) => id)).toEqual([manager, manager, manager]);
  });

  it("waits for an in-progress supplement retry before a fresh verification read", async () => {
    const { effects, workflow } = setup();
    effects.scan.mockResolvedValueOnce(completeResult("Pip"));
    await workflow.refresh("Pip");
    workflow.requestCacheCleanup("Pip");
    const id = workflow.read().maintenance!.id;
    effects.scan.mockResolvedValueOnce(problemResult("Pip", "permission denied"));
    await workflow.confirmMaintenance(id);

    const first = deferred<ManagerScanSnapshot>();
    effects.scan.mockReturnValueOnce(first.promise);
    effects.scan.mockResolvedValueOnce(completeResult("Pip"));
    const supplement = workflow.retrySupplement("Pip", "paths");
    const reread = workflow.retryVerification(id);
    await vi.waitFor(() => expect(effects.scan).toHaveBeenCalledTimes(3));
    expect(workflow.read().maintenanceBusy).toBe(true);
    first.resolve(completeResult("Pip"));
    await Promise.all([supplement, reread]);
    expect(effects.scan).toHaveBeenCalledTimes(4);
    expect(workflow.read().maintenance?.verification.status).toBe("succeeded");
    expect(effects.clean).toHaveBeenCalledTimes(1);
  });

  it.each(["PartiallyCompleted", "Failed"] as const)("verifies native %s without upgrading the execution outcome", async (outcome) => {
    const { effects, workflow } = setup();
    await workflow.refresh("Docker");
    effects.clean.mockResolvedValue({ ...success, manager: "Docker", outcome, message: "native failure" });
    workflow.requestCacheCleanup("Docker");
    await workflow.confirmMaintenance(workflow.read().maintenance!.id);
    expect(workflow.read().maintenance?.execution?.status).toBe(outcome === "Failed" ? "failed" : "partial");
    expect(workflow.read().maintenance?.verification.status).toBe("succeeded");
    expect(effects.scan.mock.calls.map(([id]) => id)).toEqual(["Docker", "Docker"]);
  });

  it.each(["Npm", "Pnpm"] as const)("uninstalls the frozen %s package and verifies native timeout failures", async (manager) => {
    const { effects, workflow } = setup();
    effects.scan.mockResolvedValue({ ...scanResult(manager), manager: managerFixture(manager, { packages: [{ name: "@scope/tool", version: "1", source: "global", kind: "Generic", path: null, actions: [], signals: [] }] }) });
    await workflow.refresh(manager);
    effects.uninstall.mockResolvedValue({ ...uninstallSuccess, status: "Failed", message: "command timed out", failure: { kind: "Timeout", message: "command timed out", stdout: "", stderr: "" } });
    workflow.requestPackageUninstall(manager, "@scope/tool");
    await workflow.confirmMaintenance(workflow.read().maintenance!.id);
    expect(effects.uninstall).toHaveBeenCalledExactlyOnceWith(manager, "@scope/tool");
    expect(workflow.read().maintenance?.execution?.status).toBe("failed");
    expect(workflow.read().maintenance?.verification.status).toBe("succeeded");
    expect(effects.clean).not.toHaveBeenCalled();
  });

  it("verifies IPC rejection without claiming that maintenance failed to execute", async () => {
    const { effects, workflow } = setup();
    await workflow.refresh("Npm");
    effects.clean.mockRejectedValue(new Error("lost reply"));
    workflow.requestCacheCleanup("Npm");
    await workflow.confirmMaintenance(workflow.read().maintenance!.id);
    expect(workflow.read().maintenance?.execution?.status).toBe("unconfirmed");
    expect(workflow.read().maintenance?.verification.status).toBe("succeeded");
    expect(effects.clean).toHaveBeenCalledTimes(1);
  });

  it("bounds a missing execution reply and ignores late success after read-only verification", async () => {
    vi.useFakeTimers();
    const { effects, workflow } = setup();
    await workflow.refresh("Npm");
    const reply = deferred<CacheCleanupRun>();
    effects.clean.mockReturnValue(reply.promise);
    workflow.requestCacheCleanup("Npm");
    const finished = workflow.confirmMaintenance(workflow.read().maintenance!.id);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await finished;
    expect(workflow.read().maintenance?.execution?.status).toBe("unconfirmed");
    expect(workflow.read().maintenance?.verification.status).toBe("succeeded");
    reply.resolve(success);
    await Promise.resolve();
    expect(workflow.read().maintenance?.execution?.status).toBe("unconfirmed");
    expect(effects.clean).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips verification for NoPlan and rejects unsupported local requests before execution", async () => {
    const { effects, workflow } = setup(["Npm", "Cargo"]);
    expect(workflow.requestCacheCleanup("Npm")).toBe(false);
    await workflow.refresh("Cargo");
    expect(workflow.requestCacheCleanup("Cargo")).toBe(false);
    await workflow.refresh("Npm");
    effects.clean.mockResolvedValue({ ...success, outcome: "NoPlan", steps: [] });
    workflow.requestCacheCleanup("Npm");
    const id = workflow.read().maintenance!.id;
    await workflow.confirmMaintenance(id);
    await workflow.retryVerification(id);
    expect(workflow.read().maintenance?.execution?.status).toBe("notExecuted");
    expect(workflow.read().maintenance?.verification.status).toBe("skipped");
    expect(effects.scan).toHaveBeenCalledTimes(2);
  });

  it("explains a disabled target on reread and allows retry after re-enabling", async () => {
    const { effects, workflow } = setup();
    await workflow.refresh("Npm");
    workflow.requestCacheCleanup("Npm");
    const id = workflow.read().maintenance!.id;
    await workflow.confirmMaintenance(id);
    workflow.setManagerEnabled("Npm", false);
    await workflow.retryVerification(id);
    expect(workflow.read().maintenance?.verification.message).toContain("已停用");
    expect(effects.scan).toHaveBeenCalledTimes(2);
    workflow.setManagerEnabled("Npm", true);
    await workflow.retryVerification(id);
    expect(workflow.read().maintenance?.verification.status).toBe("succeeded");
    expect(effects.clean).toHaveBeenCalledTimes(1);
    expect(effects.scan).toHaveBeenCalledTimes(3);
  });
});
