// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexPluginFeedback, CodexPluginList } from "./CodexPluginList";
import { useCodexExtensions } from "../hooks/useCodexExtensions";
import { codexMarketplaceFixture } from "../test/codexMarketplaceFixtures";
import { codexPluginFixture } from "../test/codexPluginFixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: unknown) => command === "scan_codex_marketplaces"
  ? Promise.resolve(codexMarketplaceFixture()) : mockedInvoke(command, args) }));
const mockedInvoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();

afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); });

function Harness({ marketplaceName = "personal" }: { marketplaceName?: string }) {
  const workflow = useCodexExtensions(true, "marketplaces");
  return <>
    <button onClick={() => void workflow.refresh()}>刷新</button>
    <CodexPluginFeedback {...workflow.plugins} />
    <CodexPluginList workflow={workflow} marketplaceName={marketplaceName} onRestoreFocus={vi.fn()} />
  </>;
}

function setupScan(scan = codexPluginFixture()) {
  mockedInvoke.mockResolvedValue(scan);
  render(<Harness />);
  return screen.findByRole("button", { name: "禁用 writer（personal）" });
}

describe("Codex plugin management", () => {
  it("searches and filters catalog entries without treating unavailable details as empty components", async () => {
    const scan = codexPluginFixture();
    scan.plugins[0].installed = false;
    scan.plugins[0].details.description = "编写文档";
    mockedInvoke.mockResolvedValue(scan);
    render(<Harness />);
    await screen.findByRole("button", { name: "安装 writer（personal）" });
    fireEvent.change(screen.getByLabelText("安装状态"), { target: { value: "available" } });
    expect(screen.getByRole("button", { name: "安装 writer（personal）" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "启用 code-review（personal）" })).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索此市场"), { target: { value: "编写文档" } });
    fireEvent.click(screen.getByRole("button", { name: /writer查看插件详情/ }));
    expect(screen.getAllByText("尚不可读取")).toHaveLength(3);
    expect(screen.queryByText("未声明")).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索此市场"), { target: { value: "no-match" } });
    expect(screen.getByText("没有符合搜索或筛选条件的插件。")).toBeTruthy();
  });

  it.each(["Install", "Reinstall", "Uninstall"] as const)("confirms %s and rereads instead of assuming the new state", async (operation) => {
    const before = codexPluginFixture();
    before.plugins[0].installed = operation !== "Install";
    before.plugins[0].defaultEnabled = false;
    const label = operation === "Install" ? "安装" : operation === "Reinstall" ? "重新安装" : "卸载";
    const after = structuredClone(before);
    after.plugins[0].installed = operation !== "Uninstall";
    after.plugins[0].defaultEnabled = operation === "Uninstall" ? null : true;
    mockedInvoke.mockResolvedValueOnce(before).mockResolvedValueOnce({ status: "Succeeded", message: "命令已完成" }).mockResolvedValueOnce(after);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: `${label} writer（personal）` }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("writer（personal）");
    if (operation === "Reinstall") expect(dialog.textContent).toContain("包括当前已禁用的插件");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: `确认${label}` }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("change_codex_plugin", { request: { snapshotId: "scan-1", pluginId: "writer@personal", operation } }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockedInvoke.mock.calls.filter(([cmd]) => cmd === "scan_codex_plugins")).toHaveLength(2);
    expect(screen.getByRole("button", { name: operation === "Uninstall" ? "安装 writer（personal）" : "禁用 writer（personal）" })).toBeTruthy();
  });

  it("blocks NOT_AVAILABLE installation and keeps operation success visible after a failed reread", async () => {
    const scan = codexPluginFixture();
    scan.plugins[0].installed = false;
    scan.plugins[0].installBlockedReason = "市场策略不允许安装此插件。";
    mockedInvoke.mockResolvedValueOnce(scan).mockResolvedValueOnce({ status: "Succeeded", message: "重新安装已完成" }).mockRejectedValueOnce(new Error("offline"));
    render(<Harness />);
    expect((await screen.findByRole("button", { name: "安装 writer（personal）" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重新安装 code-review（personal）" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认重新安装" }));
    expect(await screen.findByText("操作已完成，但清单读取失败")).toBeTruthy();
    expect(screen.getByText("重新安装已完成")).toBeTruthy();
    expect((screen.getByRole("button", { name: "卸载 code-review（personal）" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("confirms the exact plugin and market, cancels without writing and restores focus", async () => {
    const trigger = await setupScan();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("writer（personal）")).toBeTruthy();
    expect(within(dialog).getByText("启用 → 禁用")).toBeTruthy();
    expect(within(dialog).getByText(/项目设置可能覆盖默认值/)).toBeTruthy();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("allows explicit choices for an unknown default and saves only after confirmation", async () => {
    const before = codexPluginFixture();
    const after = codexPluginFixture();
    after.plugins[1].defaultEnabled = true;
    after.snapshotId = "scan-2";
    mockedInvoke.mockResolvedValueOnce(before)
      .mockResolvedValueOnce({ status: "Saved", message: "配置已保存，请在新会话中验证。" })
      .mockResolvedValueOnce(after);
    render(<Harness marketplaceName="community" />);
    fireEvent.click(await screen.findByRole("button", { name: "启用 writer（community）" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("未知（用户未显式设置） → 启用");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("set_codex_plugin_enabled", { request: { snapshotId: "scan-1", pluginId: "writer@community", enabled: true } }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "启用 writer（community）" })).toBeNull();
    expect(screen.getByRole("button", { name: "禁用 writer（community）" })).toBeTruthy();
  });

  it("reports a saved configuration separately from a refresh failure without optimistic state", async () => {
    mockedInvoke.mockResolvedValueOnce(codexPluginFixture())
      .mockResolvedValueOnce({ status: "Saved", message: "配置已保存，请在新会话中验证。" })
      .mockRejectedValueOnce(new Error("CLI 读取超时"));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "禁用 writer（personal）" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    expect(await screen.findByText("配置已保存，但清单刷新失败")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect((screen.getByRole("button", { name: "禁用 writer（personal）" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "启用 writer（personal）" })).toBeNull();
  });

  it("refreshes conflicts and requires a new user action instead of retrying the write", async () => {
    const changed = codexPluginFixture();
    changed.plugins[0].defaultEnabled = false;
    mockedInvoke.mockResolvedValueOnce(codexPluginFixture())
      .mockResolvedValueOnce({ status: "Conflict", message: "用户默认设置已被外部修改，请重新确认。" })
      .mockResolvedValueOnce(changed);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "禁用 writer（personal）" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    expect(await screen.findByText("设置已变化，请重新确认")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "set_codex_plugin_enabled")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "启用 writer（personal）" })).toBeTruthy();
  });

  it.each(["MissingCli", "Incompatible", "Failed"] as const)("does not present %s as an empty inventory", async (status) => {
    mockedInvoke.mockResolvedValue({ ...codexPluginFixture(), snapshotId: null, status, plugins: [], message: "读取失败的具体原因" });
    render(<Harness />);
    expect(await screen.findByText(/读取失败的具体原因/)).toBeTruthy();
    expect(screen.queryByText("该市场暂无插件目录项或已安装插件。")).toBeNull();
    expect(screen.getByText(/插件清单暂不可用/)).toBeTruthy();
  });

  it("shows a successful empty inventory and disables writes when configuration is unreadable", async () => {
    mockedInvoke.mockResolvedValueOnce({ ...codexPluginFixture(), plugins: [] });
    render(<Harness />);
    expect(await screen.findByText("该市场暂无插件目录项或已安装插件。")).toBeTruthy();
    const invalid = codexPluginFixture();
    invalid.snapshotId = null;
    invalid.configError = "配置语法错误";
    invalid.plugins.forEach((plugin) => { plugin.defaultEnabled = null; plugin.readOnlyReason = "配置语法错误"; });
    mockedInvoke.mockResolvedValueOnce(invalid);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("用户默认设置无法读取")).toBeTruthy();
    expect((screen.getByRole("button", { name: "启用 writer（personal）" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("未知（用户未显式设置）")).toBeNull();
  });

});
