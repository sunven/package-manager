import { managerLabels } from "./constants";
import type {
  DirectoryMeasurementStatus,
  ManagerId,
  ProjectCleanupStatus,
  ProjectDataKind,
} from "./types";

export type MaintenanceDomain = "manager" | "projectCleanup" | "vscodeStorage" | "sessionRecord";

export type MaintenanceOperation =
  | "cleanupCache"
  | "uninstallGlobalPackage"
  | "cleanBatch"
  | "removeWorkspaceStorage"
  | "removeToTrash"
  | "deletePermanently";

export type ExecutionSummary = "succeeded" | "partial" | "failed" | "notExecuted" | "unconfirmed";
export type FollowUpReadStatus = "notRequested" | "ready" | "failed";
export type VerificationStatus = "succeeded" | "failed" | "notStarted" | "skipped";
export type SessionRemovalMode = "single" | "selected" | "olderThan";

export interface FollowUpRead {
  status: FollowUpReadStatus;
  recordedAt: number;
  message: string | null;
}

export interface Verification {
  status: VerificationStatus;
  recordedAt: number | null;
  message: string | null;
  beforeSnapshotId: string | null;
  afterSnapshotId: string | null;
}

export interface ManagerStep {
  label: string;
  state: "succeeded" | "failed" | "skipped";
  failureMessage: string | null;
}

export interface ManagerDetail {
  kind: "manager";
  managerId: ManagerId;
  target: string | null;
  steps: ManagerStep[] | null;
}

export interface ProjectCleanupCandidateSnapshot {
  candidateId: string;
  kind: ProjectDataKind;
  projectPath: string;
  directoryPath: string;
  order: number;
  confirmedBytes: number | null;
  confirmedComplete: boolean;
}

export interface ProjectCleanupTargetResult {
  candidateId: string;
  status: ProjectCleanupStatus;
  command: string | null;
  beforeBytes: number | null;
  afterBytes: number | null;
  cleanedBytes: number | null;
  measurementStatus: DirectoryMeasurementStatus;
  message: string | null;
  failureMessage: string | null;
  effectFailureMessage: string | null;
}

export interface ProjectCleanupDetail {
  kind: "projectCleanup";
  scope: {
    scanId: string;
    scanRootId: string;
    scanRootPath: string;
    batchId: string;
    candidates: ProjectCleanupCandidateSnapshot[];
  };
  finish: "completed" | "stopped";
  results: ProjectCleanupTargetResult[];
}

export interface VscodeWorkspaceSnapshot {
  id: string;
  name: string;
  projectPath: string | null;
  storagePath: string;
  kind: string;
  projectStatus: string;
  removable: boolean;
  removalBlockReason: string | null;
  bytes: number | null;
  usageComplete: boolean;
}

export interface VscodeStorageItemSnapshot {
  id: string;
  status: string;
  reason: string | null;
  message: string | null;
}

export interface VscodeStorageDetail {
  kind: "vscodeStorage";
  scope: { workspaces: VscodeWorkspaceSnapshot[] };
  results: VscodeStorageItemSnapshot[];
}

export interface SessionRecordSnapshot {
  id: string;
  title: string;
  workingDirectory: string | null;
  lastActivityMs: number | null;
}

export interface SessionRemovalItemSnapshot {
  id: string;
  status: string;
  reason: string | null;
  message: string | null;
}

export interface SessionTrashDetail {
  kind: "sessionTrash";
  scope: {
    source: "codex" | "claude";
    mode: SessionRemovalMode;
    days: number | null;
    confirmedCount: number | null;
    confirmedRecords: SessionRecordSnapshot[] | null;
  };
  executionTotal: number | null;
  results: SessionRemovalItemSnapshot[];
}

export interface OpenCodeSessionSnapshot {
  id: string;
  title: string;
  workingDirectory: string | null;
  lastActivityMs: number;
  archived: boolean;
  parentId: string | null;
}

export interface OpenCodeDeletionItemSnapshot {
  id: string;
  status: string;
  message: string | null;
}

export interface OpenCodeDeletionDetail {
  kind: "openCodeDeletion";
  scope: {
    source: "opencode";
    mode: SessionRemovalMode;
    planId: string;
    days: number | null;
    cutoffMs: number | null;
    confirmedRoots: OpenCodeSessionSnapshot[];
    confirmedAffected: OpenCodeSessionSnapshot[];
  };
  completedIds: string[];
  results: OpenCodeDeletionItemSnapshot[];
}

export type MaintenanceDetail =
  | ManagerDetail
  | ProjectCleanupDetail
  | VscodeStorageDetail
  | SessionTrashDetail
  | OpenCodeDeletionDetail;

export interface MaintenanceRecord {
  id: string;
  domain: MaintenanceDomain;
  operation: MaintenanceOperation;
  startedAt: number;
  finishedAt: number | null;
  execution: ExecutionSummary;
  interrupted: boolean;
  message: string;
  followUpRead: FollowUpRead | null;
  verification: Verification | null;
  detail: MaintenanceDetail;
}

export interface SummarySubject {
  managerId?: ManagerId;
  target?: string;
  rootPath?: string;
  source?: "codex" | "claude" | "opencode" | "vscode";
  mode?: SessionRemovalMode;
  targetCount: number;
}

