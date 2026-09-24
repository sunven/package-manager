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
  message: string | null;
};

export function singleRemovalConfirmText(title: string) {
  return `将「${title}」移入废纸篓？`;
}

export function removalResultText(result: Pick<SessionRemovalResult, "moved" | "failed">) {
  return `移入废纸篓 ${result.moved} 条，失败 ${result.failed} 条`;
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
  return `将 ${sourceLabel} 最后活动时间早于 ${days} 天的 ${count} 条会话记录移入废纸篓？使用中的记录和读不出最后活动时间的记录不在其中。`;
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
};

export type SessionRecordGroup = {
  key: string;
  label: string;
  count: number;
  bytes: number;
  records: SessionRecord[];
};

const NO_LAST_ACTIVITY_KEY = "none";

export function sessionSections(scan: SessionRecordScan) {
  return {
    codex: sectionView(scan.codex),
    claude: sectionView(scan.claude),
  };
}

function sectionView(source: SessionSourceScan): SessionSectionView {
  const bytes = source.records.reduce((sum, record) => sum + record.bytes, 0);
  return {
    groups: groupSessionRecords(source.records),
    count: source.records.length,
    bytes,
    empty: source.records.length === 0,
    failed: source.status === "Failed",
  };
}

export function groupSessionRecords(records: SessionRecord[]): SessionRecordGroup[] {
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
