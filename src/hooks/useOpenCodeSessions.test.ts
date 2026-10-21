// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeSessionRecord, OpenCodeSessionScan } from "../sessionRecords";
import { useOpenCodeSessions } from "./useOpenCodeSessions";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function record(id: string, parentId: string | null = null): OpenCodeSessionRecord {
  return { id, parentId, title: id, parentTitle: parentId, archived: false, lastActivityMs: 1, workingDirectory: "/work" };
}
const initial: OpenCodeSessionScan = { status: "ready", message: null, records: [record("parent"), record("child", "parent"), record("failed"), record("unattempted")] };

async function setup() {
  mockedInvoke.mockResolvedValueOnce(initial);
  const hook = renderHook(() => useOpenCodeSessions(false));
  await act(async () => { await hook.result.current.refresh(); });
  mockedInvoke.mockClear();
  return hook;
}

describe("OpenCode Session Deletion", () => {
  it("cancels without deleting and keeps the reviewed cascade fixed across reads", async () => {
    const { result } = await setup();
    act(() => result.current.request("selected", ["parent", "child"]));
    const cancelled = result.current.operation!.id;
    act(() => result.current.cancel(cancelled));
    await act(async () => { await result.current.confirm(cancelled); });
    expect(mockedInvoke).not.toHaveBeenCalled();
    act(() => result.current.request("selected", ["parent", "child"]));
    mockedInvoke.mockResolvedValueOnce({ ...initial, records: [record("new")] });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.operation?.target.plan.selected.map(({ id }) => id)).toEqual(["parent", "child"]);
    expect(result.current.operation?.target.plan.roots.map(({ id }) => id)).toEqual(["parent"]);
    mockedInvoke.mockClear();
    mockedInvoke.mockResolvedValueOnce({ preflightError: "missing child", items: [] });
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("delete_opencode_sessions", { sessionIds: ["parent", "child"] });
    expect(result.current.outcome?.refresh.status).toBe("notRequested");
    expect(result.current.outcome?.completedIds).toEqual([]);
    expect(result.current.operation).toBeNull();
  });

  it("clears only confirmed roots and their cascade after partial execution, even if refreshing fails", async () => {
    const { result } = await setup();
    const partial = { preflightError: null, items: [
      { id: "parent", status: "deleted", message: null },
      { id: "failed", status: "failed", message: "conflict" },
      { id: "unattempted", status: "notAttempted", message: "stopped" },
    ] };
    mockedInvoke.mockResolvedValueOnce(partial).mockResolvedValueOnce({ status: "unavailable", records: [], message: "service stopped" });
    act(() => result.current.request("selected", initial.records.map(({ id }) => id)));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.outcome).toMatchObject({ result: partial, completedIds: ["parent", "child"], refresh: { status: "failed", message: "service stopped" } });
    expect(result.current.scan?.records.map(({ id }) => id)).toEqual(["failed", "unattempted"]);
    expect(result.current.operation).toBeNull();
  });

  it("holds the lock through execution and refresh, then retries only reading", async () => {
    const { result } = await setup();
    const deletion = deferred<void>();
    const reread = deferred<OpenCodeSessionScan>();
    mockedInvoke.mockReturnValueOnce(deletion.promise).mockReturnValueOnce(reread.promise);
    act(() => result.current.request("one", ["parent"]));
    const id = result.current.operation!.id;
    let completion!: Promise<void>;
    act(() => { completion = result.current.confirm(id); void result.current.confirm(id); result.current.cancel(id); });
    expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("delete_opencode_session", { sessionId: "parent" });
    await act(async () => { deletion.resolve(); });
    expect(result.current.operation?.phase).toBe("refreshing");
    expect(result.current.outcome?.result?.items[0].status).toBe("deleted");
    await act(async () => { await result.current.confirm(id); await result.current.refresh(); result.current.request("one", ["failed"]); });
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    await act(async () => { reread.reject(new Error("read failed")); await completion; });
    expect(result.current.outcome?.result?.items[0].status).toBe("deleted");
    expect(result.current.outcome?.refresh.status).toBe("failed");
    expect(result.current.operation).toBeNull();
    mockedInvoke.mockResolvedValueOnce({ ...initial, records: initial.records.slice(2) });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.outcome?.refresh.status).toBe("ready");
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual(["delete_opencode_session", "scan_opencode_sessions", "scan_opencode_sessions"]);
  });

  it.each(["one", "selected"] as const)("reconciles an uncertain %s result without claiming preflight cancellation or retrying deletion", async (kind) => {
    const { result } = await setup();
    mockedInvoke.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(initial);
    act(() => result.current.request(kind, ["parent"]));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.outcome).toMatchObject({ error: "response lost", result: null, completedIds: [], refresh: { status: "ready" } });
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual([kind === "one" ? "delete_opencode_session" : "delete_opencode_sessions", "scan_opencode_sessions"]);
  });

  it("ignores a read that predates the confirmed deletion", async () => {
    const { result } = await setup();
    const oldRead = deferred<OpenCodeSessionScan>();
    mockedInvoke.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ...initial, records: [] });
    let reading!: Promise<void>;
    act(() => { reading = result.current.refresh(); result.current.request("one", ["parent"]); });
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    await act(async () => { oldRead.resolve(initial); await reading; });
    expect(result.current.scan?.records).toEqual([]);
    expect(result.current.outcome?.refresh.status).toBe("ready");
  });
});
