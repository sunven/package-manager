// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useNativeInventory,
  type NativeInventoryAdapter,
} from "./useNativeInventory";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

type Scan = {
  snapshotId: string | null;
  directory: string;
  status: string;
  rows: string[];
  message: string | null;
};

const adapter: NativeInventoryAdapter<Scan> = {
  retain: (previous, next) => next.status === "Ready" || !previous || previous.directory !== next.directory
    ? next
    : { ...next, rows: previous.rows, snapshotId: null },
  revoke: (scan) => ({ ...scan, snapshotId: null, message: "revoked" }),
  invalidate: (scan, reason) => ({ ...scan, snapshotId: null, message: reason ?? "invalidated" }),
  ready: (scan) => scan.status === "Ready",
  message: (scan) => scan.message,
};

function scan(overrides: Partial<Scan> = {}): Scan {
  return { snapshotId: "snap-1", directory: "/inventory", status: "Ready", rows: ["a"], message: null, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function renderInventory(initial: { visible?: boolean; autoRead?: boolean } = {}) {
  return renderHook(
    (props: { visible: boolean; autoRead: boolean }) => useNativeInventory({
      command: "scan_test",
      adapter,
      ...props,
    }),
    { initialProps: { visible: true, autoRead: true, ...initial } },
  );
}

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("Native inventory", () => {
  it("reads an inventory and exposes a view without its snapshot", async () => {
    mockedInvoke.mockResolvedValueOnce(scan());
    const { result } = renderInventory();
    await waitFor(() => expect(result.current.scan?.snapshotId).toBe("snap-1"));
    expect(result.current.view).toMatchObject({
      current: true,
      scanning: false,
      error: null,
      scan: { directory: "/inventory", status: "Ready", rows: ["a"], message: null },
    });
    expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("scan_test");
  });

  it("retains previous rows and revokes writes when the next scan is not ready", async () => {
    mockedInvoke.mockResolvedValueOnce(scan());
    const { result } = renderInventory();
    await waitFor(() => expect(result.current.view.current).toBe(true));
    mockedInvoke.mockResolvedValueOnce(scan({ snapshotId: null, status: "Failed", rows: [], message: "not ready" }));
    await act(async () => { await result.current.read(); });
    expect(result.current.scan).toMatchObject({ snapshotId: null, rows: ["a"], status: "Failed" });
    expect(result.current.view).toMatchObject({ current: false, error: "not ready" });
  });

  it("retains previous rows and revokes writes when the read throws", async () => {
    mockedInvoke.mockResolvedValueOnce(scan());
    const { result } = renderInventory();
    await waitFor(() => expect(result.current.view.current).toBe(true));
    mockedInvoke.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await result.current.read(); });
    expect(result.current.scan).toMatchObject({ snapshotId: null, rows: ["a"], message: "revoked" });
    expect(result.current.view).toMatchObject({ current: false, error: "offline" });
  });

  it("applies invalidation and reports that a read is needed", async () => {
    mockedInvoke.mockResolvedValueOnce(scan());
    const view = renderInventory();
    await waitFor(() => expect(view.result.current.view.current).toBe(true));
    view.rerender({ visible: false, autoRead: false });
    act(() => view.result.current.invalidate("changed"));
    expect(view.result.current.scan).toMatchObject({ snapshotId: null, message: "changed" });
    expect(view.result.current.view.current).toBe(false);
    expect(view.result.current.needsRead()).toBe(true);
    mockedInvoke.mockResolvedValueOnce(scan({ snapshotId: "snap-2", rows: ["b"] }));
    await act(async () => { await view.result.current.read(); });
    expect(view.result.current.scan?.rows).toEqual(["b"]);
    expect(view.result.current.needsRead()).toBe(false);
  });

  it("drops a read that started before invalidation", async () => {
    mockedInvoke.mockResolvedValueOnce(scan());
    const { result } = renderInventory({ visible: false });
    await act(async () => { await result.current.read(); });
    const pending = deferred<Scan>();
    mockedInvoke.mockReturnValueOnce(pending.promise);
    let readPromise!: Promise<Scan | null>;
    act(() => { readPromise = result.current.read(); });
    act(() => result.current.invalidate("changed"));
    await act(async () => {
      pending.resolve(scan({ snapshotId: "snap-2", rows: ["new"] }));
      await readPromise;
    });
    expect(result.current.scan).toMatchObject({ snapshotId: null, rows: ["a"], message: "changed" });
  });

  it("waits for visibility before reading", async () => {
    mockedInvoke.mockResolvedValueOnce(scan());
    const view = renderInventory({ visible: false });
    await act(async () => { await Promise.resolve(); });
    expect(mockedInvoke).not.toHaveBeenCalled();
    view.rerender({ visible: true, autoRead: true });
    await waitFor(() => expect(view.result.current.scan?.snapshotId).toBe("snap-1"));
  });

  it("stores a result and clears the error independently", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderInventory();
    await waitFor(() => expect(result.current.view.error).toBe("offline"));
    act(() => result.current.setResult("saved"));
    expect(result.current.view.result).toBe("saved");
    act(() => result.current.clearError());
    expect(result.current.view.error).toBeNull();
  });
});
