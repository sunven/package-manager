import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionRecordsPage } from "./SessionRecordsPage";
import type { SessionRecordScan, SessionSourceScan } from "../sessionRecords";

const codex: SessionSourceScan = {
  directory: "/Users/example/.codex/sessions",
  status: "Ready",
  message: null,
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
    records: [],
  },
};

describe("SessionRecordsPage", () => {
  it("shows the trash note, the month summary, and an in-use record", () => {
    const html = renderToStaticMarkup(
      <SessionRecordsPage
        error={null}
        homeDirectory="/Users/example"
        onRefresh={() => {}}
        onRemove={async () => ({ moved: 0, failed: 0, message: null })}
        onRemoveOlder={async () => ({ moved: 0, failed: 0, message: null })}
        scan={scan}
        scanning={false}
      />,
    );

    expect(html).toContain("物理空间要等废纸篓清空才释放");
    expect(html).toContain("2026年9月");
    expect(html).toContain("1 条");
    expect(html).toContain("使用中，暂不移除");
    expect(html).not.toContain("移入废纸篓</button>");
    expect(html).toContain("修一下登录");
    expect(html).toContain("~/work/package-manager");
  });

  it("offers removal for a record that is not in use", () => {
    const html = renderToStaticMarkup(
      <SessionRecordsPage
        error={null}
        homeDirectory="/Users/example"
        onRefresh={() => {}}
        onRemove={async () => ({ moved: 1, failed: 0, message: null })}
        onRemoveOlder={async () => ({ moved: 0, failed: 0, message: null })}
        scan={{
          ...scan,
          codex: {
            ...codex,
            records: [{ ...codex.records[0], id: "free.jsonl", title: "可以移走", inUse: false }],
          },
        }}
        scanning={false}
      />,
    );

    expect(html).toContain("可以移走");
    expect(html).toContain("移入废纸篓");
  });

  it("shows an empty Codex section when the sessions directory is missing", () => {
    const html = renderToStaticMarkup(
      <SessionRecordsPage
        error={null}
        homeDirectory={null}
        onRefresh={() => {}}
        onRemove={async () => ({ moved: 0, failed: 0, message: null })}
        onRemoveOlder={async () => ({ moved: 0, failed: 0, message: null })}
        scan={{
          codex: { ...codex, status: "Missing", records: [] },
          claude: scan.claude,
        }}
        scanning={false}
      />,
    );

    expect(html).toContain("没有 Codex 会话记录");
    expect(html).toContain(">Claude");
  });

  it("keeps the Codex list visible when Claude fails", () => {
    const html = renderToStaticMarkup(
      <SessionRecordsPage
        error={null}
        homeDirectory="/Users/example"
        onRefresh={() => {}}
        onRemove={async () => ({ moved: 0, failed: 0, message: null })}
        onRemoveOlder={async () => ({ moved: 0, failed: 0, message: null })}
        initialSource="claude"
        scan={{
          codex,
          claude: {
            directory: "/Users/example/.claude/projects",
            status: "Failed",
            message: "无法读取会话记录目录",
            records: [],
          },
        }}
        scanning={false}
      />,
    );

    expect(html).toContain("Claude 会话记录读取失败");
    expect(html).toContain("没有 Claude 会话记录");
    expect(html).toContain(">Codex");
  });
});
