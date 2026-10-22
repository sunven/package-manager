// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useVscodeStorage } from "../hooks/useVscodeStorage";
import type {
  VscodeEditorStatus,
  VscodeStorageRemovalProgress,
  VscodeStorageRemovalResult,
  VscodeStorageScan,
  VscodeWorkspace,
} from "../vscodeStorage";
import { VscodeStoragePage } from "./VscodeStoragePage";

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

const baseScan: VscodeStorageScan = {
  storagePath: "/Users/test/workspaceStorage",
  status: "Ready",
  workspaces: [
    workspace("available", {
      projectStatus: "Available",
      removable: false,
      removalBlockReason: "项目路径存在，保留工作区存储",
    }),
    workspace("missing"),
    workspace("unknown", {
      kind: "Unknown",
      projectPath: null,
      projectStatus: "Unknown",
    }),
  ],
  message: null,
};

function movedResult(ids: string[]): VscodeStorageRemovalResult {
  return {
    moved: ids.length,
    failed: 0,
    skipped: 0,
    items: ids.map((id) => ({ id, status: "Moved", reason: null, message: null })),
    operationError: null,
    message: null,
  };
}

type SetupOptions = {
  result?: VscodeStorageRemovalResult;
};

async function setup(options: SetupOptions = {}) {
  let scanValue = baseScan;
  let editorStatus: VscodeEditorStatus = "Stopped";
  let refreshError: string | null = null;
  const result = options.result ?? movedResult(["missing"]);
  let finishRemoval!: (value: VscodeStorageRemovalResult) => void;
  const pendingRemoval = new Promise<VscodeStorageRemovalResult>((resolve) => {
    finishRemoval = resolve;
  });

  mockedInvoke.mockImplementation(async (command, args) => {
    switch (command) {
      case "scan_vscode_storage":
        if (refreshError) throw new Error(refreshError);
        return scanValue;
      case "get_vscode_editor_status":
        return editorStatus;
      case "remove_vscode_workspace_storage": {
        const params = args as {
          ids: string[];
          onProgress: { onmessage: (progress: VscodeStorageRemovalProgress) => void };
        };
        const movedIds = new Set(
          result.items.filter((item) => item.status === "Moved").map((item) => item.id),
        );
        scanValue = {
          ...scanValue,
          workspaces: scanValue.workspaces.filter((row) => !movedIds.has(row.id)),
        };
        params.onProgress.onmessage({ phase: "preparing" });
        params.onProgress.onmessage({ phase: "started", total: params.ids.length });
        params.onProgress.onmessage({
          phase: "advanced",
          processed: params.ids.length,
          total: params.ids.length,
          moved: result.moved,
          skipped: result.skipped,
          failed: result.failed,
        });
        return pendingRemoval;
      }
      default:
        throw new Error(`unexpected command: ${command}`);
    }
  });

  let workflow!: ReturnType<typeof useVscodeStorage>;
  function Harness() {
    workflow = useVscodeStorage(true);
    return <VscodeStoragePage workflow={workflow} homeDirectory="/Users/test" />;
  }

  render(<Harness />);
  await waitFor(() => expect(workflow.scan).not.toBeNull());
  await waitFor(() => expect(workflow.editorStatus).not.toBeNull());
  vi.clearAllMocks();

  return {
    finish: () => finishRemoval(result),
    failRefresh: () => {
      refreshError = "refresh failed";
    },
    setEditorStatus: (status: VscodeEditorStatus) => {
      editorStatus = status;
    },
  };
}

