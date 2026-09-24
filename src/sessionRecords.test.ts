import { describe, expect, it } from "vitest";
import {
  bulkRemovalConfirmText,
  bulkRemovalRequest,
  groupSessionRecords,
  recordsOlderThan,
  removalResultText,
  sessionSections,
  singleRemovalConfirmText,
  type SessionRecord,
  type SessionSourceScan,
} from "./sessionRecords";

function localMs(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).getTime();
}

function record(overrides: Partial<SessionRecord> & Pick<SessionRecord, "id" | "lastActivityMs" | "bytes">): SessionRecord {
  return {
    title: overrides.id,
    workingDirectory: "/work/app",
    inUse: false,
    ...overrides,
  };
}

describe("session record grouping", () => {
  it("groups by local month newest first and keeps records without last activity separate", () => {
    const groups = groupSessionRecords([
      record({ id: "may", lastActivityMs: localMs(2026, 5, 2), bytes: 10 }),
      record({ id: "september-early", lastActivityMs: localMs(2026, 9, 1, 9), bytes: 30 }),
      record({ id: "august", lastActivityMs: localMs(2026, 8, 20), bytes: 5 }),
      record({ id: "untitled", lastActivityMs: null, bytes: 7, workingDirectory: null }),
      record({ id: "september-late", lastActivityMs: localMs(2026, 9, 24, 18), bytes: 1, inUse: true }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["2026-09", "2026-08", "2026-05", "none"]);
    expect(groups[0]).toMatchObject({
      label: "2026年9月",
      count: 2,
      bytes: 31,
    });
    expect(groups[0].records.map((item) => item.id)).toEqual(["september-late", "september-early"]);
    expect(groups[0].records[0].inUse).toBe(true);
    expect(groups[groups.length - 1]).toMatchObject({
      label: "没有最后活动时间",
      count: 1,
      bytes: 7,
    });
  });

  it("keeps one source when the other is empty or failed", () => {
    const codex = source([record({ id: "codex", lastActivityMs: localMs(2026, 9, 2), bytes: 40 })]);
    const failed: SessionSourceScan = {
      directory: "/Users/example/.claude/projects",
      status: "Failed",
      records: [],
      message: "无法读取",
    };
    const missing: SessionSourceScan = { ...failed, status: "Missing", message: null };

    expect(sessionSections({ codex, claude: failed })).toMatchObject({
      codex: { count: 1, bytes: 40, empty: false, failed: false },
      claude: { count: 0, bytes: 0, empty: true, failed: true, groups: [] },
    });
    expect(sessionSections({ codex, claude: missing }).claude).toMatchObject({
      count: 0,
      empty: true,
      failed: false,
    });
    expect(sessionSections({ codex, claude: missing }).codex.count).toBe(1);
  });

  it("names the record in the single-removal confirmation and reports both counts", () => {
    expect(singleRemovalConfirmText("修一下登录")).toBe("将「修一下登录」移入废纸篓？");
    expect(removalResultText({ moved: 1, failed: 0 })).toBe("移入废纸篓 1 条，失败 0 条");
  });

  it("selects one source's records older than 7 or 30 periods of 24 hours", () => {
    const now = Date.UTC(2026, 0, 15);
    const day = 24 * 60 * 60 * 1000;
    const records = [
      record({ id: "exact", lastActivityMs: now - 7 * day, bytes: 1 }),
      record({ id: "just-old", lastActivityMs: now - 7 * day - 1, bytes: 1 }),
      record({ id: "month", lastActivityMs: now - 30 * day - 1, bytes: 1 }),
      record({ id: "busy", lastActivityMs: now - 40 * day, bytes: 1, inUse: true }),
      record({ id: "unknown", lastActivityMs: null, bytes: 1 }),
    ];

    expect(recordsOlderThan(records, 7, now).map((item) => item.id)).toEqual(["just-old", "month"]);
    expect(recordsOlderThan(records, 30, now).map((item) => item.id)).toEqual(["month"]);
    expect(bulkRemovalRequest(records, 30, now)).toEqual({ days: 30, count: 1 });
    expect(bulkRemovalRequest([records[0]], 7, now)).toBeNull();
    expect(bulkRemovalConfirmText("Claude", 30, 1)).toBe(
      "将 Claude 最后活动时间早于 30 天的 1 条会话记录移入废纸篓？使用中的记录和读不出最后活动时间的记录不在其中。",
    );
  });
});

function source(records: SessionRecord[]): SessionSourceScan {
  return {
    directory: "/Users/example/.codex/sessions",
    status: "Ready",
    records,
    message: null,
  };
}
