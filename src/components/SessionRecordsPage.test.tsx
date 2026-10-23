import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionRecordsPage as Page } from "./SessionRecordsPage";
import { useSessionRecords } from "../hooks/useSessionRecords";
import { useOpenCodeSessions } from "../hooks/useOpenCodeSessions";
import type { SessionRecordScan, SessionSourceScan } from "../sessionRecords";

function SessionRecordsPage({ scan, ...props }: { scan: SessionRecordScan; homeDirectory: string | null; initialSource?: "codex" | "claude" }) {
  const records = useSessionRecords(false);
  const openCode = useOpenCodeSessions(false);
  return <Page {...props} records={{ ...records, scan }} openCode={openCode} />;
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
