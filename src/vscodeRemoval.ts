import type {
  VscodeEditorStatus,
  VscodeStorageRemovalProgress,
  VscodeStorageRemovalReason,
  VscodeStorageRemovalResult,
  VscodeStorageScan,
  VscodeWorkspace,
} from "./vscodeStorage";

export function vscodeRemovalProgressText(progress: VscodeStorageRemovalProgress) {
  if (progress.phase === "preparing") return "正在检查可移除记录…";
  if (progress.phase === "started") return `正在移入废纸篓 0/${progress.total}`;
  return `正在移入废纸篓 ${progress.processed}/${progress.total}`;
}

export function vscodeRemovalProgressDetail(progress: VscodeStorageRemovalProgress) {
  return progress.phase === "advanced"
    ? `已移入 ${progress.moved} · 跳过 ${progress.skipped} · 失败 ${progress.failed}`
    : null;
}

export function vscodeRemovalProgressValue(progress: VscodeStorageRemovalProgress) {
  return progress.phase === "advanced" ? progress.processed : 0;
}

export function vscodeRemovalProgressPercent(progress: VscodeStorageRemovalProgress) {
  if (progress.phase !== "advanced" || progress.total === 0) return 0;
  return (progress.processed / progress.total) * 100;
}

export function vscodeRemovalResultText(
  result: Pick<VscodeStorageRemovalResult, "moved" | "failed" | "skipped" | "operationError">,
) {
  if (result.operationError) return "移除未能执行";
  return `移入废纸篓 ${result.moved} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条`;
}

export const vscodeRemovalReasonLabels: Record<VscodeStorageRemovalReason, string> = {
  NoLongerRecord: "记录已不存在或已不可移除",
  ProjectAvailable: "项目路径已恢复，留在原处",
  ProjectRemote: "记录已变成远程工作区",
  ProjectUnavailable: "无法确认项目路径状态",
  NotRegularDirectory: "不是普通存储目录",
  TargetUnreadable: "无法读取存储目录",
  EditorStarted: "VS Code 已启动，未处理",
  TrashFailed: "移入废纸篓失败",
};

export function selectedVscodeRemovalConfirmText(count: number) {
  return `将把 ${count} 条工作区存储记录移入废纸篓。`;
}

export function summarizeVscodeRemoval(workspaces: readonly VscodeWorkspace[]) {
  const measured = workspaces.filter((workspace) => workspace.usage.bytes !== null);
  return {
    bytes: measured.length
      ? measured.reduce((total, workspace) => total + (workspace.usage.bytes ?? 0), 0)
      : null,
    complete: workspaces.every((workspace) => workspace.usage.complete),
  };
}

export function completedVscodeRemovalIds(result: VscodeStorageRemovalResult) {
  return result.items
    .filter((item) => item.status === "Moved")
    .map((item) => item.id);
}

export function removeVscodeWorkspaces(scan: VscodeStorageScan, ids: readonly string[]) {
  const removed = new Set(ids);
  return {
    ...scan,
    workspaces: scan.workspaces.filter((workspace) => !removed.has(workspace.id)),
  };
}

export function vscodeEditorBlocked(status: VscodeEditorStatus | null) {
  return status !== "Stopped";
}
