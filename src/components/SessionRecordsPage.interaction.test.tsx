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
  render(<SessionRecordsPage scan={scan} scanningSources={{ codex: false, claude: false }} error={null} homeDirectory={null} onRefresh={vi.fn()} onRemove={vi.fn().mockResolvedValue(removalResult())} onRemoveOlder={age} onRemoveSelected={selected} {...overrides} />);
  return { selected, age };
}

describe("session selection boundaries", () => {
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
