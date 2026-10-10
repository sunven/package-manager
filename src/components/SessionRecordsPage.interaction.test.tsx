// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionRecordsPage } from "./SessionRecordsPage";
import { removalResult } from "../test/fixtures";
import type { SessionRecordScan } from "../sessionRecords";

afterEach(cleanup);

const scan: SessionRecordScan = {
  codex: { directory: "/codex/sessions", status: "Ready", message: null, records: [
    { id: "alpha.jsonl", title: "Alpha project", workingDirectory: "/code/alpha", lastActivityMs: 1, bytes: 100, inUse: false },
    { id: "beta.jsonl", title: "Beta project", workingDirectory: "/code/beta", lastActivityMs: 1, bytes: 200, inUse: false },
    { id: "busy.jsonl", title: "Busy project", workingDirectory: null, lastActivityMs: 1, bytes: 300, inUse: true },
  ] },
  claude: { directory: "/claude/projects", status: "Missing", records: [], message: null },
};

function setup(overrides: Partial<Parameters<typeof SessionRecordsPage>[0]> = {}) {
  const selected = vi.fn().mockResolvedValue(removalResult({ skipped: 1, items: [{ id: "beta.jsonl", status: "Skipped", reason: "InUse", message: null }] }));
  const age = vi.fn().mockResolvedValue(removalResult());
  const props = { scan, scanningSources: { codex: false, claude: false }, error: null, homeDirectory: null, onRefresh: vi.fn(), onRemove: vi.fn().mockResolvedValue(removalResult()), onRemoveOlder: age, onRemoveSelected: selected, ...overrides };
  const { rerender } = render(<SessionRecordsPage {...props} />);
  return { selected, age, props, rerender };
}

describe("session selection boundaries", () => {
  it.each([["codex", "Codex"], ["claude", "Claude"]] as const)("previews and confirms only the selected %s records", async (source, label) => {
    const title = `核对开发环境 🛠️ ${"包含很长标题的会话记录".repeat(10)}`;
    const records = [
      { ...scan.codex.records[0], title, workingDirectory: "/Users/example/work/package-manager", lastActivityMs: new Date(2026, 8, 24, 15).getTime() },
      { ...scan.codex.records[1], title: "补充记录", workingDirectory: null, lastActivityMs: null },
      { ...scan.codex.records[0], id: "unselected.jsonl", title: "未选择的记录" },
      scan.codex.records[2],
    ];
    const { selected, age } = setup({
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
    const { selected, props, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果中可移除记录" }));
    fireEvent.click(screen.getByRole("button", { name: "移入废纸篓 2 条" }));
    rerender(<SessionRecordsPage {...props} scan={{ ...scan, codex: { ...scan.codex, records: [
      { ...scan.codex.records[1], title: "更新后的标题", inUse: true },
      { ...scan.codex.records[0], id: "new.jsonl", title: "新发现的记录" },
    ] } }} />);

    const dialog = screen.getByRole("alertdialog");
    const list = within(dialog).getByRole("list", { name: "Codex 待移入废纸篓的会话记录" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Alpha project")).toBeTruthy();
    expect(within(list).getByText("Beta project")).toBeTruthy();
    expect(within(list).queryByText("更新后的标题")).toBeNull();
    expect(within(list).queryByText("新发现的记录")).toBeNull();
    expect(within(dialog).getByText(/动手时仍在使用或已不再是会话记录的会留下/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "移入废纸篓" }));
    await waitFor(() => expect(selected).toHaveBeenCalledExactlyOnceWith("codex", ["alpha.jsonl", "beta.jsonl"]));
  });

  it("clears hidden selections, selects visible eligible records and explains skipped results", async () => {
    const { selected } = setup();
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
    const { age } = setup();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "移除 7 天前（整个 Codex 来源）" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/当前观察到 2 条/)).toBeTruthy();
    expect(within(dialog).getByText(/搜索和状态筛选不限制此范围/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "移入废纸篓" }));
    await waitFor(() => expect(age).toHaveBeenCalledWith("codex", 7));
  });

  it("reports a rejected operation without inventing a failed record", async () => {
    setup({ onRemoveSelected: vi.fn().mockRejectedValue(new Error("无法读取使用状态")) });
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Alpha project" }));
    fireEvent.click(screen.getByRole("button", { name: "移入废纸篓 1 条" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "移入废纸篓" }));
    await waitFor(() => expect(screen.getByText(/移除未能执行/)).toBeTruthy());
    expect(screen.getByText("无法读取使用状态")).toBeTruthy();
    expect(screen.queryByText(/失败 1 条/)).toBeNull();
  });
});
