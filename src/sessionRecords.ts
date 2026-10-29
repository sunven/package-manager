export type SessionScanStatus = "Ready" | "Partial" | "Missing" | "Failed";

export type SessionRecord = {
  id: string;
  title: string;
  lastActivityMs: number | null;
  workingDirectory: string | null;
  bytes: number;
  inUse: boolean;
  grok?: {
    sessionId: string;
    bytesComplete: boolean;
    resumeError: string | null;
    parentSessionId: string | null;
    relatedSessionIds: string[];
    relationsComplete?: boolean;
  };
};

export type AgeEligibleCounts = {
  days7: number;
  days30: number;
};

export type SessionSourceScan = {
  directory: string;
  status: SessionScanStatus;
  records: SessionRecord[];
  message: string | null;
  removalBlockedReason?: string | null;
  ageEligible: AgeEligibleCounts;
};

export type SessionRecordScan = {
  codex: SessionSourceScan;
  claude: SessionSourceScan;
  grok?: SessionSourceScan;
  qoder?: SessionSourceScan;
  "qoder-cn"?: SessionSourceScan;
};

export type SessionSourceId = "codex" | "claude" | "grok" | "qoder" | "qoder-cn";

export function formatSessionRecordId(source: SessionSourceId | undefined, id: string): string {
  if (source === "qoder" || source === "qoder-cn") {
    const separator = id.lastIndexOf("/");
    return separator < 0 ? id : id.slice(separator + 1);
  }
  if (source !== "grok") return id;
  const separator = id.indexOf("/");
  if (separator < 0) return id;
  try {
    const directory = decodeURIComponent(id.slice(0, separator));
    return directory.startsWith("/") ? directory + id.slice(separator) : id;
  } catch {
    return id;
  }
}

export type SessionRefresh = {
  status: "notRequested" | "refreshing" | "ready" | "failed";
  message: string | null;
};

export type OpenCodeSessionRecord = {
  id: string;
  title: string;
  lastActivityMs: number;
  workingDirectory: string;
  archived: boolean;
  parentId: string | null;
  parentTitle: string | null;
};

export type OpenCodeSessionScan = {
  status: "ready" | "unavailable" | "failed";
  records: OpenCodeSessionRecord[];
  message: string | null;
  activeSessionIds: string[] | null;
  activityMessage: string | null;
  ageEligible: AgeEligibleCounts;
};

export type OpenCodeDeletionItem = {
  id: string;
  status: "deleted" | "failed" | "notAttempted";
  message: string | null;
};

export type OpenCodeDeletionResult = {
  historyId?: string | null;
  historyWarning?: string | null;
  preflightError: string | null;
  items: OpenCodeDeletionItem[];
  completedIds: string[];
};

export type OpenCodeDeletionKind = "one" | "selected" | "age";

export type OpenCodeDeletionPlan = {
  planId: string;
  kind: OpenCodeDeletionKind;
  days: 7 | 30 | null;
  cutoffMs: number | null;
  selected: OpenCodeSessionRecord[];
  roots: OpenCodeSessionRecord[];
  affected: OpenCodeSessionRecord[];
};

export type OpenCodeSessionFilter = { query: string; archived: "all" | "active" | "archived" };

export function filterOpenCodeSessions(records: OpenCodeSessionRecord[], filter: OpenCodeSessionFilter) {
  const query = filter.query.trim().toLocaleLowerCase();
  return records
    .filter((record) =>
      (filter.archived === "all" || (filter.archived === "archived" ? record.archived : !record.archived)) &&
      (!query || [record.title, record.workingDirectory].some((value) => value.toLocaleLowerCase().includes(query))),
    )
    .sort((left, right) => right.lastActivityMs - left.lastActivityMs || left.title.localeCompare(right.title));
}

