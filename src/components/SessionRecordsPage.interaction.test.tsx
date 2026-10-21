// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSessionRecords } from "../hooks/useSessionRecords";
import { useOpenCodeSessions } from "../hooks/useOpenCodeSessions";
import { SessionRecordsPage } from "./SessionRecordsPage";
import { removalResult } from "../test/fixtures";
import type { OpenCodeDeletionResult, OpenCodeSessionScan, SessionRecordScan, SessionRemovalResult, SessionSourceId } from "../sessionRecords";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const scan: SessionRecordScan = {
  codex: { directory: "/codex/sessions", status: "Ready", message: null, records: [
    { id: "alpha.jsonl", title: "Alpha project", workingDirectory: "/code/alpha", lastActivityMs: 1, bytes: 100, inUse: false },
    { id: "beta.jsonl", title: "Beta project", workingDirectory: "/code/beta", lastActivityMs: 1, bytes: 200, inUse: false },
    { id: "busy.jsonl", title: "Busy project", workingDirectory: null, lastActivityMs: 1, bytes: 300, inUse: true },
  ] },
  claude: { directory: "/claude/projects", status: "Missing", records: [], message: null },
};

const openCodeScan: OpenCodeSessionScan = {
  status: "ready",
  message: null,
  activeSessionIds: [],
  activityMessage: null,
  records: [
    { id: "ses_parent", title: "Parent session", lastActivityMs: 20, workingDirectory: "/work/project", archived: false, parentId: null, parentTitle: null },
    { id: "ses_child", title: "Archived child", lastActivityMs: 30, workingDirectory: "/work/project/subproject", archived: true, parentId: "ses_parent", parentTitle: "Parent session" },
  ],
};

type Options = Partial<Pick<Parameters<typeof SessionRecordsPage>[0], "initialSource" | "homeDirectory" | "nowMs">> & {
  scan?: SessionRecordScan;
  openCodeScan?: OpenCodeSessionScan;
  onOpenOpenCode?: (id: string) => Promise<string | null>;
  onDeleteOpenCode?: (id: string) => Promise<string | null>;
  onDeleteOpenCodeMany?: (ids: string[]) => Promise<OpenCodeDeletionResult>;
  onRefreshOpenCode?: () => void;
  onRemove?: (source: SessionSourceId, id: string) => Promise<SessionRemovalResult>;
  onRemoveSelected?: (source: SessionSourceId, ids: string[]) => Promise<SessionRemovalResult>;
};

async function setup(overrides: Options = {}) {
  const selected = vi.fn().mockResolvedValue(removalResult({ skipped: 1, items: [{ id: "beta.jsonl", status: "Skipped", reason: "InUse", message: null }] }));
  const age = vi.fn().mockResolvedValue(removalResult());
  const fixtures = { scan, openCodeScan: { status: "ready", records: [], message: null, activeSessionIds: [], activityMessage: null } as OpenCodeSessionScan, ...overrides };
  mockedInvoke.mockImplementation(async (command, args) => {
    const params = args as { source: SessionSourceId; id: string; ids: string[]; days: 7 | 30; sessionId: string; sessionIds: string[] };
    switch (command) {
      case "scan_session_records": return fixtures.scan;
      case "scan_session_source": return fixtures.scan[params.source];
      case "scan_opencode_sessions": fixtures.onRefreshOpenCode?.(); return fixtures.openCodeScan;
      case "remove_session_record": return fixtures.onRemove?.(params.source, params.id) ?? removalResult();
      case "remove_session_records_older_than": return age(params.source, params.days);
      case "remove_session_records": return (fixtures.onRemoveSelected ?? selected)(params.source, params.ids);
      case "open_opencode_session": {
        const error = await fixtures.onOpenOpenCode?.(params.sessionId);
        if (error) throw new Error(error);
        return;
      }
      case "delete_opencode_session": {
        const error = await fixtures.onDeleteOpenCode?.(params.sessionId);
        if (error) throw new Error(error);
        return;
      }
      case "delete_opencode_sessions": return fixtures.onDeleteOpenCodeMany?.(params.sessionIds) ?? { preflightError: null, items: [] };
      case "delete_opencode_sessions_older_than": return { preflightError: null, items: params.sessionIds.map((id) => ({ id, status: "deleted", message: null })) };
      default: throw new Error(`Unexpected command: ${command}`);
    }
  });
  let records!: ReturnType<typeof useSessionRecords>;
  let openCode!: ReturnType<typeof useOpenCodeSessions>;
  function Harness({ visible = true }: { visible?: boolean }) {
    records = useSessionRecords(true);
    openCode = useOpenCodeSessions(true);
    return visible ? <SessionRecordsPage records={records} openCode={openCode} homeDirectory={fixtures.homeDirectory ?? null} initialSource={fixtures.initialSource} nowMs={fixtures.nowMs} /> : null;
  }
  const { rerender } = render(<Harness />);
  await waitFor(() => expect(records.scan).not.toBeNull());
  await waitFor(() => expect(openCode.scan).not.toBeNull());
  vi.clearAllMocks();
  return { selected, age,
    updateScan: async (next: SessionRecordScan) => { fixtures.scan = next; await act(async () => { await records.refresh(); }); },
    showPage: (visible: boolean) => rerender(<Harness visible={visible} />),
  };
}

