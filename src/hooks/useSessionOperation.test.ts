// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  useSessionOperation,
  type SessionOperationAdapter,
  type SessionOperationOptions,
  type SessionRead,
} from "./useSessionOperation";

type Source = "a" | "b";
type TestScan = { directory: string; rows: string[] };
type TestTarget = { source: Source; id: string; note?: string };
type TestResult = { completed: string[] };
type TestProgress = { processed: number };

const SCOPES = ["a", "b"] as const;

let readImpl: (scopes: readonly Source[], previous: Partial<Record<Source, TestScan>>) => Promise<SessionRead<Source, TestScan>>;
let executeImpl: (target: TestTarget) => Promise<TestResult>;
let shouldRefreshImpl: (target: TestTarget, result: TestResult | null) => boolean;
let readCalls: (readonly Source[])[];
let executeCalls: TestTarget[];
let progressReporter: ((progress: TestProgress) => void) | null;
let observeCalls: { source: Source; scan: TestScan | null; failure: string | null; at: number; readFailed: boolean }[];

const adapter: SessionOperationAdapter<Source, TestScan, TestTarget, TestResult, TestProgress> = {
  observe: (source, scan, failure, at, readFailed) => {
    observeCalls.push({ source, scan, failure, at, readFailed });
  },
  read: (scopes, previous) => {
    readCalls.push(scopes);
    return readImpl(scopes, previous);
  },
  scopesFor: (target) => [target.source],
  execute: (target, report) => {
    executeCalls.push(target);
    progressReporter = report;
    return executeImpl(target);
  },
  completedIds: (_target, result) => result.completed,
  removeCompleted: (scans, target, completedIds) => {
    const scan = scans[target.source];
    return scan
      ? { ...scans, [target.source]: { ...scan, rows: scan.rows.filter((row) => !completedIds.includes(row)) } }
      : scans;
  },
  shouldRefresh: (target, result) => shouldRefreshImpl(target, result),
};

function scan(rows: string[]): TestScan {
  return { directory: "/sessions", rows };
}

