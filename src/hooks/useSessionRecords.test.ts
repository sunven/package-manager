// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SessionRecord,
  SessionRecordScan,
  SessionRemovalProgress,
  SessionRemovalResult,
  SessionSourceScan,
} from "../sessionRecords";
import { useSessionRecords } from "./useSessionRecords";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class<T> {
    onmessage: (message: T) => void;
    constructor(onmessage: (message: T) => void = () => {}) {
      this.onmessage = onmessage;
    }
  },
}));
const mockedInvoke = vi.mocked(invoke);
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function record(id: string): SessionRecord {
  return { id, title: id, lastActivityMs: 1, bytes: 10, inUse: false, workingDirectory: null };
}

function source(title: string, overrides: Partial<SessionSourceScan> = {}): SessionSourceScan {
  return { directory: "/sessions", status: "Ready", message: null, records: [record(title)], ...overrides };
}

const initial: SessionRecordScan = { codex: source("initial"), claude: source("claude") };
const removal: SessionRemovalResult = {
  moved: 1,
  failed: 0,
  skipped: 0,
  items: [{ id: "record", status: "Moved", reason: null, message: null }],
  operationError: null,
  message: null,
};

describe("Session records adapter", () => {
  it("reads one source and maps its failure without a global error", async () => {
    mockedInvoke.mockResolvedValueOnce(source("codex-new"));
    const { result } = renderHook(() => useSessionRecords(false));
    await act(async () => { await result.current.refresh("codex"); });
    expect(mockedInvoke).toHaveBeenCalledWith("scan_session_source", { source: "codex" });
    expect(result.current.scan?.codex.records[0].title).toBe("codex-new");
    expect(result.current.scan?.claude.status).toBe("Missing");
    expect(result.current.error).toBeNull();

    mockedInvoke.mockRejectedValueOnce(new Error("cannot read"));
    await act(async () => { await result.current.refresh("claude"); });
    expect(result.current.scan?.claude).toMatchObject({ status: "Failed", message: "cannot read" });
    expect(result.current.error).toBeNull();
  });

  it("retains previous records for a failed source and surfaces a global failure", async () => {
    mockedInvoke.mockResolvedValueOnce(initial);
    const { result } = renderHook(() => useSessionRecords(false));
    await act(async () => { await result.current.refresh(); });
    mockedInvoke.mockResolvedValueOnce({
      codex: source("ignored", { status: "Failed", records: [], message: "source failed" }),
      claude: source("claude-new"),
    });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.scan?.codex).toMatchObject({ status: "Failed", message: "source failed" });
    expect(result.current.scan?.codex.records[0].title).toBe("initial");
    expect(result.current.scan?.claude.records[0].title).toBe("claude-new");
    expect(result.current.error).toBeNull();

    mockedInvoke.mockRejectedValueOnce(new Error("full failure"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe("full failure");
    expect(result.current.scan?.codex).toMatchObject({ status: "Failed", message: "full failure" });
    expect(result.current.scan?.codex.records[0].title).toBe("initial");
  });

  const removals: { target: Parameters<ReturnType<typeof useSessionRecords>["request"]>[0]; command: string; args: unknown }[] = [
    {
      target: { kind: "one", source: "codex", id: "record", title: "Record" },
      command: "remove_session_record",
      args: { source: "codex", id: "record" },
    },
    {
      target: { kind: "age", source: "codex", label: "Codex", days: 7, count: 1 },
      command: "remove_session_records_older_than",
      args: { source: "codex", days: 7, onProgress: expect.anything() },
    },
    {
      target: { kind: "selected", source: "codex", label: "Codex", records: [record("record")] },
      command: "remove_session_records",
      args: { source: "codex", ids: ["record"], onProgress: expect.anything() },
    },
  ];

  it.each(removals)("submits $command with the frozen policy payload", async ({ target, command, args }) => {
    mockedInvoke.mockImplementation(async (name) => {
      if (name === command) return removal;
      if (name === "scan_session_source") return { ...source("after"), records: [] };
      throw new Error(`Unexpected command ${name}`);
    });
    const { result } = renderHook(() => useSessionRecords(false));
    act(() => result.current.request(target));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(mockedInvoke).toHaveBeenCalledWith(command, args);
    expect(mockedInvoke.mock.calls.filter(([name]) => name === command)).toHaveLength(1);
    expect(result.current.outcome?.result).toEqual(removal);
    expect(result.current.outcome?.completedIds).toEqual(["record"]);
    expect(result.current.outcome?.refresh.status).toBe("ready");
    expect(result.current.operation).toBeNull();
  });

  it("removes only confirmed Moved records from the target source", async () => {
    mockedInvoke.mockResolvedValueOnce(initial);
    const { result } = renderHook(() => useSessionRecords(false));
    await act(async () => { await result.current.refresh(); });
    mockedInvoke.mockResolvedValueOnce(removal).mockResolvedValueOnce({ ...source("after"), records: [] });
    act(() => result.current.request({ kind: "one", source: "codex", id: "record", title: "Record" }));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.scan?.codex.records).toEqual([]);
    expect(result.current.scan?.claude.records[0].title).toBe("claude");
    expect(result.current.outcome?.completedIds).toEqual(["record"]);
    expect(mockedInvoke).toHaveBeenCalledWith("scan_session_source", { source: "codex" });
  });

  it("forwards batch progress from the channel into the operation", async () => {
    let finish!: (value: SessionRemovalResult) => void;
    let report!: (progress: SessionRemovalProgress) => void;
    mockedInvoke.mockImplementation((name, args) => {
      if (name === "remove_session_records_older_than") {
        report = (args as { onProgress: { onmessage: typeof report } }).onProgress.onmessage;
        return new Promise<SessionRemovalResult>((resolve) => { finish = resolve; });
      }
      if (name === "scan_session_source") return Promise.resolve({ ...source("after"), records: [] });
      throw new Error(`Unexpected command ${name}`);
    });
    const { result } = renderHook(() => useSessionRecords(false));
    act(() => result.current.request({ kind: "age", source: "codex", label: "Codex", days: 7, count: 2 }));
    let completion!: Promise<void>;
    act(() => { completion = result.current.confirm(result.current.operation!.id); });
    act(() => report({ phase: "preparing" }));
    expect(result.current.operation?.progress).toEqual({ phase: "preparing" });
    act(() => report({ phase: "started", total: 2 }));
    act(() => report({ phase: "advanced", processed: 1, total: 2, moved: 1, skipped: 0, failed: 0 }));
    expect(result.current.operation).toMatchObject({
      phase: "executing",
      progress: { phase: "advanced", processed: 1, total: 2, moved: 1 },
    });
    await act(async () => {
      finish(removal);
      await completion;
    });
    expect(result.current.operation).toBeNull();
  });

  it("maps a failed execution to an aborted result and failed reconciliation", async () => {
    mockedInvoke.mockImplementation(async (name) => {
      if (name === "remove_session_record") throw new Error("cannot inspect open files");
      if (name === "scan_session_source") {
        return { ...source("after"), status: "Partial", message: "some records unreadable" };
      }
      throw new Error(`Unexpected command ${name}`);
    });
    const { result } = renderHook(() => useSessionRecords(false));
    act(() => result.current.request({ kind: "one", source: "codex", id: "record", title: "Record" }));
    await act(async () => { await result.current.confirm(result.current.operation!.id); });
    expect(result.current.outcome).toMatchObject({
      result: {
        moved: 0,
        failed: 0,
        skipped: 0,
        items: [],
        operationError: "cannot inspect open files",
        message: null,
      },
      completedIds: [],
      refresh: { status: "failed", message: "some records unreadable" },
    });
  });
});
