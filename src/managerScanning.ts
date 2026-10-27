import type { CommandFailure, ScanDiagnostics } from "./types";

export interface ManagerScanState {
  phase: "queued" | "reading" | "enriching" | "idle";
  scannedAt: number | null;
  lastReadFailed?: boolean;
  error: string | null;
  diagnostics?: ScanDiagnostics;
  failures?: CommandFailure[];
}

const phaseLabels: Record<ManagerScanState["phase"], string | null> = {
  queued: "等待扫描",
  reading: "读取清单",
  enriching: "测量占用／加载补充信息",
  idle: null,
};

export function scanStateLabel(phase: ManagerScanState["phase"] | undefined) {
  return phase ? phaseLabels[phase] : null;
}
