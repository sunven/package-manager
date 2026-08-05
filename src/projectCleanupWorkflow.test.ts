import { describe, expect, it } from "vitest";
import {
  createProjectCleanupWorkflow,
} from "./projectCleanupWorkflow";
import { createInMemoryProjectCleanupEffects as effects } from "./projectCleanupInMemoryEffects";
import type {
  DirectoryMeasurement,
  ProjectDataCandidate,
  ProjectDataScan,
} from "./types";

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

function scan(candidates: ProjectDataCandidate[]): ProjectDataScan {
  return {
    rootId: "root-1",
    scanId: "scan-1",
    rootPath: "/code",
    maxDepth: 6,
    status: "Ready",
    candidates,
    skipped: 0,
    errors: [],
    cargoAvailable: true,
    cargoMessage: null,
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

describe("Project Cleanup workflow", () => {
  it("initializes persisted Scan Root settings through its interface", async () => {
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => ({
          rootId: "root-1",
          rootPath: "/code",
          maxDepth: 6,
        }),
      }),
    );

    expect(workflow.read().settings).toEqual({
      phase: "loading",
      rootId: null,
      rootPath: null,
      maxDepth: 8,
      failure: null,
    });

    await expect(workflow.initialize()).resolves.toEqual({
      kind: "succeeded",
      value: undefined,
    });
    expect(workflow.read().settings).toEqual({
      phase: "ready",
      rootId: "root-1",
      rootPath: "/code",
      maxDepth: 6,
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
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
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
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
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
      pendingCandidate("unknown", "NodeModules", "Unrecognized"),
      pendingCandidate("partial"),
    ];
    const gates = new Map(candidates.map((item) => [
      item.candidateId,
      deferred<DirectoryMeasurement>(),
    ]));
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
        scan: async () => ({ ...scan(candidates), cargoAvailable: false }),
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
      { kind: "blocked", reason: "identity-not-verified" },
      { kind: "blocked", reason: "directory-footprint-incomplete" },
    ]);
  });

  it("keeps a Scan Session when one candidate measurement fails", async () => {
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
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
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
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
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
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
  });

  it("runs a Cleanup Batch sequentially and continues after invocation failure", async () => {
    const candidates = ["one", "two", "three"].map((id) => pendingCandidate(id));
    const cleanupGates = new Map(candidates.map((candidate) => [
      candidate.candidateId,
      deferred<import("./types").ProjectCleanupResult>(),
    ]));
    const cleanupCalls: string[] = [];
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
        scan: async () => scan(candidates),
        measure: async ({ candidateId }) =>
          measurement({ one: 100, two: 200, three: 300 }[candidateId]!),
        clean: async ({ candidateId }) => {
          cleanupCalls.push(candidateId);
          return cleanupGates.get(candidateId)!.promise;
        },
      }),
    );
    await workflow.initialize();
    await workflow.startScan();
    workflow.setSelected(["one", "two", "three"], true);
    workflow.prepareCleanupBatch(["three", "one", "two"]);

    const running = workflow.runCleanupBatch();
    expect(cleanupCalls).toEqual(["three"]);
    expect(
      workflow.read().scan.session?.candidates.find(({ candidateId }) => candidateId === "three"),
    ).toMatchObject({
      selected: false,
      cleanability: { kind: "requires-rescan" },
    });

    cleanupGates.get("three")!.resolve(cleanupResult("three", 300));
    await waitFor(() => cleanupCalls.length === 2);
    expect(cleanupCalls).toEqual(["three", "one"]);
    cleanupGates.get("one")!.reject(new Error("IPC disconnected"));
    await waitFor(() => cleanupCalls.length === 3);
    expect(cleanupCalls).toEqual(["three", "one", "two"]);
    cleanupGates.get("two")!.resolve(cleanupResult("two", 50, "Failed"));

    await expect(running).resolves.toEqual({
      kind: "succeeded",
      value: {
        finish: "completed",
        totalCount: 3,
        completedCount: 3,
        failedCount: 2,
        cleanedBytes: 350,
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

  it("stops after the active candidate and keeps unstarted candidates eligible", async () => {
    const candidates = ["one", "two", "three"].map((id) => pendingCandidate(id));
    const firstCleanup = deferred<import("./types").ProjectCleanupResult>();
    const cleanupCalls: string[] = [];
    const workflow = createProjectCleanupWorkflow(
      effects({
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
        scan: async () => scan(candidates),
        measure: async () => measurement(100),
        clean: async ({ candidateId }) => {
          cleanupCalls.push(candidateId);
          return firstCleanup.promise;
        },
      }),
    );
    await workflow.initialize();
    await workflow.startScan();
    workflow.setSelected(["one", "two", "three"], true);
    workflow.prepareCleanupBatch(["one", "two", "three"]);

    const running = workflow.runCleanupBatch();
    expect(cleanupCalls).toEqual(["one"]);
    expect(workflow.requestCleanupStop()).toEqual({
      kind: "succeeded",
      value: undefined,
    });
    firstCleanup.resolve(cleanupResult("one", 100));

    await expect(running).resolves.toMatchObject({
      kind: "succeeded",
      value: {
        finish: "stopped",
        totalCount: 3,
        completedCount: 1,
      },
    });
    expect(cleanupCalls).toEqual(["one"]);
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
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
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
        readSettings: async () => ({ rootId: "root-1", rootPath: "/code", maxDepth: 6 }),
        chooseRoot: async () => ({ rootId: "root-2", rootPath: "/work", maxDepth: 9 }),
        scan: async () => scan([pendingCandidate("candidate-1")]),
        measure: async () => measurement(100),
      }),
    );
    await workflow.initialize();
    await workflow.startScan();

    expect(workflow.setMaxDepth(12.8)).toEqual({
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
});
