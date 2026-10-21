// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecordScan, SessionSourceScan } from "../sessionRecords";
import { useSessionRecords } from "./useSessionRecords";

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

function source(title: string): SessionSourceScan {
  return { directory: "/sessions", status: "Ready", message: null, records: [
    { id: "record", title, lastActivityMs: 1, bytes: 10, inUse: false, workingDirectory: null },
  ] };
}

const initial: SessionRecordScan = { codex: source("initial"), claude: source("claude") };

describe("Session Record reading", () => {
  it.each(["older first", "newer first", "older fails"])("keeps the latest full scan after a source refresh: %s", async (order) => {
    const older = deferred<SessionSourceScan>();
    const newer = deferred<SessionRecordScan>();
    mockedInvoke.mockResolvedValueOnce(initial).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useSessionRecords(false));
    await act(async () => { await result.current.refresh(); });
    let olderRead!: Promise<unknown>;
    let newerRead!: Promise<unknown>;
    act(() => {
      olderRead = result.current.refresh("codex");
      newerRead = result.current.refresh();
    });
    if (order === "older first") {
      await act(async () => { older.resolve(source("old")); await olderRead; });
      expect(result.current.scanningSources.codex).toBe(true);
    }
    await act(async () => { newer.resolve({ ...initial, codex: source("new") }); await newerRead; });
    if (order !== "older first") {
      await act(async () => {
        if (order === "older fails") older.reject(new Error("stale failure"));
        else older.resolve(source("old"));
        await olderRead;
      });
    }
    expect(result.current.scan?.codex).toEqual(source("new"));
    expect(result.current.scanningSources).toEqual({ codex: false, claude: false });
  });

  it("shows a source read failure even before the first successful scan", async () => {
    mockedInvoke.mockRejectedValue(new Error("cannot read"));
    const { result } = renderHook(() => useSessionRecords(false));
    await act(async () => { await result.current.refresh("codex"); });
    expect(result.current.scan?.codex.status).toBe("Failed");
    expect(result.current.scan?.codex.message).toBe("cannot read");
  });
});

describe("Session Record Removal", () => {
  it("freezes the selected records, ignores cancelled confirmations and submits each confirmation once", async () => {
    mockedInvoke.mockResolvedValue(initial.codex);
    const { result } = renderHook(() => useSessionRecords(false));
    const records = initial.codex.records.map((record) => ({ ...record }));
    act(() => result.current.request({ kind: "selected", source: "codex", label: "Codex", records }));
    const cancelled = result.current.operation!.id;
    act(() => result.current.cancel(cancelled));
    await act(async () => { await result.current.confirm(cancelled); });
    expect(mockedInvoke).not.toHaveBeenCalled();

    act(() => result.current.request({ kind: "selected", source: "codex", label: "Codex", records }));
    const id = result.current.operation!.id;
    records[0].id = "changed";
    records[0].title = "changed";
    expect(result.current.operation!.target).toMatchObject({ records: [{ id: "record", title: "initial" }] });
    const removal = deferred<unknown>();
    mockedInvoke.mockReturnValueOnce(removal.promise);
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.confirm(id);
      void result.current.confirm(id);
      result.current.cancel(id);
      result.current.request({ kind: "one", source: "claude", id: "other", title: "Other" });
    });
    expect(result.current.operation?.phase).toBe("executing");
    expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("remove_session_records", { source: "codex", ids: ["record"] });
    await act(async () => {
      removal.resolve({ moved: 0, failed: 0, skipped: 1, items: [], operationError: null, message: null });
      await completion;
    });
    expect(result.current.operation).toBeNull();
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual(["remove_session_records", "scan_session_source"]);
  });

  it("keeps the removal result through a failed refresh and retries only the read", async () => {
    const moved = { moved: 1, failed: 0, skipped: 0, items: [{ id: "record", status: "Moved", reason: null, message: null }], operationError: null, message: null };
    const reread = deferred<SessionSourceScan>();
    mockedInvoke.mockResolvedValueOnce(initial).mockResolvedValueOnce(moved).mockReturnValueOnce(reread.promise);
    const { result, rerender } = renderHook(({ active }) => useSessionRecords(active), { initialProps: { active: false } });
    await act(async () => { await result.current.refresh(); });
    act(() => result.current.request({ kind: "one", source: "codex", id: "record", title: "Record" }));
    const id = result.current.operation!.id;
    let completion!: Promise<void>;
    await act(async () => { completion = result.current.confirm(id); });
    expect(result.current.outcome?.result).toEqual(moved);
    expect(result.current.scan?.codex.records).toEqual([]);
    expect(result.current.operation?.phase).toBe("refreshing");
    await act(async () => { await result.current.confirm(id); await result.current.refresh(); });
    rerender({ active: true });
    expect(mockedInvoke).toHaveBeenCalledTimes(3);
    await act(async () => { reread.reject(new Error("read failed")); await completion; });
    expect(result.current.operation).toBeNull();
    expect(result.current.outcome).toMatchObject({ result: moved, completedIds: ["record"], refresh: { status: "failed", message: "read failed" } });
    mockedInvoke.mockResolvedValueOnce({ ...initial.codex, records: [] });
    await act(async () => { await result.current.refresh("codex"); });
    expect(result.current.outcome?.refresh.status).toBe("ready");
    expect(result.current.outcome?.result).toEqual(moved);
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "remove_session_record")).toHaveLength(1);
  });

  it("invalidates reads already running when removal starts", async () => {
    const oldRead = deferred<SessionSourceScan>();
    const removal = deferred<unknown>();
    mockedInvoke.mockResolvedValueOnce(initial).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(removal.promise).mockResolvedValueOnce({ ...initial.codex, records: [] });
    const { result } = renderHook(() => useSessionRecords(false));
    await act(async () => { await result.current.refresh(); });
    let reading!: Promise<void>;
    act(() => { reading = result.current.refresh("codex"); result.current.request({ kind: "age", source: "codex", label: "Codex", days: 7, count: 1 }); });
    let completion!: Promise<void>;
    act(() => { completion = result.current.confirm(result.current.operation!.id); });
    await act(async () => { oldRead.resolve(source("stale")); await reading; });
    expect(result.current.scan?.codex.records[0].title).toBe("initial");
    await act(async () => {
      removal.resolve({ moved: 1, failed: 0, skipped: 0, items: [{ id: "record", status: "Moved" }], operationError: null, message: null });
      await completion;
    });
    expect(mockedInvoke).toHaveBeenCalledWith("remove_session_records_older_than", { source: "codex", days: 7 });
    expect(result.current.scan?.codex.records).toEqual([]);
  });

  it("preserves execution errors and reports incomplete reconciliation separately", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("cannot inspect open files")).mockResolvedValueOnce({ ...initial.codex, status: "Partial", message: "some records unreadable" });
    const { result } = renderHook(() => useSessionRecords(false));
    act(() => result.current.request({ kind: "one", source: "codex", id: "record", title: "Record" }));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.outcome).toMatchObject({
      result: { moved: 0, failed: 0, skipped: 0, operationError: "cannot inspect open files" },
      completedIds: [], refresh: { status: "failed", message: "some records unreadable" },
    });
  });
});