export interface SummaryCounts {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  notAttempted: number;
}

export interface MaintenanceRecordSummary {
  id: string;
  domain: MaintenanceDomain;
  operation: MaintenanceOperation;
  startedAt: number;
  finishedAt: number | null;
  execution: ExecutionSummary;
  interrupted: boolean;
  subject: SummarySubject;
  counts: SummaryCounts;
  followUpReadStatus: FollowUpReadStatus | null;
  verificationStatus: VerificationStatus | null;
}

export interface MaintenanceHistory {
  records: MaintenanceRecordSummary[];
  warnings: string[];
}

export const maintenanceDomainLabels: Record<MaintenanceDomain, string> = {
  manager: "管理器维护",
  projectCleanup: "项目清理",
  vscodeStorage: "VS Code 工作区存储移除",
  sessionRecord: "会话记录操作",
};

export const maintenanceOperationLabels: Record<MaintenanceOperation, string> = {
  cleanupCache: "缓存清理",
  uninstallGlobalPackage: "全局包卸载",
  cleanBatch: "项目清理批次",
  removeWorkspaceStorage: "工作区存储移除",
  removeToTrash: "会话记录移入废纸篓",
  deletePermanently: "OpenCode 会话永久删除",
};

export const executionSummaryLabels: Record<ExecutionSummary, string> = {
  succeeded: "已完成",
  partial: "部分完成",
  failed: "失败",
  notExecuted: "未执行",
  unconfirmed: "结果未确认",
};

export const followUpReadLabels: Record<FollowUpReadStatus, string> = {
  notRequested: "未请求后续读取",
  ready: "后续读取已完成",
  failed: "后续读取失败",
};

export const verificationStatusLabels: Record<VerificationStatus, string> = {
  succeeded: "核对已完成",
  failed: "核对未完成",
  notStarted: "尚未核对",
  skipped: "无需核对",
};

const sessionModeLabels: Record<SessionRemovalMode, string> = {
  single: "单条",
  selected: "选中",
  olderThan: "按年龄",
};

export function maintenanceRecordTitle(record: Pick<MaintenanceRecordSummary, "domain" | "operation" | "subject">) {
  if (record.domain === "manager" && record.subject.managerId) {
    return `${managerLabels[record.subject.managerId]} · ${maintenanceOperationLabels[record.operation]}${
      record.subject.target ? ` ${record.subject.target}` : ""
    }`;
  }
  if (record.domain === "projectCleanup") {
    return `项目清理 · ${record.subject.rootPath ?? "扫描目录"}`;
  }
  if (record.domain === "vscodeStorage") {
    return "VS Code 工作区存储移除";
  }
  if (record.domain === "sessionRecord") {
    const source = record.subject.source === "opencode" ? "OpenCode" : record.subject.source === "claude" ? "Claude Code" : "Codex";
    const mode = record.subject.mode ? ` · ${sessionModeLabels[record.subject.mode]}` : "";
    return `${source} 会话记录${record.operation === "deletePermanently" ? "永久删除" : "移除"}${mode}`;
  }
  return maintenanceDomainLabels[record.domain];
}

export function maintenanceRecordState(record: Pick<MaintenanceRecordSummary, "execution" | "finishedAt" | "interrupted">) {
  if (record.interrupted) return "已中断";
  if (record.finishedAt === null) return "执行中";
  return executionSummaryLabels[record.execution];
}

export function maintenanceRecoveryBoundary(record: Pick<MaintenanceRecordSummary, "operation" | "domain">) {
  if (record.operation === "deletePermanently") return "OpenCode 服务永久删除会话及其子会话，无法由本工具恢复。";
  if (record.operation === "removeToTrash" || record.operation === "removeWorkspaceStorage") {
    return "记录已移入系统废纸篓，清空废纸篓前可恢复；磁盘空间不会立即释放。";
  }
  if (record.domain === "projectCleanup") {
    return "Rust 与 Maven 构建目录委托给原生 CLI 清理；Node 依赖目录为永久护栏删除，清理后不会自动重新安装。";
  }
  return "维护操作按各管理器原有恢复边界执行；目录占用变化不等于实际释放空间。";
}

export function maintenanceRecordNeedsFollowUp(status: FollowUpReadStatus | null) {
  return status === "failed";
}

export function maintenanceRecordNeedsVerification(status: VerificationStatus | null) {
  return status === "failed" || status === "notStarted";
}

export function maintenanceRecordDateKey(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function maintenanceRecordDateLabel(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function groupMaintenanceRecords(records: MaintenanceRecordSummary[]) {
  const groups = new Map<string, { key: string; label: string; records: MaintenanceRecordSummary[] }>();
  for (const record of records) {
    const key = maintenanceRecordDateKey(record.startedAt);
    const group = groups.get(key) ?? { key, label: maintenanceRecordDateLabel(record.startedAt), records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function filterMaintenanceRecords(
  records: MaintenanceRecordSummary[],
  domain: MaintenanceDomain | "all",
  execution: ExecutionSummary | "all",
) {
  return records.filter((record) =>
    (domain === "all" || record.domain === domain) &&
    (execution === "all" || record.execution === execution),
  );
}
