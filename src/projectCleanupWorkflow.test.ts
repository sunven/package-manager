import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectCleanupWorkflow,
  type CleanupBatchSummary,
  type ProjectCleanupEffects,
} from "./projectCleanupWorkflow";
import { getObservationLedgerSnapshot, resetObservationLedgerForTests } from "./observationLedger";
import { createInMemoryProjectCleanupEffects as effects } from "./projectCleanupInMemoryEffects";
import type {
  DirectoryMeasurement,
  ProjectDataCandidate,
  ProjectDataScan,
  ProjectCleanupBatchProgress,
  ProjectCleanupSettings,
  ProjectScanRecord,
  ProjectScanRecordDraft,
} from "./types";

function settings(rootId = "root-1", rootPath = "/code", maxDepth = 6) {
  return { rootId, rootPath, maxDepth, presets: [{ id: "preset-1", path: rootPath, maxDepth }], activePresetId: "preset-1", rootMessage: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}

function pendingCandidate(
  candidateId: string,
  kind: ProjectDataCandidate["kind"] = "NodeModules",
  status: ProjectDataCandidate["status"] = "Ready",
): ProjectDataCandidate {
  return {
    candidateId,
    kind,
    projectPath: `/code/${candidateId}`,
    directoryPath: `/code/${candidateId}/node_modules`,
    status,
    message: null,
    measurement: {
      status: "Pending",
      bytes: null,
      human: null,
      files: 0,
      directories: 0,
      skipped: 0,
      latestModifiedMs: null,
      message: null,
    },
  };
}

function measurement(bytes: number): DirectoryMeasurement {
  return {
    status: "Ready",
    bytes,
    human: `${bytes} B`,
    files: 1,
    directories: 1,
    skipped: 0,
    latestModifiedMs: 100,
    message: null,
  };
}

function scan(
  candidates: ProjectDataCandidate[],
  projects: ProjectDataScan["projects"] = { total: 0, rust: 0, node: 0, maven: 0 },
): ProjectDataScan {
  return {
    rootId: "root-1",
    scanId: "scan-1",
    rootPath: "/code",
    maxDepth: 6,
    status: "Ready",
    projects,
    candidates,
    skipped: 0,
    errors: [],
    cargoAvailable: true,
    cargoMessage: null,
    mavenAvailable: true,
    mavenMessage: null,
  };
}

function recordFromDraft(
  draft: ProjectScanRecordDraft,
  overrides: Partial<ProjectScanRecord> = {},
): ProjectScanRecord {
  const candidates = {
    total: draft.candidates.length,
    rustTarget: draft.candidates.filter((candidate) => candidate.kind === "RustTarget").length,
    mavenTarget: draft.candidates.filter((candidate) => candidate.kind === "MavenTarget").length,
    nodeModules: draft.candidates.filter((candidate) => candidate.kind === "NodeModules").length,
  };
  return {
    id: `record-${draft.finishedAt}`,
    presetId: draft.presetId,
    scanId: draft.scanId,
    rootPath: draft.rootPath,
    maxDepth: draft.maxDepth,
    finishedAt: draft.finishedAt,
    discovery: { complete: draft.skipped === 0, skipped: draft.skipped },
    measurement: draft.measurement,
    projects: draft.projects,
    candidates,
    baseline: null,
    changes: null,
    ...overrides,
  };
}

function cleanupResult(
  candidateId: string,
  cleanedBytes: number,
  status: "Succeeded" | "Failed" = "Succeeded",
): import("./types").ProjectCleanupResult {
  return {
    candidateId,
    status,
    command: null,
    beforeBytes: cleanedBytes,
    afterBytes: 0,
    cleanedBytes,
    measurement: measurement(0),
    stdout: "",
    stderr: "",
    message: null,
    failure: null,
  };
}

afterEach(resetObservationLedgerForTests);

describe("Project Cleanup workflow", () => {
  it("records completed, stopped and failed scans in the observation ledger", async () => {
    const completed = createProjectCleanupWorkflow(effects({
      readSettings: async () => settings(),
      scan: async () => scan([]),
    }));
    await completed.initialize();
    await completed.startScan();
    expect(getObservationLedgerSnapshot().records["project-scan"]?.lastSuccess).toMatchObject({
      completeness: "complete",
      scope: "/code\n6",
    });

    resetObservationLedgerForTests();
    const measuring = deferred<DirectoryMeasurement>();
    const stopped = createProjectCleanupWorkflow(effects({
      readSettings: async () => settings(),
      scan: async () => scan([pendingCandidate("candidate")]),
      measure: async () => measuring.promise,
    }));
    await stopped.initialize();
    const running = stopped.startScan();
    await waitFor(() => stopped.read().scan.phase === "measuring");
    stopped.requestScanStop();
    measuring.resolve(measurement(100));
    await running;
    expect(getObservationLedgerSnapshot().records["project-scan"]?.lastSuccess).toMatchObject({
      completeness: "partial",
      note: "扫描未完成",
    });

    resetObservationLedgerForTests();
    const failed = createProjectCleanupWorkflow(effects({
      readSettings: async () => settings(),
      scan: async () => { throw new Error("offline"); },
    }));
    await failed.initialize();
    await failed.startScan();
    expect(getObservationLedgerSnapshot().records["project-scan"]?.lastAttempt).toMatchObject({
      outcome: "failed",
      reason: "offline",
      scope: "/code\n6",
    });
  });

  it("locks settings changes while saving and discards old candidates when switching presets", async () => {
    const saving = deferred<ProjectCleanupSettings>();
    const workflow = createProjectCleanupWorkflow(effects({
      readSettings: async () => settings(),
      scan: async () => scan([pendingCandidate("old-candidate")]),
      measure: async () => measurement(100),
      selectPreset: async () => saving.promise,
      removePreset: async () => ({ ...settings(), rootId: null, rootPath: null, presets: [], activePresetId: null }),
    }));
    await workflow.initialize();
    await workflow.startScan();
    workflow.setSelected(["old-candidate"], true);
    const selecting = workflow.selectPreset("preset-2");
    expect(await workflow.startScan()).toEqual({ kind: "unavailable", reason: "settings-busy" });
    expect(await workflow.setMaxDepth(12)).toEqual({ kind: "unavailable", reason: "settings-busy" });
    expect(workflow.prepareCleanupBatch(["old-candidate"])).toEqual({ kind: "unavailable", reason: "settings-busy" });
    saving.resolve({ ...settings("root-2", "/work", 3), activePresetId: "preset-2", presets: [{ id: "preset-2", path: "/work", maxDepth: 3 }] });
    await selecting;
    expect(workflow.read()).toMatchObject({ settings: { rootId: "root-2", maxDepth: 3 }, scan: { phase: "idle", session: null }, totals: { selectedCount: 0 } });
    await workflow.removePreset("preset-2");
    expect(workflow.read()).toMatchObject({ settings: { rootId: null, activePresetId: null, presets: [] }, scan: { session: null } });
    expect(await workflow.startScan()).toEqual({ kind: "unavailable", reason: "no-root" });
  });

  it("preserves saved depth and the scan when saving fails", async () => {
    const workflow = createProjectCleanupWorkflow(effects({
      readSettings: async () => settings(),
      scan: async () => scan([pendingCandidate("candidate")]),
      measure: async () => measurement(100),
      updateDepth: async () => { throw new Error("disk full"); },
    }));
    await workflow.initialize();
    await workflow.startScan();
    expect(await workflow.setMaxDepth(12)).toMatchObject({ kind: "failed", failure: { message: "disk full" } });
    expect(workflow.read()).toMatchObject({ settings: { phase: "ready", maxDepth: 6 }, scan: { session: { scanId: "scan-1" } } });
  });

  it("initializes persisted Scan Root settings through its interface", async () => {
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
      }),
    );

    expect(workflow.read().settings).toEqual({
      phase: "loading",
      rootId: null,
      rootPath: null,
      maxDepth: 8,
      presets: [], activePresetId: null, rootMessage: null,
      failure: null,
    });

    await expect(workflow.initialize()).resolves.toEqual({
      kind: "succeeded",
      value: undefined,
    });
    expect(workflow.read().settings).toEqual({
      phase: "ready",
      ...settings(),
      failure: null,
    });
  });

  it("publishes a structured settings failure to subscribers", async () => {
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => {
          throw new Error("settings unavailable");
        },
      }),
    );
    const published: unknown[] = [];
    const unsubscribe = workflow.subscribe(() => published.push(workflow.read().settings));

    await expect(workflow.initialize()).resolves.toEqual({
      kind: "failed",
      failure: {
        operation: "settings",
        message: "settings unavailable",
      },
    });
    expect(published).toEqual([
      {
        phase: "failed",
        rootId: null,
        rootPath: null,
        maxDepth: 8,
        presets: [], activePresetId: null, rootMessage: null,
        failure: {
          operation: "settings",
          message: "settings unavailable",
        },
      },
    ]);

    unsubscribe();
  });

  it("discovers a Scan Session and measures candidates with four workers", async () => {
    const candidates = ["one", "two", "three", "four", "five"].map((id) => pendingCandidate(id));
    const gates = new Map(candidates.map((item) => [
      item.candidateId,
      deferred<DirectoryMeasurement>(),
    ]));
    const measurementCalls: string[] = [];
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan(candidates),
        measure: async ({ candidateId }) => {
          measurementCalls.push(candidateId);
          return gates.get(candidateId)!.promise;
        },
      }),
    );
    await workflow.initialize();

    const running = workflow.startScan();
    await waitFor(() => measurementCalls.length === 4);

    expect(measurementCalls).toEqual(["one", "two", "three", "four"]);
    expect(workflow.read().scan).toMatchObject({
      phase: "measuring",
      pendingMeasurements: 5,
      session: { scanId: "scan-1" },
    });

    for (const candidateId of measurementCalls) {
      gates.get(candidateId)!.resolve(measurement(100));
    }
    await waitFor(() => measurementCalls.length === 5);
    expect(measurementCalls).toEqual(["one", "two", "three", "four", "five"]);
    gates.get("five")!.resolve(measurement(500));

    await expect(running).resolves.toEqual({
      kind: "succeeded",
      value: { scanId: "scan-1", finish: "completed" },
    });
    expect(workflow.read().scan).toMatchObject({
      phase: "ready",
      pendingMeasurements: 0,
      session: {
        candidates: [
          { candidateId: "one", measurement: { bytes: 100 } },
          { candidateId: "two", measurement: { bytes: 100 } },
          { candidateId: "three", measurement: { bytes: 100 } },
          { candidateId: "four", measurement: { bytes: 100 } },
          { candidateId: "five", measurement: { bytes: 500 } },
        ],
      },
    });
  });

  it("stops a scan cooperatively and ignores late measurements", async () => {
    const candidates = ["one", "two", "three", "four", "five", "six"].map((id) => pendingCandidate(id));
    const gates = new Map(candidates.map((item) => [
      item.candidateId,
      deferred<DirectoryMeasurement>(),
    ]));
    const measurementCalls: string[] = [];
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan(candidates),
        measure: async ({ candidateId }) => {
          measurementCalls.push(candidateId);
          return gates.get(candidateId)!.promise;
        },
      }),
    );
    await workflow.initialize();
    const running = workflow.startScan();
    await waitFor(() => measurementCalls.length === 4);

    gates.get("one")!.resolve(measurement(100));
    await waitFor(
      () => workflow.read().scan.session?.candidates[0].measurement.status === "Ready",
    );
    expect(measurementCalls).toEqual(["one", "two", "three", "four", "five"]);
    expect(workflow.requestScanStop()).toEqual({
      kind: "succeeded",
      value: undefined,
    });
    expect(workflow.read().scan).toMatchObject({
      phase: "stopped",
      pendingMeasurements: 0,
    });

    for (const candidateId of ["two", "three", "four", "five"]) {
      gates.get(candidateId)!.resolve(measurement(900));
    }
    await expect(running).resolves.toEqual({ kind: "cancelled" });
    expect(measurementCalls).toEqual(["one", "two", "three", "four", "five"]);
    expect(workflow.read().scan.session?.candidates.map((candidate) => candidate.measurement.bytes)).toEqual([
      100,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("publishes Cleanable Candidate policy progressively", async () => {
    const candidates = [
      pendingCandidate("node"),
      pendingCandidate("rust", "RustTarget"),
      pendingCandidate("maven", "MavenTarget"),
      pendingCandidate("unknown", "NodeModules", "Unrecognized"),
      pendingCandidate("partial"),
    ];
    const gates = new Map(candidates.map((item) => [
      item.candidateId,
      deferred<DirectoryMeasurement>(),
    ]));
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => ({ ...scan(candidates), cargoAvailable: false, mavenAvailable: false }),
        measure: async ({ candidateId }) => gates.get(candidateId)!.promise,
      }),
    );
    await workflow.initialize();
    const running = workflow.startScan();

    gates.get("node")!.resolve(measurement(100));
    await waitFor(
      () => workflow.read().scan.session?.candidates[0].measurement.status === "Ready",
    );
    expect(workflow.read().scan.session?.candidates[0]).toMatchObject({
      candidateId: "node",
      cleanability: { kind: "cleanable" },
      selected: false,
    });
    expect(workflow.read().scan.phase).toBe("measuring");

    gates.get("rust")!.resolve(measurement(200));
    gates.get("maven")!.resolve(measurement(250));
    gates.get("unknown")!.resolve(measurement(300));
    gates.get("partial")!.resolve({
      ...measurement(50),
      status: "Partial",
      skipped: 1,
      message: "one path skipped",
    });
    await running;

    expect(
      workflow.read().scan.session?.candidates.map((candidate) => candidate.cleanability),
    ).toEqual([
      { kind: "cleanable" },
      { kind: "blocked", reason: "cleanup-mechanism-unavailable" },
      { kind: "blocked", reason: "cleanup-mechanism-unavailable" },
      { kind: "blocked", reason: "identity-not-verified" },
      { kind: "blocked", reason: "directory-footprint-incomplete" },
    ]);
  });

  it("keeps a Scan Session when one candidate measurement fails", async () => {
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan([pendingCandidate("broken")]),
        measure: async () => {
          throw new Error("permission denied");
        },
      }),
    );
    await workflow.initialize();

    await expect(workflow.startScan()).resolves.toEqual({
      kind: "succeeded",
      value: { scanId: "scan-1", finish: "completed" },
    });
    expect(workflow.read().scan).toMatchObject({
      phase: "ready",
      failure: null,
      session: {
        candidates: [
          {
            candidateId: "broken",
            measurement: {
              status: "Error",
              message: "permission denied",
            },
            cleanability: {
              kind: "blocked",
              reason: "directory-footprint-incomplete",
            },
          },
        ],
      },
    });
  });

  it("owns Cleanable Candidate selection and Directory Footprint totals", async () => {
    const ready = pendingCandidate("ready");
    const review = pendingCandidate("review", "NodeModules", "Unrecognized");
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan([ready, review]),
        measure: async ({ candidateId }) =>
          candidateId === "ready" ? measurement(500) : measurement(200),
      }),
    );
    await workflow.initialize();
    await workflow.startScan();

    expect(workflow.read().totals).toEqual({
      verifiedBytes: 500,
      reviewBytes: 200,
      reviewCount: 1,
      selectedCount: 0,
      selectedBytes: 0,
      cleanedBytes: 0,
    });
    expect(workflow.setSelected(["ready", "review"], true)).toEqual({
      kind: "succeeded",
      value: { changed: 1, notCleanable: ["review"] },
    });
    expect(
      workflow.read().scan.session?.candidates.map(({ candidateId, selected }) => ({
        candidateId,
        selected,
      })),
    ).toEqual([
      { candidateId: "ready", selected: true },
      { candidateId: "review", selected: false },
    ]);
    expect(workflow.read().totals).toMatchObject({
      selectedCount: 1,
      selectedBytes: 500,
    });

    expect(workflow.clearSelection()).toEqual({ kind: "succeeded", value: undefined });
    expect(workflow.read().totals).toMatchObject({ selectedCount: 0, selectedBytes: 0 });
  });

  it("freezes a Cleanup Batch in displayed order and locks its Scan Session", async () => {
    const candidates = ["one", "two", "three"].map((id) => pendingCandidate(id));
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan(candidates),
        measure: async ({ candidateId }) =>
          measurement({ one: 100, two: 200, three: 300 }[candidateId]!),
      }),
    );
    await workflow.initialize();
    await workflow.startScan();
    workflow.setSelected(["one", "two", "three"], true);

    expect(workflow.prepareCleanupBatch(["three", "one", "two"])).toEqual({
      kind: "succeeded",
      value: { batchId: "batch-1" },
    });
    expect(workflow.read().batch).toMatchObject({
      phase: "confirmation",
      batchId: "batch-1",
      scanId: "scan-1",
      selectedBytes: 600,
      candidates: [
        { candidateId: "three", beforeBytes: 300, state: { kind: "not-started" } },
        { candidateId: "one", beforeBytes: 100, state: { kind: "not-started" } },
        { candidateId: "two", beforeBytes: 200, state: { kind: "not-started" } },
      ],
    });
    expect(workflow.setSelected(["one"], false)).toEqual({
      kind: "unavailable",
      reason: "batch-lock",
    });
    await expect(workflow.startScan()).resolves.toEqual({
      kind: "unavailable",
      reason: "batch-lock",
    });
    await expect(workflow.selectPreset("preset-2")).resolves.toEqual({ kind: "unavailable", reason: "batch-lock" });
    await expect(workflow.removePreset("preset-1")).resolves.toEqual({ kind: "unavailable", reason: "batch-lock" });
    await expect(workflow.setMaxDepth(12)).resolves.toEqual({ kind: "unavailable", reason: "batch-lock" });
  });

  it("runs the frozen batch through one effect and applies per-candidate progress", async () => {
    const candidates = ["one", "two", "three"].map((id) => pendingCandidate(id));
    const completion = deferred<CleanupBatchSummary>();
    let onProgress!: (progress: ProjectCleanupBatchProgress) => void;
    const runBatch = vi.fn((input: Parameters<ProjectCleanupEffects["runBatch"]>[0]) => {
      onProgress = input.onProgress;
      return completion.promise;
    });
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan(candidates),
        measure: async ({ candidateId }) =>
          measurement({ one: 100, two: 200, three: 300 }[candidateId]!),
        runBatch,
      }),
    );
    await workflow.initialize();
    await workflow.startScan();
    workflow.setSelected(["one", "two", "three"], true);
    workflow.prepareCleanupBatch(["three", "one", "two"]);

    const running = workflow.runCleanupBatch();
    await Promise.resolve();
    expect(runBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        scanId: "scan-1",
        batchId: "batch-1",
        candidateIds: ["three", "one", "two"],
      }),
    );
    expect(workflow.read().batch?.candidates.map((candidate) => candidate.state.kind)).toEqual([
      "running",
      "not-started",
      "not-started",
    ]);

    onProgress({
      phase: "advanced",
      candidateId: "three",
      outcome: { kind: "result", result: cleanupResult("three", 300) },
      completedCount: 1,
      cleanedBytes: 300,
    });
    expect(
      workflow.read().scan.session?.candidates.find(({ candidateId }) => candidateId === "three"),
    ).toMatchObject({
      selected: false,
      cleanability: { kind: "requires-rescan" },
    });
    expect(workflow.read().batch?.candidates.map((candidate) => candidate.state.kind)).toEqual([
      "finished",
      "running",
      "not-started",
    ]);

    onProgress({
      phase: "advanced",
      candidateId: "one",
      outcome: { kind: "effect-failed", candidateId: "one", message: "IPC disconnected" },
      completedCount: 2,
      cleanedBytes: 300,
    });
    onProgress({
      phase: "advanced",
      candidateId: "two",
      outcome: { kind: "result", result: cleanupResult("two", 50, "Failed") },
      completedCount: 3,
      cleanedBytes: 350,
    });
    completion.resolve({
      finish: "completed",
      totalCount: 3,
      completedCount: 3,
      failedCount: 2,
      cleanedBytes: 350,
      historyId: null,
      historyWarning: null,
    });

    await expect(running).resolves.toEqual({
      kind: "succeeded",
      value: {
        finish: "completed",
        totalCount: 3,
        completedCount: 3,
        failedCount: 2,
        cleanedBytes: 350,
        historyId: null,
        historyWarning: null,
      },
    });
    expect(workflow.read().batch).toMatchObject({
      phase: "result",
      finish: "completed",
      completedCount: 3,
      cleanedBytes: 350,
      candidates: [
        { candidateId: "three", state: { kind: "finished", outcome: { kind: "result" } } },
        {
          candidateId: "one",
          state: {
            kind: "finished",
            outcome: {
              kind: "effect-failed",
              failure: { operation: "clean", message: "IPC disconnected", candidateId: "one" },
            },
          },
        },
        { candidateId: "two", state: { kind: "finished", outcome: { kind: "result" } } },
      ],
    });
  });

  it("requests a stop from Rust and marks unstarted candidates stopped", async () => {
    const candidates = ["one", "two", "three"].map((id) => pendingCandidate(id));
    const completion = deferred<CleanupBatchSummary>();
    let onProgress!: (progress: ProjectCleanupBatchProgress) => void;
    const requestStop = vi.fn(async () => undefined);
    const runBatch = vi.fn((input: Parameters<ProjectCleanupEffects["runBatch"]>[0]) => {
      onProgress = input.onProgress;
      return completion.promise;
    });
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan(candidates),
        measure: async () => measurement(100),
        runBatch,
        requestStop,
      }),
    );
    await workflow.initialize();
    await workflow.startScan();
    workflow.setSelected(["one", "two", "three"], true);
    workflow.prepareCleanupBatch(["one", "two", "three"]);

    const running = workflow.runCleanupBatch();
    await Promise.resolve();
    expect(workflow.requestCleanupStop()).toEqual({
      kind: "succeeded",
      value: undefined,
    });
    expect(requestStop).toHaveBeenCalledWith("batch-1");
    expect(workflow.read().batch?.stopRequested).toBe(true);

    onProgress({
      phase: "advanced",
      candidateId: "one",
      outcome: { kind: "result", result: cleanupResult("one", 100) },
      completedCount: 1,
      cleanedBytes: 100,
    });
    completion.resolve({
      finish: "stopped",
      totalCount: 3,
      completedCount: 1,
      failedCount: 0,
      cleanedBytes: 100,
      historyId: "history-1",
      historyWarning: null,
    });

    await expect(running).resolves.toMatchObject({
      kind: "succeeded",
      value: {
        finish: "stopped",
        totalCount: 3,
        completedCount: 1,
      },
    });
    expect(workflow.read().batch?.candidates.map((candidate) => candidate.state.kind)).toEqual([
      "finished",
      "stopped",
      "stopped",
    ]);
    expect(
      workflow.read().scan.session?.candidates.map(({ candidateId, cleanability, selected }) => ({
        candidateId,
        cleanability,
        selected,
      })),
    ).toEqual([
      { candidateId: "one", cleanability: { kind: "requires-rescan" }, selected: false },
      { candidateId: "two", cleanability: { kind: "cleanable" }, selected: true },
      { candidateId: "three", cleanability: { kind: "cleanable" }, selected: true },
    ]);

    expect(workflow.closeCleanupBatch()).toEqual({ kind: "succeeded", value: undefined });
    expect(workflow.prepareCleanupBatch(["two", "three"])).toEqual({
      kind: "succeeded",
      value: { batchId: "batch-2" },
    });
  });

  it("opens the Scan Root and candidates using only opaque IDs", async () => {
    const openedRoots: string[] = [];
    const openedCandidates: Array<{
      scanId: string;
      candidateId: string;
      target: "Project" | "Directory";
    }> = [];
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan([pendingCandidate("candidate-1")]),
        measure: async () => measurement(100),
        openRoot: async (rootId) => {
          openedRoots.push(rootId);
        },
        openCandidate: async (input) => {
          openedCandidates.push(input);
        },
      }),
    );
    await workflow.initialize();
    await workflow.startScan();

    await expect(workflow.openRoot()).resolves.toEqual({
      kind: "succeeded",
      value: undefined,
    });
    await expect(workflow.openCandidate("candidate-1", "Directory")).resolves.toEqual({
      kind: "succeeded",
      value: undefined,
    });
    expect(openedRoots).toEqual(["root-1"]);
    expect(openedCandidates).toEqual([
      { scanId: "scan-1", candidateId: "candidate-1", target: "Directory" },
    ]);
  });

  it("updates scan depth and invalidates the old Scan Session when choosing a root", async () => {
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        chooseRoot: async () => settings("root-2", "/work", 9),
        updateDepth: async (_id, depth) => settings("root-1", "/code", depth),
        scan: async () => scan([pendingCandidate("candidate-1")]),
        measure: async () => measurement(100),
      }),
    );
    await workflow.initialize();
    await workflow.startScan();

    expect(await workflow.setMaxDepth(12.8)).toEqual({
      kind: "succeeded",
      value: { maxDepth: 12 },
    });
    await expect(workflow.chooseRoot()).resolves.toEqual({
      kind: "succeeded",
      value: { rootId: "root-2" },
    });
    expect(workflow.read()).toMatchObject({
      settings: {
        phase: "ready",
        rootId: "root-2",
        rootPath: "/work",
        maxDepth: 9,
      },
      scan: {
        phase: "idle",
        session: null,
      },
    });
  });

  it("records completed and stopped scans with their terminal measurement state", async () => {
    const completedDrafts: ProjectScanRecordDraft[] = [];
    const completed = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan(
          [pendingCandidate("candidate")],
          { total: 3, rust: 1, node: 2, maven: 0 },
        ),
        measure: async () => measurement(100),
        recordScanHistory: async (draft) => {
          completedDrafts.push(draft);
          return recordFromDraft(draft);
        },
      }),
    );
    await completed.initialize();
    await completed.startScan();

    expect(completedDrafts).toHaveLength(1);
    expect(completedDrafts[0]).toMatchObject({
      presetId: "preset-1",
      scanId: "scan-1",
      rootPath: "/code",
      maxDepth: 6,
      skipped: 0,
      measurement: "finished",
      projects: { total: 3, rust: 1, node: 2, maven: 0 },
      candidates: [{ kind: "NodeModules", directoryPath: "/code/candidate/node_modules" }],
    });
    expect(completed.read().history.byPreset["preset-1"]).toHaveLength(1);
    expect(completed.read().history.byPreset["preset-1"][0]).toMatchObject({
      measurement: "finished",
      candidates: { total: 1, nodeModules: 1 },
    });

    const stoppedDrafts: ProjectScanRecordDraft[] = [];
    const measuring = deferred<DirectoryMeasurement>();
    const stopped = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan(
          [pendingCandidate("candidate")],
          { total: 1, rust: 0, node: 1, maven: 0 },
        ),
        measure: async () => measuring.promise,
        recordScanHistory: async (draft) => {
          stoppedDrafts.push(draft);
          return recordFromDraft(draft);
        },
      }),
    );
    await stopped.initialize();
    const running = stopped.startScan();
    await waitFor(() => stopped.read().scan.phase === "measuring");
    stopped.requestScanStop();
    await waitFor(() => stoppedDrafts.length === 1);
    measuring.resolve(measurement(100));
    await running;
    await waitFor(() => stopped.read().history.byPreset["preset-1"]?.length === 1);
    expect(stoppedDrafts[0].measurement).toBe("stopped");
    expect(stopped.read().history.byPreset["preset-1"][0].measurement).toBe("stopped");
  });

  it("does not record failed or discovery-stage stopped scans", async () => {
    const failedDrafts: ProjectScanRecordDraft[] = [];
    const failed = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => { throw new Error("offline"); },
        recordScanHistory: async (draft) => {
          failedDrafts.push(draft);
          return recordFromDraft(draft);
        },
      }),
    );
    await failed.initialize();
    await failed.startScan();
    expect(failedDrafts).toHaveLength(0);
    expect(failed.read().history.recordWarning).toBeNull();

    const discovery = deferred<ProjectDataScan>();
    const stoppedDrafts: ProjectScanRecordDraft[] = [];
    const stopped = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => discovery.promise,
        recordScanHistory: async (draft) => {
          stoppedDrafts.push(draft);
          return recordFromDraft(draft);
        },
      }),
    );
    await stopped.initialize();
    const running = stopped.startScan();
    await waitFor(() => stopped.read().scan.phase === "discovering");
    stopped.requestScanStop();
    discovery.resolve(scan([]));
    await running;
    expect(stoppedDrafts).toHaveLength(0);
  });

  it("keeps the scan result when the history record cannot be saved", async () => {
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        scan: async () => scan([pendingCandidate("candidate")]),
        measure: async () => measurement(100),
        recordScanHistory: async () => { throw new Error("disk full"); },
      }),
    );
    await workflow.initialize();
    await expect(workflow.startScan()).resolves.toEqual({
      kind: "succeeded",
      value: { scanId: "scan-1", finish: "completed" },
    });
    expect(workflow.read().scan.phase).toBe("ready");
    expect(workflow.read().history.recordWarning).toContain("disk full");
    expect(workflow.read().history.byPreset["preset-1"]).toEqual([]);
  });

  it("loads persisted scan histories and keeps settings usable when history is unavailable", async () => {
    const persisted = recordFromDraft({
      presetId: "preset-1",
      scanId: "scan-1",
      rootPath: "/code",
      maxDepth: 6,
      finishedAt: 100,
      skipped: 0,
      measurement: "finished",
      projects: { total: 2, rust: 1, node: 1, maven: 0 },
      candidates: [],
    });
    const loaded = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        readScanHistory: async (presetIds) => ({
          histories: Object.fromEntries(
            presetIds.map((presetId) => [
              presetId,
              { records: presetId === "preset-1" ? [persisted] : [] },
            ]),
          ),
          warning: null,
        }),
      }),
    );
    await loaded.initialize();
    expect(loaded.read().history.phase).toBe("ready");
    expect(loaded.read().history.byPreset["preset-1"]).toHaveLength(1);
    expect(loaded.read().history.byPreset["preset-1"][0].id).toBe(persisted.id);

    const unavailable = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        readScanHistory: async () => { throw new Error("history offline"); },
      }),
    );
    await expect(unavailable.initialize()).resolves.toEqual({
      kind: "succeeded",
      value: undefined,
    });
    expect(unavailable.read().settings.phase).toBe("ready");
    expect(unavailable.read().history).toMatchObject({
      phase: "failed",
      warning: "history offline",
    });
  });

  it("tracks preset history entries when presets are added or removed", async () => {
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => settings(),
        readScanHistory: async (presetIds) => ({
          histories: Object.fromEntries(
            presetIds.map((presetId) => [presetId, { records: [] }]),
          ),
          warning: null,
        }),
        chooseRoot: async () => ({
          ...settings("root-2", "/work", 8),
          presets: [
            { id: "preset-1", path: "/code", maxDepth: 6 },
            { id: "preset-2", path: "/work", maxDepth: 8 },
          ],
          activePresetId: "preset-2",
        }),
        removePreset: async () => ({
          ...settings("root-1", "/code", 6),
          presets: [{ id: "preset-1", path: "/code", maxDepth: 6 }],
          activePresetId: null,
          rootId: null,
          rootPath: null,
        }),
      }),
    );
    await workflow.initialize();
    expect(workflow.read().history.byPreset["preset-1"]).toEqual([]);
    await workflow.chooseRoot();
    expect(workflow.read().history.byPreset["preset-2"]).toEqual([]);
    await workflow.removePreset("preset-2");
    expect(workflow.read().history.byPreset["preset-2"]).toBeUndefined();
    expect(workflow.read().history.byPreset["preset-1"]).toEqual([]);
  });
});
