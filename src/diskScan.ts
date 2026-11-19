import type { ObservationFacts } from "./observationFacts";

export interface DiskScanSummary {
  scanId: string;
  revision: number;
  rootPath: string;
  phase: "running" | "completed" | "partial" | "stopped" | "limited";
  startedAt: number;
  finishedAt: number | null;
  elapsedMs: number;
  entries: number;
  bytes: number | null;
  errors: number;
  excluded: number;
  message: string | null;
  warning: string | null;
}

export interface DiskScanEntry {
  id: number;
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "mount" | "special" | "unknown";
  bytes: number | null;
  status: "pending" | "scanning" | "complete" | "partial" | "excluded";
  message: string | null;
}

export interface DiskScanDirectory {
  scanId: string;
  directory: DiskScanEntry;
  ancestors: DiskScanEntry[];
  entries: DiskScanEntry[];
  total: number;
}

export interface DiskScanSettings { lastPath: string | null; warning: string | null }

export interface DiskScanView {
  loaded: boolean;
  draftPath: string;
  lastPath: string | null;
  summary: DiskScanSummary | null;
  directoryId: number;
  limit: number;
  page: DiskScanDirectory | null;
  starting: boolean;
  stopping: boolean;
  picking: boolean;
  loading: boolean;
  error: string | null;
  failure: string | null;
  warning: string | null;
}

export function diskScanObservationFacts(view: DiskScanView): ObservationFacts {
  const summary = view.summary;
  const scope = summary?.rootPath ?? view.lastPath;
  return {
    phase: summary?.phase === "running" ? "reading" : "idle",
    success: summary?.finishedAt ? {
      at: summary.finishedAt,
      scope: `disk:${summary.rootPath}`,
      scopeLabel: summary.rootPath,
      completeness: summary.phase === "completed" ? "complete" : "partial",
      note: summary.message,
    } : null,
    failure: view.failure ? { outcome: "failed", reason: view.failure } : null,
    invalidated: null,
    currentScope: scope ? { key: `disk:${scope}`, label: scope } : null,
  };
}

export const diskScanPhaseLabels: Record<DiskScanSummary["phase"], string> = {
  running: "扫描中", completed: "扫描完成", partial: "部分读取", stopped: "已停止", limited: "达到条目上限",
};
export const diskScanKindLabels: Record<DiskScanEntry["kind"], string> = {
  directory: "目录", file: "文件", symlink: "符号链接", mount: "其他磁盘", special: "特殊条目", unknown: "未知类型",
};
export const diskScanStatusLabels: Record<DiskScanEntry["status"], string> = {
  pending: "等待扫描", scanning: "统计中", complete: "已读取", partial: "不完整", excluded: "未计入",
};
