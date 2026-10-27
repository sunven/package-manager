// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenCodeDeletionPlan,
  OpenCodeDeletionResult,
  OpenCodeSessionRecord,
  OpenCodeSessionScan,
} from "../sessionRecords";
import { useOpenCodeSessions } from "./useOpenCodeSessions";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function record(id: string, parentId: string | null = null): OpenCodeSessionRecord {
  return { id, parentId, title: id, parentTitle: parentId, archived: false, lastActivityMs: 1, workingDirectory: "/work" };
}

const initial: OpenCodeSessionScan = {
  status: "ready",
  message: null,
  activeSessionIds: [],
  activityMessage: null,
  ageEligible: { days7: 3, days30: 2 },
  records: [record("parent"), record("child", "parent"), record("failed"), record("unattempted")],
};

function plan(overrides: Partial<OpenCodeDeletionPlan> = {}): OpenCodeDeletionPlan {
  const selected = overrides.selected ?? [initial.records[0]];
  const roots = overrides.roots ?? selected;
  const affected = overrides.affected ?? initial.records.slice(0, 2);
  return {
    planId: "plan-1",
    kind: "one",
    days: null,
    cutoffMs: null,
    selected,
    roots,
    affected,
    ...overrides,
  };
}

function result(overrides: Partial<OpenCodeDeletionResult> = {}): OpenCodeDeletionResult {
  return {
    preflightError: null,
    items: [{ id: "parent", status: "deleted", message: null }],
    completedIds: ["parent", "child"],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function setup(scan: OpenCodeSessionScan = initial) {
  mockedInvoke.mockResolvedValueOnce(scan);
  const hook = renderHook(() => useOpenCodeSessions(false));
  await act(async () => { await hook.result.current.refresh(); });
  mockedInvoke.mockClear();
  return hook;
}

describe("OpenCode sessions adapter", () => {
  it("prepares a single deletion, commits the plan once, and clears the confirmed cascade", async () => {
    const { result: view } = await setup();
    mockedInvoke.mockResolvedValueOnce(plan());
    await act(async () => { await view.current.request("one", ["parent"]); });
    expect(mockedInvoke).toHaveBeenCalledWith("prepare_opencode_deletion", {
      request: { kind: "one", sessionIds: ["parent"] },
    });
    expect(view.current.operation?.target.planId).toBe("plan-1");
    mockedInvoke.mockResolvedValueOnce(result())
      .mockResolvedValueOnce({ ...initial, records: initial.records.slice(2) })
      .mockResolvedValueOnce(null);
    await act(async () => { await view.current.confirm(view.current.operation!.id); });
    expect(mockedInvoke).toHaveBeenCalledWith("commit_opencode_deletion", { planId: "plan-1" });
    expect(view.current.outcome?.completedIds).toEqual(["parent", "child"]);
    expect(view.current.scan?.records.map(({ id }) => id)).toEqual(["failed", "unattempted"]);
    expect(view.current.operation).toBeNull();
  });

  it("writes a follow-up read for a saved permanent deletion", async () => {
    const { result: view } = await setup();
    mockedInvoke.mockResolvedValueOnce(plan());
    await act(async () => { await view.current.request("one", ["parent"]); });
    mockedInvoke.mockResolvedValueOnce({ ...result(), historyId: "history-1" })
      .mockResolvedValueOnce({ ...initial, records: initial.records.slice(2) })
      .mockResolvedValueOnce(null);
    await act(async () => { await view.current.confirm(view.current.operation!.id); });
    expect(mockedInvoke).toHaveBeenCalledWith("record_maintenance_followup", {
      id: "history-1",
      status: "ready",
      message: null,
    });
  });

  it("prepares a selected deletion and skips refresh after a preflight cancellation", async () => {
    const { result: view } = await setup();
    mockedInvoke.mockResolvedValueOnce(plan({ kind: "selected", selected: initial.records.slice(0, 2) }));
    await act(async () => { await view.current.request("selected", ["parent", "child"]); });
    mockedInvoke.mockResolvedValueOnce({
      historyId: "history-2",
      preflightError: "missing child",
      items: [],
      completedIds: [],
    }).mockResolvedValueOnce(null);
    await act(async () => { await view.current.confirm(view.current.operation!.id); });
    expect(mockedInvoke).toHaveBeenCalledWith("commit_opencode_deletion", { planId: "plan-1" });
    expect(view.current.outcome).toMatchObject({
      result: { preflightError: "missing child" },
      completedIds: [],
      refresh: { status: "notRequested" },
    });
    expect(mockedInvoke).toHaveBeenCalledWith("record_maintenance_followup", {
      id: "history-2",
      status: "notRequested",
      message: null,
    });
    expect(view.current.operation).toBeNull();
  });

  it("prepares age deletion with the backend cutoff and refreshes after a rejection", async () => {
    const { result: view } = await setup();
    mockedInvoke.mockResolvedValueOnce(plan({ kind: "age", days: 30, cutoffMs: 12345 }));
    await act(async () => { await view.current.requestAge(30); });
    expect(mockedInvoke).toHaveBeenCalledWith("prepare_opencode_deletion", {
      request: { kind: "age", days: 30 },
    });
    mockedInvoke.mockResolvedValueOnce({
      preflightError: "changed",
      items: [],
      completedIds: [],
    }).mockResolvedValueOnce(initial);
    await act(async () => { await view.current.confirm(view.current.operation!.id); });
    expect(view.current.outcome).toMatchObject({
      result: { preflightError: "changed" },
      completedIds: [],
      refresh: { status: "ready" },
    });
  });

  it("maps execution uncertainty to an error and refreshes", async () => {
    const { result: view } = await setup();
    mockedInvoke.mockResolvedValueOnce(plan());
    await act(async () => { await view.current.request("one", ["parent"]); });
    mockedInvoke.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(initial);
    await act(async () => { await view.current.confirm(view.current.operation!.id); });
    expect(view.current.outcome).toMatchObject({
      error: "response lost",
      result: null,
      completedIds: [],
      refresh: { status: "ready" },
    });
    expect(mockedInvoke.mock.calls.map(([name]) => name)).toEqual([
      "prepare_opencode_deletion",
      "commit_opencode_deletion",
      "scan_opencode_sessions",
    ]);
  });

  it("shows a prepare error without opening a dialog", async () => {
    const { result: view } = await setup();
    mockedInvoke.mockRejectedValueOnce(new Error("没有符合 30 天条件的 OpenCode 会话。"));
    await act(async () => { await view.current.requestAge(30); });
    expect(view.current.prepareError).toBe("没有符合 30 天条件的 OpenCode 会话。");
    expect(view.current.operation).toBeNull();
    expect(mockedInvoke.mock.calls.map(([name]) => name)).toEqual(["prepare_opencode_deletion"]);
  });

  it("exposes preparing while the backend plan is pending", async () => {
    const { result: view } = await setup();
    const pending = deferred<OpenCodeDeletionPlan>();
    mockedInvoke.mockReturnValueOnce(pending.promise);
    let request!: Promise<void>;
    act(() => { request = view.current.requestAge(30); });
    expect(view.current.preparing).toBe(true);
    await act(async () => {
      pending.resolve(plan({ kind: "age", days: 30, cutoffMs: 12345 }));
      await request;
    });
    expect(view.current.preparing).toBe(false);
    expect(view.current.operation?.target.planId).toBe("plan-1");
  });

  it("does not prepare age deletion without readable activity or after cancellation", async () => {
    const { result: view } = await setup({ ...initial, activeSessionIds: null, activityMessage: "unreadable" });
    await act(async () => { await view.current.requestAge(7); });
    expect(view.current.operation).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();

    mockedInvoke.mockResolvedValueOnce(plan());
    await act(async () => { await view.current.request("one", ["parent"]); });
    const id = view.current.operation!.id;
    act(() => view.current.cancel(id));
    await act(async () => { await view.current.confirm(id); });
    expect(mockedInvoke).not.toHaveBeenCalledWith("commit_opencode_deletion", expect.anything());
    expect(view.current.operation).toBeNull();
  });

  it("keeps only the backend's completed ids after partial execution", async () => {
    const { result: view } = await setup();
    mockedInvoke.mockResolvedValueOnce(plan({ kind: "selected", selected: initial.records.slice(0, 2) }));
    await act(async () => { await view.current.request("selected", ["parent", "child"]); });
    mockedInvoke.mockResolvedValueOnce({
      preflightError: null,
      items: [
        { id: "parent", status: "deleted", message: null },
        { id: "failed", status: "failed", message: "conflict" },
        { id: "unattempted", status: "notAttempted", message: "stopped" },
      ],
      completedIds: ["parent", "child"],
    }).mockResolvedValueOnce({
      status: "unavailable",
      records: [],
      message: "service stopped",
      ageEligible: { days7: 0, days30: 0 },
    });
    await act(async () => { await view.current.confirm(view.current.operation!.id); });
    expect(view.current.outcome).toMatchObject({
      completedIds: ["parent", "child"],
      refresh: { status: "failed", message: "service stopped" },
    });
    expect(view.current.scan?.records.map(({ id }) => id)).toEqual(["failed", "unattempted"]);
    expect(view.current.scan?.ageEligible).toEqual({ days7: 3, days30: 2 });
  });

  it("opens a session and returns the command error", async () => {
    const { result: view } = await setup();
    mockedInvoke.mockResolvedValueOnce(undefined);
    await expect(view.current.openSession("parent")).resolves.toBeNull();
    mockedInvoke.mockRejectedValueOnce(new Error("gone"));
    await expect(view.current.openSession("parent")).resolves.toBe("gone");
  });
});
