export interface DiskRemovalTarget {
  id: number;
  name: string;
  path: string;
  directory: boolean;
  partial: boolean;
  bytes: number | null;
}

export interface DiskRemovalPlan {
  id: string;
  scanId: string;
  rootPath: string;
  targets: DiskRemovalTarget[];
}

export interface DiskRemovalItem {
  id: number;
  path: string;
  status: "moved" | "skipped" | "failed";
  message: string | null;
}

export interface DiskRemovalProgress {
  planId: string;
  total: number;
  completed: number;
  currentPath: string | null;
  item: DiskRemovalItem | null;
}

export interface DiskRemovalReceipt {
  results: DiskRemovalItem[];
  stopped: boolean;
  historyId: string | null;
  historyWarning: string | null;
}

export interface DiskRemovalView {
  phase: "idle" | "preparing" | "confirming" | "running" | "done";
  plan: DiskRemovalPlan | null;
  results: DiskRemovalItem[];
  currentPath: string | null;
  stopping: boolean;
  cancelling: boolean;
  error: string | null;
  followup: string | null;
  historyWarning: string | null;
}

export const diskRemovalLabels = { moved: "已移到废纸篓", skipped: "已跳过", failed: "失败" };
export const emptyDiskRemoval: DiskRemovalView = {
  phase: "idle", plan: null, results: [], currentPath: null, stopping: false, cancelling: false,
  error: null, followup: null, historyWarning: null,
};

export function diskRemovalLocked(removal: DiskRemovalView) {
  return removal.phase === "preparing" || removal.phase === "confirming" || removal.phase === "running";
}

export interface DiskRemovalEffects {
  prepare(scanId: string, ids: number[]): Promise<DiskRemovalPlan>;
  cancel(planId: string): Promise<void>;
  run(planId: string, progress: (event: DiskRemovalProgress) => void): Promise<DiskRemovalReceipt>;
  stop(planId: string): Promise<void>;
  locate(scanId: string, path: string): Promise<number>;
  followup(historyId: string, status: "ready" | "failed", message: string | null): Promise<void>;
}
