import { describe, expect, it } from "vitest";
import {
  completedVscodeRemovalIds,
  removeVscodeWorkspaces,
  selectedVscodeRemovalConfirmText,
  summarizeVscodeRemoval,
  vscodeEditorBlocked,
  vscodeRemovalProgressDetail,
  vscodeRemovalProgressPercent,
  vscodeRemovalProgressText,
  vscodeRemovalProgressValue,
  vscodeRemovalReasonLabels,
  vscodeRemovalResultText,
} from "./vscodeRemoval";
import type {
  VscodeStorageRemovalProgress,
  VscodeStorageRemovalResult,
  VscodeStorageScan,
  VscodeWorkspace,
} from "./vscodeStorage";

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

function scan(workspaces: VscodeWorkspace[]): VscodeStorageScan {
  return {
    storagePath: "/Users/test/workspaceStorage",
    status: "Ready",
    workspaces,
    message: null,
  };
}

function removalResult(changes: Partial<VscodeStorageRemovalResult> = {}): VscodeStorageRemovalResult {
  return {
    moved: 0,
    failed: 0,
    skipped: 0,
    items: [],
    operationError: null,
    message: null,
    ...changes,
  };
}

describe("VS Code removal helpers", () => {
  it("describes each progress phase", () => {
    const preparing: VscodeStorageRemovalProgress = { phase: "preparing" };
    expect(vscodeRemovalProgressText(preparing)).toBe("正在检查可移除记录…");
    expect(vscodeRemovalProgressDetail(preparing)).toBeNull();
    expect(vscodeRemovalProgressValue(preparing)).toBe(0);
    expect(vscodeRemovalProgressPercent(preparing)).toBe(0);

    const started: VscodeStorageRemovalProgress = { phase: "started", total: 3 };
    expect(vscodeRemovalProgressText(started)).toBe("正在移入废纸篓 0/3");
    expect(vscodeRemovalProgressDetail(started)).toBeNull();
    expect(vscodeRemovalProgressValue(started)).toBe(0);

    const advanced: VscodeStorageRemovalProgress = {
      phase: "advanced",
      processed: 2,
      total: 3,
      moved: 1,
      skipped: 1,
      failed: 0,
    };
    expect(vscodeRemovalProgressText(advanced)).toBe("正在移入废纸篓 2/3");
    expect(vscodeRemovalProgressDetail(advanced)).toBe("已移入 1 · 跳过 1 · 失败 0");
    expect(vscodeRemovalProgressValue(advanced)).toBe(2);
    expect(vscodeRemovalProgressPercent(advanced)).toBeCloseTo(66.67, 1);
    expect(vscodeRemovalProgressPercent({ ...advanced, total: 0, processed: 0 })).toBe(0);
  });

  it("summarizes results and confirmation copy", () => {
    expect(vscodeRemovalResultText(removalResult({ moved: 2, skipped: 1, failed: 1 }))).toBe(
      "移入废纸篓 2 条，跳过 1 条，失败 1 条",
    );
    expect(vscodeRemovalResultText(removalResult({ operationError: "VS Code 正在运行" }))).toBe(
      "移除未能执行",
    );
    expect(selectedVscodeRemovalConfirmText(3)).toContain("3 条");
    expect(vscodeRemovalReasonLabels.ProjectAvailable).toContain("项目路径已恢复");
    expect(Object.keys(vscodeRemovalReasonLabels).sort()).toEqual([
      "EditorStarted",
      "NoLongerRecord",
      "NotRegularDirectory",
      "ProjectAvailable",
      "ProjectRemote",
      "ProjectUnavailable",
      "TargetUnreadable",
      "TrashFailed",
    ]);
  });

  it("totals only measured workspaces and flags incomplete selections", () => {
    expect(summarizeVscodeRemoval([])).toEqual({ bytes: null, complete: true });
    expect(summarizeVscodeRemoval([
      workspace("first"),
      workspace("second", { usage: { bytes: 4096, complete: true, message: null } }),
    ])).toEqual({ bytes: 6144, complete: true });
    expect(summarizeVscodeRemoval([
      workspace("first"),
      workspace("partial", { usage: { bytes: 1024, complete: false, message: "denied" } }),
    ])).toEqual({ bytes: 3072, complete: false });
    expect(summarizeVscodeRemoval([
      workspace("known"),
      workspace("unreadable", { usage: { bytes: null, complete: false, message: "denied" } }),
    ])).toEqual({ bytes: 2048, complete: false });
    expect(summarizeVscodeRemoval([
      workspace("unreadable", { usage: { bytes: null, complete: false, message: "denied" } }),
    ])).toEqual({ bytes: null, complete: false });
  });

  it("keeps only moved ids and prunes completed records without mutating the scan", () => {
    const result = removalResult({
      items: [
        { id: "moved", status: "Moved", reason: null, message: null },
        { id: "skipped", status: "Skipped", reason: "ProjectAvailable", message: null },
        { id: "failed", status: "Failed", reason: "TrashFailed", message: "denied" },
      ],
    });
    expect(completedVscodeRemovalIds(result)).toEqual(["moved"]);

    const snapshot = scan([workspace("first"), workspace("second"), workspace("third")]);
    const next = removeVscodeWorkspaces(snapshot, ["second", "missing"]);
    expect(next.workspaces.map((row) => row.id)).toEqual(["first", "third"]);
    expect(snapshot.workspaces.map((row) => row.id)).toEqual(["first", "second", "third"]);
  });

  it("blocks removal unless the editor is confirmed stopped", () => {
    expect(vscodeEditorBlocked("Stopped")).toBe(false);
    expect(vscodeEditorBlocked("Running")).toBe(true);
    expect(vscodeEditorBlocked("Unknown")).toBe(true);
    expect(vscodeEditorBlocked(null)).toBe(true);
  });
});
