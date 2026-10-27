import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionRecordsPage as Page } from "./SessionRecordsPage";
import { useSessionRecords } from "../hooks/useSessionRecords";
import { useOpenCodeSessions } from "../hooks/useOpenCodeSessions";
import {
  requireCoverageItem,
  type ObservationCoverageItem,
} from "../observationCoverage";
import { coverageIndexFromFacts } from "../test/observationFixtures";
import { openCodeObservationFacts, sessionObservationFacts } from "../observationFacts";
import type { ObservationRecord } from "../observationLedger";
import type {
  OpenCodeSessionScan,
  SessionRecordScan,
  SessionSourceScan,
} from "../sessionRecords";

function SessionRecordsPage({
  scan,
  coverageItems,
  ...props
}: {
  scan: SessionRecordScan;
  homeDirectory: string | null;
  initialSource?: "codex" | "claude" | "opencode";
  coverageItems?: Record<"codex" | "claude" | "grok" | "opencode", ObservationCoverageItem>;
}) {
  const records = useSessionRecords(false);
  const openCode = useOpenCodeSessions(false);
  return <Page {...props} coverageItems={coverageItems ?? observationCoverageItems(scan)} records={{ ...records, scan }} openCode={openCode} />;
}

function observationCoverageItems(
  scan: SessionRecordScan,
  options: {
    scanning?: { codex?: boolean; claude?: boolean };
    records?: Partial<Record<"session:codex" | "session:claude" | "session:opencode", ObservationRecord>>;
    openCode?: OpenCodeSessionScan | null;
  } = {},
): Record<"codex" | "claude" | "grok" | "opencode", ObservationCoverageItem> {
  const index = coverageIndexFromFacts({
    "session:codex": sessionObservationFacts("codex", scan.codex, options.scanning?.codex ?? false, null),
    "session:claude": sessionObservationFacts("claude", scan.claude, options.scanning?.claude ?? false, null),
    "session:grok": sessionObservationFacts("grok", scan.grok ?? null, false, null),
    "session:opencode": openCodeObservationFacts(options.openCode ?? null, false, null),
  }, options.records);
  return {
    codex: requireCoverageItem(index, "session:codex"),
    claude: requireCoverageItem(index, "session:claude"),
    grok: requireCoverageItem(index, "session:grok"),
    opencode: requireCoverageItem(index, "session:opencode"),
  };
}

const codex: SessionSourceScan = {
  directory: "/Users/example/.codex/sessions",
  status: "Ready",
  message: null,
  ageEligible: { days7: 0, days30: 0 },
  records: [
    {
      id: "2026/09/24/chat.jsonl",
      title: "修一下登录",
      lastActivityMs: new Date(2026, 8, 24, 15).getTime(),
      workingDirectory: "/Users/example/work/package-manager",
      bytes: 2048,
      inUse: true,
    },
  ],
};

const scan: SessionRecordScan = {
  codex,
  claude: {
    directory: "/Users/example/.claude/projects",
    status: "Missing",
    message: null,
    ageEligible: { days7: 0, days30: 0 },
    records: [],
  },
};

function renderWithCoverage(
  sourceScan: SessionRecordScan,
  options: Parameters<typeof observationCoverageItems>[1] = {},
  initialSource?: "codex" | "claude" | "opencode",
) {
  return renderToStaticMarkup(
    <SessionRecordsPage
      coverageItems={observationCoverageItems(sourceScan, options)}
      homeDirectory="/Users/example"
      initialSource={initialSource}
      scan={sourceScan}
    />,
  );
}