function readResult(
  scopes: readonly Source[],
  rows: string[] = ["initial"],
  failures: Partial<Record<Source, string>> = {},
  globalError: string | null = null,
): SessionRead<Source, TestScan> {
  return {
    scans: Object.fromEntries(scopes.map((source) => [source, scan(rows)])) as Partial<Record<Source, TestScan>>,
    failures,
    globalError,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function renderOperation(initial: Partial<SessionOperationOptions<Source>> = {}) {
  return renderHook(
    (options: SessionOperationOptions<Source>) => useSessionOperation(adapter, options),
    { initialProps: { active: true, scopes: SCOPES, ...initial } },
  );
}

async function ready(result: ReturnType<typeof renderOperation>["result"]) {
  await waitFor(() => expect(result.current.scans.a?.rows).toEqual(["initial"]));
}

beforeEach(() => {
  readCalls = [];
  executeCalls = [];
  observeCalls = [];
  progressReporter = null;
  readImpl = async (scopes) => readResult(scopes);
  executeImpl = async () => ({ completed: [] });
  shouldRefreshImpl = () => true;
});

afterEach(cleanup);

describe("Session operation lifecycle", () => {
  it("reports accepted reads and thrown read failures with the previous scan", async () => {
    const { result } = renderOperation();
    await ready(result);
    expect(observeCalls).toContainEqual(expect.objectContaining({ source: "a", failure: null, readFailed: false }));
    observeCalls = [];
    readImpl = async () => { throw new Error("offline"); };
    await act(async () => { await result.current.refresh(["a"]); });
    expect(observeCalls).toContainEqual(expect.objectContaining({
      source: "a",
      failure: "offline",
      readFailed: true,
      scan: expect.objectContaining({ rows: ["initial"] }),
    }));
  });

  it("lets the newest ticket win per source while overlapping reads finish", async () => {
    const full = deferred<SessionRead<Source, TestScan>>();
    const single = deferred<SessionRead<Source, TestScan>>();
    readImpl = (scopes) => scopes.length === 2 ? full.promise : single.promise;
    const { result } = renderOperation();
    await waitFor(() => expect(readCalls).toHaveLength(1));
    let singleRead!: Promise<void>;
    act(() => { singleRead = result.current.refresh(["a"]); });
    expect(result.current.scanning).toEqual({ a: true, b: true });
    await act(async () => {
      single.resolve(readResult(["a"], ["a-new"]));
      await singleRead;
    });
    expect(result.current.scans.a?.rows).toEqual(["a-new"]);
    expect(result.current.scanning).toEqual({ a: false, b: true });
    await act(async () => {
      full.resolve(readResult(["a", "b"], ["a-old"]));
      await Promise.resolve();
    });
    expect(result.current.scans.a?.rows).toEqual(["a-new"]);
    expect(result.current.scans.b?.rows).toEqual(["a-old"]);
    expect(result.current.scanning).toEqual({ a: false, b: false });
  });

  it("freezes the target, allows one operation, and ignores cancelled confirmations", async () => {
    const { result } = renderOperation();
    await ready(result);
    const target: TestTarget = { source: "a", id: "one", note: "before" };
    act(() => result.current.begin(target));
    target.note = "after";
    expect(result.current.operation?.target).toEqual({ source: "a", id: "one", note: "before" });
    const id = result.current.operation!.id;
    act(() => result.current.begin({ source: "b", id: "two" }));
    expect(result.current.operation?.id).toBe(id);
    act(() => result.current.cancel(id));
    await act(async () => { await result.current.confirm(id); });
    expect(result.current.operation).toBeNull();
    expect(executeCalls).toHaveLength(0);
  });

  it("submits once, locks through execution and refresh, and stores the result first", async () => {
    const execution = deferred<TestResult>();
    const refresh = deferred<SessionRead<Source, TestScan>>();
    readImpl = (scopes) => scopes.length === 2 ? Promise.resolve(readResult(scopes)) : refresh.promise;
    executeImpl = () => execution.promise;
    const { result } = renderOperation();
    await ready(result);
    act(() => result.current.begin({ source: "a", id: "one" }));
    const id = result.current.operation!.id;
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.confirm(id);
      void result.current.confirm(id);
    });
    expect(executeCalls).toHaveLength(1);
    expect(result.current.operation?.phase).toBe("executing");
    act(() => result.current.cancel(id));
    await act(async () => { await result.current.refresh(["a"]); });
    expect(readCalls).toHaveLength(1);
    await act(async () => {
      execution.resolve({ completed: ["initial"] });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.operation?.phase).toBe("refreshing"));
    expect(result.current.outcome).toMatchObject({
      result: { completed: ["initial"] },
      completedIds: ["initial"],
      refresh: { status: "refreshing" },
    });
    expect(result.current.scans.a?.rows).toEqual([]);
    await act(async () => {
      refresh.resolve(readResult(["a"], []));
      await completion;
    });
    expect(result.current.operation).toBeNull();
    expect(result.current.outcome?.refresh.status).toBe("ready");
    expect(executeCalls).toHaveLength(1);
  });

  it("publishes progress while executing and ignores reports after execution ends", async () => {
    const execution = deferred<TestResult>();
    executeImpl = () => execution.promise;
    const { result } = renderOperation();
    await ready(result);
    act(() => result.current.begin({ source: "a", id: "one" }));
    let completion!: Promise<void>;
    act(() => { completion = result.current.confirm(result.current.operation!.id); });
    expect(result.current.operation).toMatchObject({ phase: "executing", progress: null });
    act(() => progressReporter?.({ processed: 1 }));
    expect(result.current.operation).toMatchObject({ phase: "executing", progress: { processed: 1 } });
    await act(async () => {
      execution.resolve({ completed: [] });
      await completion;
    });
    act(() => progressReporter?.({ processed: 2 }));
    expect(result.current.operation).toBeNull();
    expect(result.current.outcome?.result).toEqual({ completed: [] });
  });

  it("maps an execution error and still refreshes the target source", async () => {
    executeImpl = async () => { throw new Error("failed"); };
    const { result } = renderOperation();
    await ready(result);
    act(() => result.current.begin({ source: "a", id: "one" }));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.outcome).toMatchObject({
      result: null,
      error: "failed",
      completedIds: [],
      refresh: { status: "ready" },
    });
    expect(readCalls).toHaveLength(2);
  });

  it("keeps the result when the follow-up read fails, and retries only the read", async () => {
    let reads = 0;
    readImpl = async (scopes) => {
      reads += 1;
      if (reads === 1) return readResult(scopes);
      if (reads === 2) return readResult(["a"], ["after"], { a: "read failed" });
      return readResult(["a"], ["retried"]);
    };
    const { result } = renderOperation();
    await ready(result);
    act(() => result.current.begin({ source: "a", id: "one" }));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.outcome).toMatchObject({
      result: { completed: [] },
      refresh: { status: "failed", message: "read failed" },
    });
    expect(result.current.scans.a?.rows).toEqual(["after"]);
    await act(async () => { await result.current.refresh(["a"]); });
    expect(result.current.outcome).toMatchObject({
      result: { completed: [] },
      refresh: { status: "ready" },
    });
    expect(result.current.scans.a?.rows).toEqual(["retried"]);
    expect(executeCalls).toHaveLength(1);
  });

  it("skips the follow-up read when the adapter says the result needs none", async () => {
    shouldRefreshImpl = () => false;
    const { result } = renderOperation();
    await ready(result);
    act(() => result.current.begin({ source: "a", id: "one" }));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(readCalls).toHaveLength(1);
    expect(result.current.outcome?.refresh.status).toBe("notRequested");
    expect(result.current.operation).toBeNull();
  });

  it("reads the configured scopes when activated", async () => {
    const view = renderOperation({ active: false });
    await act(async () => { await Promise.resolve(); });
    expect(readCalls).toHaveLength(0);
    view.rerender({ active: true, scopes: SCOPES });
    await waitFor(() => expect(view.result.current.scans.a?.rows).toEqual(["initial"]));
    expect(readCalls).toHaveLength(1);
  });

  it("applies a global read error only when all requested sources are still current", async () => {
    const full = deferred<SessionRead<Source, TestScan>>();
    const single = deferred<SessionRead<Source, TestScan>>();
    readImpl = (scopes) => scopes.length === 2 ? full.promise : single.promise;
    const { result } = renderOperation();
    await waitFor(() => expect(readCalls).toHaveLength(1));
    let singleRead!: Promise<void>;
    act(() => { singleRead = result.current.refresh(["a"]); });
    await act(async () => {
      full.resolve(readResult(["b"], ["b"], {}, "full failed"));
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.scans.b?.rows).toEqual(["b"]);
    await act(async () => {
      single.resolve(readResult(["a"], ["a"], {}, "single failed"));
      await singleRead;
    });
    expect(result.current.error).toBe("single failed");
  });

  it("updates outcome refresh only for the operation's target source", async () => {
    readImpl = async (scopes) => {
      if (scopes.length === 2) return readResult(scopes);
      if (scopes[0] === "a") return readResult(["a"], ["a-after"], { a: "a failed" });
      return readResult(["b"], ["b-after"]);
    };
    const { result } = renderOperation();
    await ready(result);
    act(() => result.current.begin({ source: "a", id: "one" }));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.outcome?.refresh).toEqual({ status: "failed", message: "a failed" });
    await act(async () => { await result.current.refresh(["b"]); });
    expect(result.current.outcome?.refresh).toEqual({ status: "failed", message: "a failed" });
    expect(result.current.scans.b?.rows).toEqual(["b-after"]);
  });
});