export function groupOpenCodeSessions(records: OpenCodeSessionRecord[], sort: OpenCodeSessionSort = "time"): OpenCodeSessionGroup[] {
  const sorted = [...records].sort((left, right) => right.lastActivityMs - left.lastActivityMs || left.title.localeCompare(right.title));
  if (sort === "project") {
    const groups = new Map<string, OpenCodeSessionGroup>();
    for (const record of sorted) {
      const key = `project:${record.workingDirectory}`;
      const group = groups.get(key) ?? {
        key,
        label: projectLabel(record.workingDirectory),
        path: record.workingDirectory,
        lastActivityMs: record.lastActivityMs,
        records: [],
      };
      group.records.push(record);
      if (record.lastActivityMs > (group.lastActivityMs ?? 0)) group.lastActivityMs = record.lastActivityMs;
      groups.set(key, group);
    }
    return [...groups.values()].sort((left, right) =>
      (right.lastActivityMs ?? 0) - (left.lastActivityMs ?? 0) || left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
  }
  const groups = new Map<string, OpenCodeSessionGroup>();
  for (const record of sorted) {
    const key = monthKey(record.lastActivityMs);
    const group = groups.get(key) ?? { key, label: monthLabel(record.lastActivityMs), records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.key.localeCompare(left.key));
}

export type SessionRemovalResult = {
  historyId?: string | null;
  historyWarning?: string | null;
  moved: number;
  failed: number;
  skipped: number;
  items: SessionRemovalItem[];
  operationError: string | null;
  message: string | null;
};

export type SessionRemovalReason = "InUse" | "NoLongerRecord" | "ActivityChanged" | "ActivityUnknown" | "TrashFailed" | "RuntimeBlocked";
export type SessionRemovalItem = {
  id: string;
  status: "Moved" | "Skipped" | "Failed" | "NotAttempted";
  reason: SessionRemovalReason | null;
  message: string | null;
};

export type SessionRemovalProgress =
  | { phase: "preparing" }
  | { phase: "started"; total: number }
  | { phase: "advanced"; processed: number; total: number; moved: number; skipped: number; failed: number };

export function removalProgressText(progress: SessionRemovalProgress) {
  if (progress.phase === "preparing") return "正在检查可移除记录…";
  if (progress.phase === "started") return `正在移入废纸篓 0/${progress.total}`;
  return `正在移入废纸篓 ${progress.processed}/${progress.total}`;
}

export function removalProgressBreakdown(progress: SessionRemovalProgress) {
  return progress.phase === "advanced"
    ? `已移入 ${progress.moved} · 跳过 ${progress.skipped} · 失败 ${progress.failed}`
    : null;
}

export const removalReasonLabels: Record<SessionRemovalReason, string> = {
  InUse: "使用中，留在原处",
  NoLongerRecord: "已不再是可移除的会话记录",
  ActivityChanged: "最后活动时间已更新，不再早于门槛",
  ActivityUnknown: "无法确认最后活动时间，留在原处",
  TrashFailed: "移入废纸篓失败",
  RuntimeBlocked: "运行状态未满足要求，未执行",
};

export function singleRemovalConfirmText(title: string) {
  return `将「${title}」移入废纸篓？`;
}

export function removalResultText(result: Pick<SessionRemovalResult, "moved" | "failed" | "skipped" | "operationError"> & Partial<Pick<SessionRemovalResult, "items">>) {
  if (result.operationError) return "移除未能执行";
  const notAttempted = result.items?.filter((item) => item.status === "NotAttempted").length ?? 0;
  return `移入废纸篓 ${result.moved} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条${notAttempted ? `，未执行 ${notAttempted} 条` : ""}`;
}

export function ageRemovalRequest(counts: AgeEligibleCounts | null | undefined, days: 7 | 30) {
  const count = counts ? (days === 7 ? counts.days7 : counts.days30) : 0;
  return count > 0 ? { days, count } : null;
}

export function bulkRemovalConfirmText(sourceLabel: string, days: number, count: number) {
  return `将整个 ${sourceLabel} 来源中最后活动时间早于 ${days} 天前的会话记录移入废纸篓。当前符合条件的有 ${count} 条，不受搜索和状态筛选限制。使用中或无法读取最后活动时间的记录会跳过；移除前会再次检查。`;
}

export function removableSessionRecords(records: SessionRecord[]) {
  return records.filter((record) => !record.inUse);
}

export function removeCompletedRecords<
  Source extends string,
  Scan extends { records: { id: string }[] },
>(
  scans: Partial<Record<Source, Scan>>,
  scope: Source,
  completedIds: readonly string[],
): Partial<Record<Source, Scan>> {
  const scan = scans[scope];
  if (!scan || completedIds.length === 0) return scans;
  const completed = new Set(completedIds);
  return {
    ...scans,
    [scope]: { ...scan, records: scan.records.filter((record) => !completed.has(record.id)) },
  };
}

export function selectedRemovalRequest(records: SessionRecord[], selectedIds: ReadonlySet<string> | readonly string[]) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const ids = removableSessionRecords(records)
    .map((record) => record.id)
    .filter((id) => selected.has(id));
  if (ids.length === 0) return null;
  return { ids, count: ids.length };
}

export function selectedRemovalConfirmText(sourceLabel: string, count: number) {
  return `将选中的 ${count} 条 ${sourceLabel} 会话记录移入废纸篓。移除前会再次检查，使用中或已不符合移除条件的记录会跳过。`;
}

export type SessionSectionView = {
  groups: SessionRecordGroup[];
  count: number;
  bytes: number;
  empty: boolean;
  failed: boolean;
  totalCount: number;
};

export type SessionUsageFilter = "all" | "inUse" | "notInUse";
export type SessionFilter = { query: string; usage: SessionUsageFilter };

export function filterSessionRecords(records: SessionRecord[], filter: SessionFilter) {
  const query = filter.query.trim().toLocaleLowerCase();
  return records.filter((record) =>
    (filter.usage === "all" || (filter.usage === "inUse" ? record.inUse : !record.inUse)) &&
    (!query || [record.title, record.workingDirectory ?? ""].some((value) => value.toLocaleLowerCase().includes(query))),
  );
}

export type SessionRecordGroup = {
  key: string;
  label: string;
  count: number;
  bytes: number;
  records: SessionRecord[];
  path?: string | null;
  lastActivityMs?: number | null;
};

const NO_LAST_ACTIVITY_KEY = "none";
const NO_PROJECT_KEY = "project:none";

export type SessionSort = "time" | "project" | "size";

export type OpenCodeSessionSort = "time" | "project";

export type OpenCodeSessionGroup = {
  key: string;
  label: string;
  records: OpenCodeSessionRecord[];
  path?: string;
  lastActivityMs?: number;
};

export function sessionSections(
  scan: SessionRecordScan,
  sort: SessionSort | Partial<Record<SessionSourceId, SessionSort>> = "time",
  filters: Partial<Record<SessionSourceId, SessionFilter>> = {},
) {
  const mode = (source: SessionSourceId) => (typeof sort === "string" ? sort : sort[source] ?? "time");
  return {
    codex: sectionView(scan.codex, mode("codex"), filters.codex),
    claude: sectionView(scan.claude, mode("claude"), filters.claude),
    grok: scan.grok ? sectionView(scan.grok, mode("grok"), filters.grok) : undefined,
    qoder: scan.qoder ? sectionView(scan.qoder, mode("qoder"), filters.qoder) : undefined,
    "qoder-cn": scan["qoder-cn"]
      ? sectionView(scan["qoder-cn"], mode("qoder-cn"), filters["qoder-cn"])
      : undefined,
  };
}

function sectionView(source: SessionSourceScan, sort: SessionSort, filter?: SessionFilter): SessionSectionView {
  const records = filter ? filterSessionRecords(source.records, filter) : source.records;
  const bytes = records.reduce((sum, record) => sum + record.bytes, 0);
  return {
    groups: groupSessionRecords(records, sort),
    count: records.length,
    totalCount: source.records.length,
    bytes,
    empty: records.length === 0,
    failed: source.status === "Failed",
  };
}

export function groupSessionRecords(records: SessionRecord[], sort: SessionSort = "time"): SessionRecordGroup[] {
  if (sort === "size") return [sizeGroup(records)];
  if (sort === "project") return projectGroups(records);
  return monthGroups(records);
}

function monthGroups(records: SessionRecord[]): SessionRecordGroup[] {
  const groups = new Map<string, SessionRecordGroup>();
  for (const record of records) {
    const key = record.lastActivityMs === null ? NO_LAST_ACTIVITY_KEY : monthKey(record.lastActivityMs);
    const group = groups.get(key) ?? {
      key,
      label: record.lastActivityMs === null ? "没有最后活动时间" : monthLabel(record.lastActivityMs),
      count: 0,
      bytes: 0,
      records: [],
    };
    group.records.push(record);
    group.count += 1;
    group.bytes += record.bytes;
    groups.set(key, group);
  }

  for (const group of groups.values()) sortGroupRecords(group.records);

  return [...groups.values()].sort((left, right) => {
    if (left.key === NO_LAST_ACTIVITY_KEY) return 1;
    if (right.key === NO_LAST_ACTIVITY_KEY) return -1;
    return right.key.localeCompare(left.key);
  });
}

function projectGroups(records: SessionRecord[]): SessionRecordGroup[] {
  const groups = new Map<string, SessionRecordGroup>();
  for (const record of records) {
    const path = record.workingDirectory;
    const key = path === null ? NO_PROJECT_KEY : `project:${path}`;
    const group = groups.get(key) ?? {
      key,
      label: path === null ? "没有工作目录" : projectLabel(path),
      path,
      lastActivityMs: null,
      count: 0,
      bytes: 0,
      records: [],
    };
    group.records.push(record);
    group.count += 1;
    group.bytes += record.bytes;
    if (record.lastActivityMs !== null && record.lastActivityMs > (group.lastActivityMs ?? Number.NEGATIVE_INFINITY)) {
      group.lastActivityMs = record.lastActivityMs;
    }
    groups.set(key, group);
  }

  for (const group of groups.values()) sortGroupRecords(group.records);

  return [...groups.values()].sort((left, right) => {
    if (left.key === NO_PROJECT_KEY) return 1;
    if (right.key === NO_PROJECT_KEY) return -1;
    const leftTime = left.lastActivityMs ?? Number.NEGATIVE_INFINITY;
    const rightTime = right.lastActivityMs ?? Number.NEGATIVE_INFINITY;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.label.localeCompare(right.label) || left.key.localeCompare(right.key);
  });
}

function sortGroupRecords(records: SessionRecord[]) {
  records.sort((left, right) => {
    const leftTime = left.lastActivityMs ?? Number.NEGATIVE_INFINITY;
    const rightTime = right.lastActivityMs ?? Number.NEGATIVE_INFINITY;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.title.localeCompare(right.title);
  });
}

function projectLabel(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || path;
}

function sizeGroup(records: SessionRecord[]): SessionRecordGroup {
  const sorted = [...records].sort((left, right) => {
    if (left.bytes !== right.bytes) return right.bytes - left.bytes;
    return left.title.localeCompare(right.title);
  });
  return {
    key: "size",
    label: "按大小",
    count: sorted.length,
    bytes: sorted.reduce((sum, record) => sum + record.bytes, 0),
    records: sorted,
  };
}

export function formatSessionActivity(lastActivityMs: number) {
  const date = new Date(lastActivityMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function monthKey(lastActivityMs: number) {
  const date = new Date(lastActivityMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(lastActivityMs: number) {
  const date = new Date(lastActivityMs);
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}
