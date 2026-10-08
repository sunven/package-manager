export type SessionScanStatus = "Ready" | "Partial" | "Missing" | "Failed";

export type SessionRecord = {
  id: string;
  title: string;
  lastActivityMs: number | null;
  workingDirectory: string | null;
  bytes: number;
  inUse: boolean;
};

export type SessionSourceScan = {
  directory: string;
  status: SessionScanStatus;
  records: SessionRecord[];
  message: string | null;
};

export type SessionRecordScan = {
  codex: SessionSourceScan;
  claude: SessionSourceScan;
};

export type SessionSourceId = "codex" | "claude";

export type SessionRemovalResult = {
  moved: number;
  failed: number;
  skipped: number;
  items: SessionRemovalItem[];
  operationError: string | null;
  message: string | null;
};

export type SessionRemovalReason = "InUse" | "NoLongerRecord" | "ActivityChanged" | "ActivityUnknown" | "TrashFailed";
export type SessionRemovalItem = {
  id: string;
  status: "Moved" | "Skipped" | "Failed";
  reason: SessionRemovalReason | null;
  message: string | null;
};

export const removalReasonLabels: Record<SessionRemovalReason, string> = {
  InUse: "使用中，留在原处",
  NoLongerRecord: "已不再是可移除的会话记录",
  ActivityChanged: "最后活动时间已更新，不再早于门槛",
  ActivityUnknown: "无法确认最后活动时间，留在原处",
  TrashFailed: "移入废纸篓失败",
};

export function singleRemovalConfirmText(title: string) {
  return `将「${title}」移入废纸篓？`;
}

export function removalResultText(result: Pick<SessionRemovalResult, "moved" | "failed" | "skipped" | "operationError">) {
  if (result.operationError) return "移除未能执行";
  return `移入废纸篓 ${result.moved} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function recordsOlderThan(records: SessionRecord[], days: 7 | 30, nowMs: number) {
  const cutoff = nowMs - days * DAY_MS;
  return records.filter((record) => record.lastActivityMs !== null && !record.inUse && record.lastActivityMs < cutoff);
}

export function bulkRemovalRequest(
  records: SessionRecord[],
  days: 7 | 30,
  nowMs: number,
) {
  const count = recordsOlderThan(records, days, nowMs).length;
  if (count === 0) return null;
  return { days, count };
}

export function bulkRemovalConfirmText(sourceLabel: string, days: number, count: number) {
  return `将整个 ${sourceLabel} 来源中最后活动时间早于 ${days} 天的会话记录移入废纸篓？当前观察到 ${count} 条，搜索和状态筛选不限制此范围。使用中的记录和读不出最后活动时间的记录不在其中；执行时会重新判断。`;
}

export function removableSessionRecords(records: SessionRecord[]) {
  return records.filter((record) => !record.inUse);
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
  return `将选中的 ${count} 条 ${sourceLabel} 会话记录移入废纸篓？动手时仍在使用或已不再是会话记录的会留下。`;
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
};

const NO_LAST_ACTIVITY_KEY = "none";

export type SessionSort = "time" | "size";

export function sessionSections(
  scan: SessionRecordScan,
  sort: SessionSort | Partial<Record<SessionSourceId, SessionSort>> = "time",
  filters: Partial<Record<SessionSourceId, SessionFilter>> = {},
) {
  const mode = (source: SessionSourceId) => (typeof sort === "string" ? sort : sort[source] ?? "time");
  return {
    codex: sectionView(scan.codex, mode("codex"), filters.codex),
    claude: sectionView(scan.claude, mode("claude"), filters.claude),
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

  for (const group of groups.values()) {
    group.records.sort((left, right) => {
      const leftTime = left.lastActivityMs ?? Number.NEGATIVE_INFINITY;
      const rightTime = right.lastActivityMs ?? Number.NEGATIVE_INFINITY;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.title.localeCompare(right.title);
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (left.key === NO_LAST_ACTIVITY_KEY) return 1;
    if (right.key === NO_LAST_ACTIVITY_KEY) return -1;
    return right.key.localeCompare(left.key);
  });
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
