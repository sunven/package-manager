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