describe("SessionRecordsPage", () => {
  it("shows the trash note, the month summary, and an in-use record", () => {
    const html = renderToStaticMarkup(
      <SessionRecordsPage
        homeDirectory="/Users/example"
        scan={scan}
      />,
    );

    expect(html).toContain("刷新");
    expect(html).not.toContain("SESSION RECORDS");
    expect(html).toContain("2026年9月");
    expect(html).toContain("1 条");
    expect(html).toContain("使用中，暂不移除");
    expect(html).not.toContain("移入废纸篓</button>");
    expect(html).toContain("移入废纸篓 0 条");
    expect(openingTagBefore(html, "移入废纸篓 0 条")).toMatch(/ disabled(?:=|\s|>)/);
    expect(checkboxTag(html, "选择 修一下登录")).toContain("data-disabled");
    expect(html).toContain("修一下登录");
    expect(html).toContain("~/work/package-manager");
  });

  it("offers removal for a record that is not in use", () => {
    const html = renderToStaticMarkup(
      <SessionRecordsPage
        homeDirectory="/Users/example"
        scan={{
          ...scan,
          codex: {
            ...codex,
            records: [{ ...codex.records[0], id: "free.jsonl", title: "可以移走", inUse: false }],
          },
        }}
      />,
    );

    expect(html).toContain("可以移走");
    expect(html).toContain("移入废纸篓");
    expect(html).toContain("移入废纸篓 0 条");
    expect(openingTagBefore(html, "移入废纸篓 0 条")).toMatch(/ disabled(?:=|\s|>)/);
    expect(checkboxTag(html, "选择 可以移走")).not.toContain("data-disabled");
    expect(html).toContain("全选当前结果中可移除记录");
  });

  it("shows an empty Codex section when the sessions directory is missing", () => {
    const html = renderToStaticMarkup(
      <SessionRecordsPage
        homeDirectory={null}
        scan={{
          codex: { ...codex, status: "Missing", records: [] },
          claude: scan.claude,
        }}
      />,
    );

    expect(html).toContain("未找到 Codex 会话记录目录");
    expect(html).toContain(">Claude");
  });

  it("keeps the Codex list visible when Claude fails", () => {
    const html = renderToStaticMarkup(
      <SessionRecordsPage
        homeDirectory="/Users/example"
        initialSource="claude"
        scan={{
          codex,
          claude: {
            directory: "/Users/example/.claude/projects",
            status: "Failed",
            message: "无法读取会话记录目录",
            records: [],
            ageEligible: { days7: 0, days30: 0 },
          },
        }}
      />,
    );

    expect(html).toContain("Claude 会话记录读取失败");
    expect(html).not.toContain("没有 Claude 会话记录");
    expect(html).toContain("未能读取会话记录，请查看错误信息后刷新重试");
    expect(html).toContain(">Codex");
  });

  it("shows independent observation strips for Codex and Claude", () => {
    const codexHtml = renderWithCoverage(scan, {}, "codex");
    expect(codexHtml).toContain("已观察");
    expect(codexHtml).toContain("观察时间未知");
    expect(codexHtml).toContain("读取完整");
    expect(codexHtml).not.toContain("未找到目录");

    const claudeHtml = renderWithCoverage(scan, {}, "claude");
    expect(claudeHtml).toContain("已观察");
    expect(claudeHtml).toContain("观察时间未知");
    expect(claudeHtml).toContain("读取完整");
    expect(claudeHtml).toContain("未找到目录");
    expect(claudeHtml).toContain("未找到 Claude 会话记录目录");
  });

  it("treats a missing sessions directory as observed with a domain note", () => {
    const missing = {
      ...scan,
      claude: { ...scan.claude, status: "Missing" as const, records: [] },
    };
    const html = renderWithCoverage(missing, {}, "claude");
    expect(html).toContain("已观察");
    expect(html).toContain("未找到目录");
    expect(html).toContain("未找到 Claude 会话记录目录");
  });

  it("keeps source-specific failure wording", () => {
    const failed = {
      ...scan,
      claude: {
        ...scan.claude,
        status: "Failed" as const,
        message: "无法读取会话记录目录",
        records: [],
      },
    };
    const html = renderWithCoverage(failed, {}, "claude");
    expect(html).toContain("读取失败");
    expect(html).toContain("Claude 会话记录读取失败");
    expect(html).toContain("无法读取会话记录目录");
  });

  it("does not merge in-progress and observed sources into one busy state", () => {
    const codexHtml = renderWithCoverage(scan, { scanning: { codex: true } }, "codex");
    expect(codexHtml).toContain("观察中");

    const claudeHtml = renderWithCoverage(scan, {}, "claude");
    expect(claudeHtml).toContain("已观察");
  });

  it("shows an unavailable OpenCode service without inventing a read", () => {
    const openCode: OpenCodeSessionScan = {
      status: "unavailable",
      records: [],
      message: "服务未连接",
      activeSessionIds: null,
      activityMessage: null,
      ageEligible: { days7: 0, days30: 0 },
    };
    const html = renderWithCoverage(scan, { openCode }, "opencode");
    expect(html).toContain("不可用");
    expect(html).toContain("OpenCode 服务不可用");
  });
});

function checkboxTag(html: string, label: string) {
  const marker = `aria-label="${label}"`;
  const start = html.indexOf(marker);
  const tagStart = html.lastIndexOf("<", start);
  return html.slice(tagStart, html.indexOf(">", start) + 1);
}

function openingTagBefore(html: string, text: string) {
  const at = html.indexOf(text);
  return html.slice(html.lastIndexOf("<", at), at);
}