describe("session selection boundaries", () => {
  it("collapses OpenCode months and reviews age targets from the entire source despite search", async () => {
    const nowMs = new Date(2026, 9, 21, 12).getTime();
    await setup({ initialSource: "opencode", openCodeScan, nowMs });
    const month = screen.getByRole("button", { name: /1970年1月/ });
    fireEvent.click(month);
    expect(screen.queryByRole("checkbox", { name: "选择 Parent session" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "按最后活动时间" }));
    expect(screen.getByRole("checkbox", { name: "选择 Parent session" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "按大小" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 OpenCode 会话" }), { target: { value: "no matches" } });
    fireEvent.click(screen.getByRole("button", { name: "永久删除 30 天前的记录" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/整个 OpenCode 来源/)).toBeTruthy();
    expect(within(dialog).getByRole("list", { name: "待永久删除的 OpenCode 会话" }).children).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_opencode_sessions_older_than", {
      sessionIds: ["ses_parent"], cutoffMs: nowMs - 30 * 24 * 60 * 60 * 1000,
      expectedRecords: [{ id: "ses_parent", parentId: null }, { id: "ses_child", parentId: "ses_parent" }],
    }));
  });

  it("keeps OpenCode metadata visible and disables age actions when activity cannot be read", async () => {
    await setup({ initialSource: "opencode", openCodeScan: { ...openCodeScan, activeSessionIds: null, activityMessage: "无法核对运行状态" } });
    expect(screen.getByRole("checkbox", { name: "选择 Parent session" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "永久删除 7 天前的记录" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "永久删除 30 天前的记录" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("OpenCode 运行状态暂不可读取")).toBeTruthy();
  });

  it("filters OpenCode records and opens the selected session", async () => {
    const onOpenOpenCode = vi.fn().mockResolvedValue(null);
    await setup({ initialSource: "opencode", openCodeScan, onOpenOpenCode });

    const list = screen.getByLabelText("OpenCode 会话记录");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByText("Parent session")).toHaveLength(2);
    expect(within(list).getByText("已归档")).toBeTruthy();
    expect(within(list).queryByText("会话 ID")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 OpenCode 会话" }), { target: { value: "subproject" } });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "已归档" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);

    fireEvent.click(within(list).getByRole("button", { name: "在 OpenCode 中打开" }));
    await waitFor(() => expect(onOpenOpenCode).toHaveBeenCalledExactlyOnceWith("ses_child"));
  });

  it("requires confirmation before permanently deleting an OpenCode session and its children", async () => {
    const onDeleteOpenCode = vi.fn().mockResolvedValue(null);
    const onRefreshOpenCode = vi.fn();
    await setup({ initialSource: "opencode", openCodeScan, onDeleteOpenCode, onRefreshOpenCode });

    fireEvent.click(screen.getByRole("button", { name: "永久删除 Parent session" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/永久删除「Parent session」及其全部子会话/)).toBeTruthy();
    expect(within(dialog).getByText(/当前列表中可见 1 条子会话/)).toBeTruthy();
    expect(onDeleteOpenCode).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDeleteOpenCode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "永久删除 Parent session" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(onDeleteOpenCode).toHaveBeenCalledExactlyOnceWith("ses_parent"));
    await waitFor(() => expect(onRefreshOpenCode).toHaveBeenCalledExactlyOnceWith());
    expect(await screen.findByText("OpenCode 会话已永久删除")).toBeTruthy();
  });

  it("previews cascade descendants and clears OpenCode selection when filters change", async () => {
    await setup({ initialSource: "opencode", openCodeScan });

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Parent session" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除 1 条" }));
    const dialog = screen.getByRole("alertdialog");
    const list = within(dialog).getByRole("list", { name: "待永久删除的 OpenCode 会话" });
    expect(within(dialog).getByText(/将永久删除 2 条会话，其中已选择 1 条/)).toBeTruthy();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("级联删除")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Parent session" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 OpenCode 会话" }), { target: { value: "Archived" } });
    expect((screen.getByRole("button", { name: "永久删除 0 条" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("deduplicates selected parent-child sessions through the backend and reports the batch result", async () => {
    const onDeleteOpenCode = vi.fn().mockResolvedValue(null);
    const onDeleteOpenCodeMany = vi.fn().mockResolvedValue({
      preflightError: null,
      items: [{ id: "ses_parent", status: "deleted", message: null }],
    });
    const onRefreshOpenCode = vi.fn();
    await setup({ initialSource: "opencode", openCodeScan, onDeleteOpenCode, onDeleteOpenCodeMany, onRefreshOpenCode });

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Parent session" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Archived child" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除 2 条" }));
    const dialog = screen.getByRole("alertdialog");
    const list = within(dialog).getByRole("list", { name: "待永久删除的 OpenCode 会话" });
    expect(within(dialog).getByText(/将永久删除 2 条会话，其中已选择 2 条/)).toBeTruthy();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(onDeleteOpenCodeMany).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(onDeleteOpenCodeMany).toHaveBeenCalledExactlyOnceWith(["ses_parent", "ses_child"]));
    expect(onDeleteOpenCode).not.toHaveBeenCalled();
    await waitFor(() => expect(onRefreshOpenCode).toHaveBeenCalledExactlyOnceWith());
    expect(await screen.findByText("OpenCode 会话已永久删除")).toBeTruthy();
  });

  it("does not refresh after a batch preflight cancels all deletions", async () => {
    const onDeleteOpenCodeMany = vi.fn().mockResolvedValue({
      preflightError: "未删除任何会话。「ses_parent」仍在运行。",
      items: [],
    });
    const onRefreshOpenCode = vi.fn();
    await setup({ initialSource: "opencode", openCodeScan, onDeleteOpenCodeMany, onRefreshOpenCode });

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Parent session" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除 1 条" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "永久删除" }));
    expect(await screen.findByText("OpenCode 批量删除已取消")).toBeTruthy();
    expect(screen.getByText(/仍在运行/)).toBeTruthy();
    expect(onRefreshOpenCode).not.toHaveBeenCalled();
  });

  it("preserves failed and unattempted selections through a failed refresh and retries only reading", async () => {
    const onDeleteOpenCodeMany = vi.fn().mockResolvedValue({ preflightError: null, items: [
      { id: "ses_parent", status: "deleted", message: null },
      { id: "ses_failed", status: "failed", message: "仍在运行" },
      { id: "ses_pending", status: "notAttempted", message: "前一项失败" },
    ] });
    const onRefreshOpenCode = vi.fn();
    await setup({ initialSource: "opencode", openCodeScan: { ...openCodeScan, records: [
      ...openCodeScan.records,
      { ...openCodeScan.records[0], id: "ses_failed", title: "Failed session" },
      { ...openCodeScan.records[0], id: "ses_pending", title: "Unattempted session" },
    ] }, onDeleteOpenCodeMany, onRefreshOpenCode });
    onRefreshOpenCode.mockImplementationOnce(() => { throw new Error("service stopped"); });

    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除 4 条" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "永久删除" }));
    expect(await screen.findByText("OpenCode 批量删除部分完成")).toBeTruthy();
    expect(await screen.findByText(/列表刷新失败：service stopped/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "选择 Failed session" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "选择 Unattempted session" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("checkbox", { name: "选择 Archived child" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试刷新" }));
    expect(await screen.findByText("列表已刷新。")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "选择 Failed session" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "选择 Unattempted session" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "选择 Parent session" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("checkbox", { name: "选择 Archived child" }).getAttribute("aria-checked")).toBe("false");
    expect(onDeleteOpenCodeMany).toHaveBeenCalledTimes(1);
    expect(onRefreshOpenCode).toHaveBeenCalledTimes(2);
  });

  it("keeps an executing operation and its result when the page is rebuilt", async () => {
    let resolve!: (value: string | null) => void;
    const onDeleteOpenCode = vi.fn().mockImplementation(() => new Promise<string | null>((yes) => { resolve = yes; }));
    const { showPage } = await setup({ initialSource: "opencode", openCodeScan, onDeleteOpenCode });
    fireEvent.click(screen.getByRole("button", { name: "永久删除 Parent session" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(onDeleteOpenCode).toHaveBeenCalledTimes(1));
    showPage(false);
    showPage(true);
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", { name: "正在删除" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    await act(async () => { resolve(null); });
    expect(await screen.findByText("OpenCode 会话已永久删除")).toBeTruthy();
    showPage(false);
    showPage(true);
    expect(screen.getByText("OpenCode 会话已永久删除")).toBeTruthy();
    expect(onDeleteOpenCode).toHaveBeenCalledTimes(1);
  });

  it("names a single removal target and explains recovery before confirmation", async () => {
    const onRemove = vi.fn().mockResolvedValue(removalResult());
    await setup({ onRemove });
    fireEvent.click(screen.getByRole("button", { name: "将 Alpha project 移入废纸篓" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/清空废纸篓前可恢复记录/)).toBeTruthy();
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it.each([["codex", "Codex"], ["claude", "Claude"]] as const)("previews and confirms only the selected %s records", async (source, label) => {
    const title = `核对开发环境 🛠️ ${"包含很长标题的会话记录".repeat(10)}`;
    const records = [
      { ...scan.codex.records[0], title, workingDirectory: "/Users/example/work/package-manager", lastActivityMs: new Date(2026, 8, 24, 15).getTime() },
      { ...scan.codex.records[1], title: "补充记录", workingDirectory: null, lastActivityMs: null },
      { ...scan.codex.records[0], id: "unselected.jsonl", title: "未选择的记录" },
      scan.codex.records[2],
    ];
    const { selected, age } = await setup({
      homeDirectory: "/Users/example",
      initialSource: source,
      scan: { ...scan, [source]: { ...scan[source], status: "Ready", records } },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: `选择 ${title}` }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 补充记录" }));
    fireEvent.click(screen.getByRole("button", { name: "移入废纸篓 2 条" }));

    const dialog = screen.getByRole("alertdialog");
    const list = within(dialog).getByRole("list", { name: `${label} 待移入废纸篓的会话记录` });
    expect(within(dialog).getByText(new RegExp(`选中的 2 条 ${label} 会话记录`))).toBeTruthy();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText(title)).toBeTruthy();
    expect(within(list).getByText("~/work/package-manager")).toBeTruthy();
    expect(within(list).getByText("2026-09-24 15:00")).toBeTruthy();
    expect(within(list).getByText("没有工作目录")).toBeTruthy();
    expect(within(list).getByText("没有最后活动时间")).toBeTruthy();
    expect(within(list).queryByText("未选择的记录")).toBeNull();
    expect(within(list).queryByText("Busy project")).toBeNull();
    expect(within(dialog).getByText(/清空废纸篓前可恢复记录/)).toBeTruthy();
    expect(selected).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "移入废纸篓 2 条" })));
    expect(selected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "移入废纸篓 2 条" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "移入废纸篓" }));
    await waitFor(() => expect(selected).toHaveBeenCalledExactlyOnceWith(source, ["alpha.jsonl", "beta.jsonl"]));
    expect(age).not.toHaveBeenCalled();
  });

  it("keeps the reviewed summaries and submitted IDs stable when the scan changes", async () => {
    const { selected, updateScan } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果中可移除记录" }));
    fireEvent.click(screen.getByRole("button", { name: "移入废纸篓 2 条" }));
    await updateScan({ ...scan, codex: { ...scan.codex, records: [
      { ...scan.codex.records[1], title: "更新后的标题", inUse: true },
      { ...scan.codex.records[0], id: "new.jsonl", title: "新发现的记录" },
    ] } });

    const dialog = screen.getByRole("alertdialog");
    const list = within(dialog).getByRole("list", { name: "Codex 待移入废纸篓的会话记录" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Alpha project")).toBeTruthy();
    expect(within(list).getByText("Beta project")).toBeTruthy();
    expect(within(list).queryByText("更新后的标题")).toBeNull();
    expect(within(list).queryByText("新发现的记录")).toBeNull();
    expect(within(dialog).getByText(/使用中或已不符合移除条件的记录会跳过/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "移入废纸篓" }));
    await waitFor(() => expect(selected).toHaveBeenCalledExactlyOnceWith("codex", ["alpha.jsonl", "beta.jsonl"]));
  });

  it("clears hidden selections, selects visible eligible records and explains skipped results", async () => {
    const { selected } = await setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Alpha project" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "beta" } });
    expect((screen.getByRole("button", { name: "移入废纸篓 0 条" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果中可移除记录" }));
    fireEvent.click(screen.getByRole("button", { name: "移入废纸篓 1 条" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "移入废纸篓" }));
    await waitFor(() => expect(selected).toHaveBeenCalledWith("codex", ["beta.jsonl"]));
    await waitFor(() => expect(screen.getByText(/跳过 1 条/)).toBeTruthy());
    fireEvent.click(screen.getByText("查看逐条结果（1）"));
    expect(screen.getByText(/使用中，留在原处/)).toBeTruthy();
  });

  it("keeps age removal scoped to the whole source despite a search", async () => {
    const { age } = await setup();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "移除 7 天前的记录" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/当前符合条件的有 2 条/)).toBeTruthy();
    expect(within(dialog).getByText(/不受搜索和状态筛选限制/)).toBeTruthy();
    expect(within(dialog).getByText(/清空废纸篓前可恢复记录/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "移入废纸篓" }));
    await waitFor(() => expect(age).toHaveBeenCalledWith("codex", 7));
  });

  it("reports a rejected operation without inventing a failed record", async () => {
    await setup({ onRemoveSelected: vi.fn().mockRejectedValue(new Error("无法读取使用状态")) });
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Alpha project" }));
    fireEvent.click(screen.getByRole("button", { name: "移入废纸篓 1 条" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "移入废纸篓" }));
    await waitFor(() => expect(screen.getByText(/移除未能执行/)).toBeTruthy());
    expect(screen.getByText(/无法读取使用状态/)).toBeTruthy();
    expect(screen.queryByText(/失败 1 条/)).toBeNull();
  });
});
