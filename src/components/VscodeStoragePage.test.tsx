import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  filterVscodeWorkspaces,
  summarizeVscodeStorage,
  type VscodeEditorStatus,
  type VscodeStorageScan,
  type VscodeWorkspace,
} from "../vscodeStorage";
import type { VscodeStorageWorkflow } from "../hooks/useVscodeStorage";
import { VscodeStoragePage } from "./VscodeStoragePage";

function workspace(id: string, changes: Partial<VscodeWorkspace> = {}): VscodeWorkspace {
  return {
    id,
    name: "project",
    projectPath: "/Users/test/project",
    storagePath: `/Users/test/Library/Application Support/Code/User/workspaceStorage/${id}`,
    kind: "Folder",
    projectStatus: "Available",
    removable: false,
    removalBlockReason: null,
    message: null,
    usage: { bytes: 2048, complete: true, message: null },
    ...changes,
  };
}

function scan(workspaces: VscodeWorkspace[], status: VscodeStorageScan["status"] = "Ready"): VscodeStorageScan {
  return { storagePath: "/Users/test/Library/Application Support/Code/User/workspaceStorage", status, workspaces, message: null };
}

function workflow(
  snapshot: VscodeStorageScan | null,
  error: string | null = null,
  scanning = false,
  editorStatus: VscodeEditorStatus = "Stopped",
): VscodeStorageWorkflow {
  return {
    scan: snapshot,
    scanning,
    error,
    refresh: async () => {},
    operation: null,
    outcome: null,
    editorStatus,
    checkingEditor: false,
    request: async () => false,
    confirm: async () => {},
    cancel: () => {},
  };
}

function render(
  snapshot: VscodeStorageScan | null,
  error: string | null = null,
  scanning = false,
  editorStatus: VscodeEditorStatus = "Stopped",
) {
  return renderToStaticMarkup(
    <VscodeStoragePage workflow={workflow(snapshot, error, scanning, editorStatus)} homeDirectory="/Users/test" />,
  );
}

describe("VS Code workspace storage", () => {
  it("keeps duplicate project rows and includes missing and unknown projects in the total", () => {
    const snapshot = scan([
      workspace("first"),
      workspace("second", { usage: { bytes: 4096, complete: true, message: null } }),
      workspace("removed", { name: "removed", projectStatus: "Missing", removable: true }),
      workspace("unknown", { name: "unknown", projectPath: null, kind: "Unknown", projectStatus: "Unknown", removable: true }),
    ]);
    expect(summarizeVscodeStorage(snapshot)).toEqual({ bytes: 10240, complete: true, missingCount: 1, unknownCount: 1 });
    const html = render(snapshot);
    expect(html).toContain("10.0 KB");
    expect(html).toContain("first");
    expect(html).toContain("second");
    expect(html).toContain("路径不存在");
    expect(html).toContain("未识别工作区");
    expect(html).toContain("~/project");
    expect(html).toContain("可移除");
    expect(html).toContain('role="checkbox"');
    expect(html).toContain("全选可移除");
    expect(html).toContain("移除 0 项");
  });

  it("searches names, locations and storage IDs and sorts measured sizes first without changing the scan", () => {
    const rows = [
      workspace("first", { name: "Alpha" }),
      workspace("second", { projectPath: "/Users/test/中文项目", usage: { bytes: 8192, complete: true, message: null } }),
      workspace("last", { projectPath: null, usage: { bytes: null, complete: false, message: "unreadable" } }),
    ];
    expect(filterVscodeWorkspaces(rows, "").map((row) => row.id)).toEqual(["second", "first", "last"]);
    expect(filterVscodeWorkspaces(rows, " ALPHA ").map((row) => row.id)).toEqual(["first"]);
    expect(filterVscodeWorkspaces(rows, "中文项目").map((row) => row.id)).toEqual(["second"]);
    expect(filterVscodeWorkspaces(rows, "workspacestorage/last").map((row) => row.id)).toEqual(["last"]);
    expect(filterVscodeWorkspaces(rows, "not present")).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual(["first", "second", "last"]);
  });

  it("shows partial totals as lower bounds and never presents unknown sizes as zero", () => {
    const snapshot = scan([
      workspace("known"),
      workspace("partial", { usage: { bytes: 1024, complete: false, message: "permission denied" } }),
      workspace("unreadable", { usage: { bytes: null, complete: false, message: "permission denied" } }),
    ], "Partial");
    expect(summarizeVscodeStorage(snapshot)).toEqual({ bytes: 3072, complete: false, missingCount: 0, unknownCount: 0 });
    const html = render(snapshot);
    expect(html).toContain("≥ 3.0 KB");
    expect(html).toContain("≥ 1.0 KB");
    expect(html).toContain("占用统计不完整");
    expect(html).toContain("无法测量");
    const unknown = scan([workspace("unknown", { usage: { bytes: null, complete: false, message: "denied" } })], "Partial");
    expect(summarizeVscodeStorage(unknown).bytes).toBeNull();
    expect(render(unknown)).not.toContain(">0 B<");
  });

  it("distinguishes missing storage, an empty scan, an inaccessible root, and loading", () => {
    expect(render(scan([], "Missing"))).toContain("未发现 VS Code 工作区存储目录");
    expect(render(scan([]))).toContain("没有工作区存储记录");
    expect(render(null, "permission denied")).toContain("扫描未完成，请刷新重试");
    expect(render(null, null, true)).toContain("正在加载工作区");
    expect(render(null, null, true)).not.toContain("没有工作区存储记录");
    expect(summarizeVscodeStorage(scan([], "Partial")).bytes).toBeNull();
  });

  it("retains previous rows while refreshing and when refresh fails", () => {
    const snapshot = scan([workspace("previous")]);
    const refreshing = render(snapshot, null, true);
    expect(refreshing).toContain("previous");
    expect(refreshing).toContain("暂时显示上次结果");
    expect(refreshing).toContain("disabled");
    const failed = render(snapshot, "permission denied");
    expect(failed).toContain("previous");
    expect(failed).toContain("下方保留上次扫描结果");
  });

  it("disables non-removable rows and exposes the reason", () => {
    const snapshot = scan([
      workspace("available", { name: "available", removalBlockReason: "项目路径存在，保留工作区存储" }),
      workspace("symlink", {
        name: "symlink",
        kind: "Unknown",
        projectStatus: "Unknown",
        removable: false,
        removalBlockReason: "不是普通存储目录，未跟随符号链接",
      }),
      workspace("missing", { name: "missing", projectStatus: "Missing", removable: true }),
    ]);
    const html = render(snapshot);
    expect(html).toContain("项目路径存在，保留工作区存储");
    expect(html).toContain("不是普通存储目录，未跟随符号链接");
    expect(html).toContain("选择 missing");
    expect((html.match(/role="checkbox"/g) ?? [])).toHaveLength(3);
  });

  it("warns and disables removal while VS Code is running or unknown", () => {
    const snapshot = scan([workspace("missing", { removable: true })]);
    const running = render(snapshot, null, false, "Running");
    expect(running).toContain("VS Code 正在运行");
    expect(running).toContain("退出 VS Code 后才能移入废纸篓");
    expect(running).toContain("disabled");

    const unknown = render(snapshot, null, false, "Unknown");
    expect(unknown).toContain("无法确认 VS Code 是否运行");
  });
});
