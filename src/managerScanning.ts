import type { CommandFailure, ManagerSnapshot, ScanDiagnostics } from "./types";

export interface ManagerScanState {
  phase: "queued" | "reading" | "enriching" | "idle";
  scannedAt: number | null;
  lastReadFailed?: boolean;
  error: string | null;
  diagnostics?: ScanDiagnostics;
  failures?: CommandFailure[];
}

export function scanStateLabel(state: ManagerScanState | undefined, manager?: ManagerSnapshot) {
  if (state?.phase === "queued") return "等待扫描";
  if (state?.phase === "reading") return "读取清单";
  if (state?.phase === "enriching") return "测量占用／加载补充信息";
  if (state?.lastReadFailed) return "最近扫描失败";
  if (state?.error) return "扫描完成，部分信息未读取";
  return manager ? "扫描已结束" : "未扫描";
}

export function scanProblems(manager: ManagerSnapshot) {
  const messages = manager.failures.map((failure) => failure.message);
  if (manager.status === "Failed") messages.push("管理器扫描失败");
  if (manager.homebrew?.cleanup.status === "Failed") messages.push(manager.homebrew.cleanup.message ?? "Homebrew 清理预演失败");
  if (manager.pip?.outdatedStatus === "Failed") messages.push(manager.pip.outdatedMessage ?? "pip 更新检查失败");
  for (const path of manager.paths) {
    if (["Error", "PermissionDenied"].includes(path.size.status) || path.size.skipped > 0) {
      messages.push(`${path.label}：${path.size.message ?? "目录读取不完整"}`);
    }
  }
  return [...new Set(messages)].join("；") || null;
}
