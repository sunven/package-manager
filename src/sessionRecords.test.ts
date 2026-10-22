import { describe, expect, it } from "vitest";
import {
  bulkRemovalConfirmText,
  bulkRemovalRequest,
  filterOpenCodeSessions,
  groupOpenCodeSessions,
  groupSessionRecords,
  recordsOlderThan,
  removableSessionRecords,
  removalResultText,
  selectedRemovalConfirmText,
  selectedRemovalRequest,
  sessionSections,
  singleRemovalConfirmText,
  type SessionRecord,
  type SessionSourceScan,
  type OpenCodeSessionRecord,
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
  it("groups OpenCode by local month with recent months and records first", () => {
    const base: OpenCodeSessionRecord = { id: "base", title: "Base", lastActivityMs: 1, parentId: null, parentTitle: null, archived: false, workingDirectory: "/work" };
    const groups = groupOpenCodeSessions([
      { ...base, id: "september", lastActivityMs: localMs(2026, 9, 1) },
      { ...base, id: "october-old", lastActivityMs: localMs(2026, 10, 1) },
      { ...base, id: "october-new", lastActivityMs: localMs(2026, 10, 20) },
    ]);
    expect(groups.map((group) => [group.label, group.records.map(({ id }) => id)])).toEqual([
      ["2026年10月", ["october-new", "october-old"]], ["2026年9月", ["september"]],
    ]);
  });

  it("filters OpenCode sessions by title, working directory, and archive state", () => {
    const records: OpenCodeSessionRecord[] = [
      { id: "older", title: "Project setup", lastActivityMs: 10, workingDirectory: "/work/alpha", archived: false, parentId: null, parentTitle: null },
      { id: "archived", title: "Follow-up", lastActivityMs: 30, workingDirectory: "/work/alpha/subproject", archived: true, parentId: "older", parentTitle: "Project setup" },
      { id: "newer", title: "Project review", lastActivityMs: 20, workingDirectory: "/work/beta", archived: false, parentId: null, parentTitle: null },
    ];

    expect(filterOpenCodeSessions(records, { query: " PROJECT ", archived: "active" }).map(({ id }) => id)).toEqual(["newer", "older"]);
    expect(filterOpenCodeSessions(records, { query: "subproject", archived: "archived" }).map(({ id }) => id)).toEqual(["archived"]);
  });

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

  it("sorts every record by size and keeps equal sizes in title order", () => {
    const groups = groupSessionRecords([
      record({ id: "small", title: "小", lastActivityMs: localMs(2026, 9, 2), bytes: 10 }),
      record({ id: "zeta", title: "后", lastActivityMs: null, bytes: 40 }),
      record({ id: "alpha", title: "前", lastActivityMs: localMs(2026, 5, 1), bytes: 40 }),
      record({ id: "busy", title: "使用中", lastActivityMs: localMs(2026, 8, 1), bytes: 5, inUse: true }),
    ], "size");

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "size", label: "按大小", count: 4, bytes: 95 });
    expect(groups[0].records.map((item) => item.id)).toEqual(["alpha", "zeta", "small", "busy"]);
  });

  it("sorts each source on its own", () => {
    const scan = {
      codex: source([
        record({ id: "later-small", lastActivityMs: localMs(2026, 9, 3), bytes: 1 }),
        record({ id: "earlier-large", lastActivityMs: localMs(2026, 9, 1), bytes: 9 }),
      ]),
      claude: source([
        record({ id: "later-small", lastActivityMs: localMs(2026, 8, 3), bytes: 1 }),
        record({ id: "earlier-large", lastActivityMs: localMs(2026, 8, 1), bytes: 9 }),
      ]),
    };

    const sections = sessionSections(scan, { codex: "size", claude: "time" });

    expect(sections.codex.groups[0].records.map((item) => item.id)).toEqual(["earlier-large", "later-small"]);
    expect(sections.claude.groups[0].records.map((item) => item.id)).toEqual(["later-small", "earlier-large"]);
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
    expect(removalResultText({ moved: 1, failed: 0, skipped: 0, operationError: null })).toBe("移入废纸篓 1 条，跳过 0 条，失败 0 条");
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
      "将整个 Claude 来源中最后活动时间早于 30 天前的会话记录移入废纸篓。当前符合条件的有 1 条，不受搜索和状态筛选限制。使用中或无法读取最后活动时间的记录会跳过；移除前会再次检查。",
    );
  });

  it("forms an explicit selection from removable records only", () => {
    const records = [
      record({ id: "busy", lastActivityMs: localMs(2026, 9, 24), bytes: 1, inUse: true }),
      record({ id: "unknown", lastActivityMs: null, bytes: 2 }),
      record({ id: "recent", lastActivityMs: localMs(2026, 9, 24), bytes: 3 }),
      record({ id: "old", lastActivityMs: localMs(2026, 1, 1), bytes: 4 }),
    ];

    expect(removableSessionRecords(records).map((item) => item.id)).toEqual(["unknown", "recent", "old"]);
    expect(selectedRemovalRequest(records, ["busy", "unknown", "missing"])).toEqual({
      ids: ["unknown"],
      count: 1,
    });
    expect(selectedRemovalRequest(records, ["busy"])).toBeNull();
    expect(selectedRemovalRequest(records, [])).toBeNull();
    expect(selectedRemovalConfirmText("Codex", 2)).toBe(
      "将选中的 2 条 Codex 会话记录移入废纸篓。移除前会再次检查，使用中或已不符合移除条件的记录会跳过。",
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