describe("VS Code workspace storage removal", () => {
  it("selects only removable rows and prunes hidden selections when searching", async () => {
    await setup();

    const available = screen.getByRole("checkbox", { name: /available 不可移除/ });
    expect((available as HTMLButtonElement).disabled).toBe(true);
    expect(available.getAttribute("aria-label")).toContain("项目路径存在");

    fireEvent.click(screen.getByRole("checkbox", { name: /选择 missing/ }));
    expect(screen.getByRole("button", { name: "移除 1 项" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "全选可移除" }));
    expect(screen.getByRole("button", { name: "移除 2 项" })).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索工作区" }), {
      target: { value: "unknown" },
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "移除 1 项" })).toBeTruthy());
    expect(screen.queryByRole("checkbox", { name: /选择 missing/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /选择 unknown/ })).toBeTruthy();
  });

  it("confirms, streams progress, and reports the removal result", async () => {
    const result = movedResult(["missing", "unknown"]);
    const control = await setup({ result });

    fireEvent.click(screen.getByRole("button", { name: "全选可移除" }));
    fireEvent.click(screen.getByRole("button", { name: "移除 2 项" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/将把 2 条工作区存储记录移入废纸篓/)).toBeTruthy();
    expect(within(dialog).getByText(/合计 4\.0 KB/)).toBeTruthy();
    expect(within(dialog).getByText(/可能是外接磁盘未挂载/)).toBeTruthy();
    expect(within(dialog).getByText(/可能仍包含扩展数据/)).toBeTruthy();
    expect(within(dialog).getByText(/清空废纸篓前可恢复/)).toBeTruthy();

    const list = within(dialog).getByRole("list", { name: "待移入废纸篓的工作区存储记录" });
    expect(list.children).toHaveLength(2);
    expect(within(list).getByText("路径不存在")).toBeTruthy();
    expect(within(list).getByText("未识别工作区")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "移入废纸篓 2 项" }));
    await waitFor(() => expect(within(dialog).getByText(/正在移入废纸篓 2\/2/)).toBeTruthy());
    expect(within(dialog).getByRole("progressbar", { name: "工作区存储移除进度" }).getAttribute("aria-valuenow")).toBe("2");
    expect(within(dialog).getByText("已移入 2 · 跳过 0 · 失败 0")).toBeTruthy();

    await act(async () => {
      control.finish();
    });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(await screen.findByText("VS Code 工作区存储移除结果")).toBeTruthy();
    expect(screen.getByText("移入废纸篓 2 条，跳过 0 条，失败 0 条")).toBeTruthy();
    expect(screen.getByText("查看逐项结果")).toBeTruthy();
    expect(screen.getByText(/missing：已移入废纸篓/)).toBeTruthy();
    expect(screen.getByText(/unknown：已移入废纸篓/)).toBeTruthy();

    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /选择 missing/ })).toBeNull());
    expect(screen.queryByRole("checkbox", { name: /选择 unknown/ })).toBeNull();
  });

  it("rechecks VS Code before opening the confirmation", async () => {
    const control = await setup();

    fireEvent.click(screen.getByRole("checkbox", { name: /选择 missing/ }));
    control.setEditorStatus("Running");
    fireEvent.click(screen.getByRole("button", { name: "移除 1 项" }));

    expect(await screen.findByText("VS Code 正在运行")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((screen.getByRole("button", { name: "移除 1 项" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("cancels without removing and restores focus to the trigger", async () => {
    await setup();

    fireEvent.click(screen.getByRole("checkbox", { name: /选择 missing/ }));
    const trigger = screen.getByRole("button", { name: "移除 1 项" });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "remove_vscode_workspace_storage",
      expect.anything(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("shows skipped reasons and reports a refresh failure separately", async () => {
    const result: VscodeStorageRemovalResult = {
      moved: 0,
      failed: 0,
      skipped: 1,
      items: [{
        id: "missing",
        status: "Skipped",
        reason: "ProjectAvailable",
        message: "项目路径已恢复，留在原处",
      }],
      operationError: null,
      message: null,
    };
    const control = await setup({ result });

    fireEvent.click(screen.getByRole("checkbox", { name: /选择 missing/ }));
    fireEvent.click(screen.getByRole("button", { name: "移除 1 项" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "移入废纸篓 1 项" }));
    await waitFor(() => expect(within(dialog).getByText(/正在移入废纸篓 1\/1/)).toBeTruthy());

    await act(async () => {
      control.failRefresh();
      control.finish();
    });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(await screen.findByText("VS Code 工作区存储移除结果")).toBeTruthy();
    expect(screen.getByText("移入废纸篓 0 条，跳过 1 条，失败 0 条")).toBeTruthy();
    expect(screen.getAllByText(/项目路径已恢复/).length).toBeGreaterThan(0);
    expect(screen.getByText(/列表刷新失败/)).toBeTruthy();
    expect(screen.getByText(/执行结果已保留/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /选择 missing/ })).toBeTruthy();
  });
});
