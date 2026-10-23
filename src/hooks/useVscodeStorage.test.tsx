// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useVscodeStorage } from "./useVscodeStorage";
import type {
  VscodeStorageRemovalProgress,
  VscodeStorageRemovalResult,
  VscodeStorageScan,
  VscodeWorkspace,
} from "../vscodeStorage";

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
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function workspace(id: string, changes: Partial<VscodeWorkspace> = {}): VscodeWorkspace {
  return {
    id,
    name: id,
    projectPath: `/Users/test/${id}`,
    storagePath: `/Users/test/workspaceStorage/${id}`,
    kind: "Folder",
    projectStatus: "Missing",
    removable: true,
    removalBlockReason: null,
    message: null,
    usage: { bytes: 2048, complete: true, message: null },
    ...changes,
  };
}

const scan: VscodeStorageScan = {
  storagePath: "/Users/test/workspaceStorage",
  status: "Ready",
  workspaces: [
    workspace("available", {
      projectStatus: "Available",
      removable: false,
      removalBlockReason: "项目路径存在，保留工作区存储",
    }),
    workspace("missing"),
  ],
  message: null,
};

const removal: VscodeStorageRemovalResult = {
  historyId: "history-1",
  moved: 1,
  failed: 0,
  skipped: 0,
  items: [{ id: "missing", status: "Moved", reason: null, message: null }],
  operationError: null,
  message: null,
};

describe("useVscodeStorage", () => {
  it("scans once, checks the editor, and completes the removal lifecycle", async () => {
    let scanCalls = 0;
    let editorRunning = false;
    let finishRemoval!: (value: VscodeStorageRemovalResult) => void;
    const pendingRemoval = new Promise<VscodeStorageRemovalResult>((resolve) => {
      finishRemoval = resolve;
    });

    mockedInvoke.mockImplementation(async (command, args) => {
      switch (command) {
        case "scan_vscode_storage":
          scanCalls += 1;
          return scanCalls === 1
            ? scan
            : { ...scan, workspaces: scan.workspaces.filter((row) => row.id !== "missing") };
        case "get_vscode_editor_status":
          return editorRunning ? "Running" : "Stopped";
        case "remove_vscode_workspace_storage": {
          editorRunning = true;
          const params = args as {
            ids: string[];
            confirmedWorkspaces: { id: string; name: string; bytes: number | null; usageComplete: boolean }[];
            onProgress: { onmessage: (progress: VscodeStorageRemovalProgress) => void };
          };
          expect(params.ids).toEqual(["missing"]);
          expect(params.confirmedWorkspaces).toEqual([{
            id: "missing",
            name: "missing",
            projectPath: "/Users/test/missing",
            storagePath: "/Users/test/workspaceStorage/missing",
            kind: "Folder",
            projectStatus: "Missing",
            removable: true,
            removalBlockReason: null,
            bytes: 2048,
            usageComplete: true,
          }]);
          params.onProgress.onmessage({ phase: "preparing" });
          params.onProgress.onmessage({ phase: "started", total: 1 });
          params.onProgress.onmessage({
            phase: "advanced",
            processed: 1,
            total: 1,
            moved: 1,
            skipped: 0,
            failed: 0,
          });
          return pendingRemoval;
        }
        case "record_maintenance_followup":
          return null;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    });

    const { result, rerender } = renderHook(
      ({ active }) => useVscodeStorage(active),
      { initialProps: { active: true } },
    );

    await waitFor(() => expect(result.current.scan?.workspaces).toHaveLength(2));
    await waitFor(() => expect(result.current.editorStatus).toBe("Stopped"));
    expect(scanCalls).toBe(1);

    rerender({ active: false });
    rerender({ active: true });
    await waitFor(() => expect(result.current.editorStatus).toBe("Stopped"));
    expect(scanCalls).toBe(1);

    let opened = false;
    await act(async () => {
      opened = await result.current.request({ workspaces: [scan.workspaces[1]] });
    });
    expect(opened).toBe(true);
    expect(result.current.operation?.phase).toBe("confirming");
    expect(result.current.operation?.target.workspaces[0].id).toBe("missing");

    let confirmation: Promise<void> | null = null;
    act(() => {
      confirmation = result.current.confirm(result.current.operation!.id);
    });
    await waitFor(() =>
      expect(result.current.operation?.progress).toEqual({
        phase: "advanced",
        processed: 1,
        total: 1,
        moved: 1,
        skipped: 0,
        failed: 0,
      }),
    );

    await act(async () => {
      finishRemoval(removal);
      await confirmation!;
    });

    expect(result.current.outcome?.result).toEqual(removal);
    expect(result.current.outcome?.completedIds).toEqual(["missing"]);
    expect(mockedInvoke).toHaveBeenCalledWith("record_maintenance_followup", {
      id: "history-1",
      status: "ready",
      message: null,
    });
    expect(result.current.scan?.workspaces.map((row) => row.id)).toEqual(["available"]);
    expect(result.current.operation).toBeNull();
    expect(scanCalls).toBe(2);
    await waitFor(() => expect(result.current.editorStatus).toBe("Running"));
  });

  it("refuses to begin while VS Code is running", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "scan_vscode_storage") return scan;
      if (command === "get_vscode_editor_status") return "Running";
      throw new Error(`unexpected command: ${command}`);
    });

    const { result } = renderHook(() => useVscodeStorage(true));
    await waitFor(() => expect(result.current.editorStatus).toBe("Running"));

    let opened = true;
    await act(async () => {
      opened = await result.current.request({ workspaces: [scan.workspaces[1]] });
    });

    expect(opened).toBe(false);
    expect(result.current.operation).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "remove_vscode_workspace_storage",
      expect.anything(),
    );
  });

  it("retains the previous scan when a refresh fails", async () => {
    let fail = false;
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "get_vscode_editor_status") return "Stopped";
      if (command === "scan_vscode_storage") {
        if (fail) throw new Error("permission denied");
        return scan;
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { result } = renderHook(() => useVscodeStorage(true));
    await waitFor(() => expect(result.current.scan?.workspaces).toHaveLength(2));

    fail = true;
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.scan?.workspaces).toHaveLength(2);
    expect(result.current.error).toContain("permission denied");
  });
});
