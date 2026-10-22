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

function record(id: string, parentId: string | null = null): OpenCodeSessionRecord {
  return { id, parentId, title: id, parentTitle: parentId, archived: false, lastActivityMs: 1, workingDirectory: "/work" };
}

const initial: OpenCodeSessionScan = {
  status: "ready",
  message: null,
  activeSessionIds: [],
  activityMessage: null,
  records: [record("parent"), record("child", "parent"), record("failed"), record("unattempted")],
};

async function setup() {
  mockedInvoke.mockResolvedValueOnce(initial);
  const hook = renderHook(() => useOpenCodeSessions(false));
  await act(async () => { await hook.result.current.refresh(); });
  mockedInvoke.mockClear();
  return hook;
}

describe("OpenCode sessions adapter", () => {
  it("retains previous records when the scan is not ready or the read throws", async () => {
    const { result } = await setup();
    mockedInvoke.mockResolvedValueOnce({ ...initial, status: "unavailable", records: [], message: "service stopped" });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.scan?.status).toBe("unavailable");
    expect(result.current.scan?.records).toEqual(initial.records);
    expect(result.current.error).toBeNull();

    mockedInvoke.mockRejectedValueOnce(new Error("cannot read"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe("cannot read");
    expect(result.current.scan?.status).toBe("failed");
    expect(result.current.scan?.records).toEqual(initial.records);
  });

  it("submits the single deletion command and clears the confirmed cascade", async () => {
    const { result } = await setup();
    act(() => result.current.request("one", ["parent"]));
    mockedInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ...initial, records: initial.records.slice(2) });
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(mockedInvoke).toHaveBeenCalledWith("delete_opencode_session", { sessionId: "parent" });
    expect(result.current.outcome?.completedIds).toEqual(["parent", "child"]);
    expect(result.current.scan?.records.map(({ id }) => id)).toEqual(["failed", "unattempted"]);
    expect(result.current.outcome?.result?.items[0].status).toBe("deleted");
  });

  it("submits the selected deletion command and skips refresh after a preflight cancellation", async () => {
    const { result } = await setup();
    act(() => result.current.request("selected", ["parent", "child"]));
    mockedInvoke.mockResolvedValueOnce({ preflightError: "missing child", items: [] });
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("delete_opencode_sessions", { sessionIds: ["parent", "child"] });
    expect(result.current.outcome).toMatchObject({
      result: { preflightError: "missing child" },
      completedIds: [],
      refresh: { status: "notRequested" },
    });
    expect(result.current.operation).toBeNull();
  });

  it("submits the age deletion command and refreshes after a preflight rejection", async () => {
    const { result } = await setup();
    const nowMs = 50 * 24 * 60 * 60 * 1000;
    act(() => result.current.requestAge(30, nowMs));
    mockedInvoke.mockResolvedValueOnce({ preflightError: "changed", items: [] }).mockResolvedValueOnce(initial);
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(mockedInvoke).toHaveBeenCalledWith("delete_opencode_sessions_older_than", {
      sessionIds: ["parent", "failed", "unattempted"],
      cutoffMs: nowMs - 30 * 24 * 60 * 60 * 1000,
      expectedRecords: initial.records.map(({ id, parentId }) => ({ id, parentId })),
    });
    expect(result.current.outcome).toMatchObject({
      result: { preflightError: "changed" },
      completedIds: [],
      refresh: { status: "ready" },
    });
  });

  it("maps execution uncertainty to an error and refreshes", async () => {
    const { result } = await setup();
    act(() => result.current.request("one", ["parent"]));
    mockedInvoke.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(initial);
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.outcome).toMatchObject({
      error: "response lost",
      result: null,
      completedIds: [],
      refresh: { status: "ready" },
    });
    expect(mockedInvoke.mock.calls.map(([name]) => name)).toEqual(["delete_opencode_session", "scan_opencode_sessions"]);
  });

  it("does not form an age target without readable activity or after cancellation", async () => {
    const { result } = await setup();
    act(() => result.current.requestAge(7, 50 * 24 * 60 * 60 * 1000));
    const id = result.current.operation!.id;
    act(() => result.current.cancel(id));
    await act(async () => { await result.current.confirm(id); });
    expect(mockedInvoke).not.toHaveBeenCalled();

    mockedInvoke.mockResolvedValueOnce({ ...initial, activeSessionIds: null, activityMessage: "unreadable" });
    await act(async () => { await result.current.refresh(); });
    act(() => result.current.requestAge(7, 50 * 24 * 60 * 60 * 1000));
    expect(result.current.operation).toBeNull();
  });

  it("clears only confirmed roots and their cascade even when the follow-up read fails", async () => {
    const { result } = await setup();
    const partial = {
      preflightError: null,
      items: [
        { id: "parent", status: "deleted", message: null },
        { id: "failed", status: "failed", message: "conflict" },
        { id: "unattempted", status: "notAttempted", message: "stopped" },
      ],
    };
    act(() => result.current.request("selected", initial.records.map(({ id }) => id)));
    mockedInvoke.mockResolvedValueOnce(partial).mockResolvedValueOnce({
      status: "unavailable",
      records: [],
      message: "service stopped",
    });
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.outcome).toMatchObject({
      result: partial,
      completedIds: ["parent", "child"],
      refresh: { status: "failed", message: "service stopped" },
    });
    expect(result.current.scan?.records.map(({ id }) => id)).toEqual(["failed", "unattempted"]);
  });

  it("opens a session and returns the command error", async () => {
    const { result } = await setup();
    mockedInvoke.mockResolvedValueOnce(undefined);
    await expect(result.current.openSession("parent")).resolves.toBeNull();
    mockedInvoke.mockRejectedValueOnce(new Error("gone"));
    await expect(result.current.openSession("parent")).resolves.toBe("gone");
  });
});
