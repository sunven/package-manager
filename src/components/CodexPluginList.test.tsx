// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CodexPluginFeedback, CodexPluginList, type CodexPluginState } from "./CodexPluginList";
import { useCodexPlugins } from "../hooks/useCodexPlugins";
import { codexPluginFixture } from "../test/codexPluginFixtures";
import type { CodexPluginScan } from "../codexPlugins";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); });

function PluginView(props: CodexPluginState & { onRefresh: () => void; marketplaceName?: string }) {
  return <>
    <button onClick={props.onRefresh}>刷新</button>
    <CodexPluginFeedback {...props} />
    <CodexPluginList {...props} marketplaceName={props.marketplaceName ?? "personal"} blocked={false} onRestoreFocus={vi.fn()} />
  </>;
}

function Harness({ marketplaceName = "personal" }: { marketplaceName?: string }) {
  const state = useCodexPlugins(true);
  return <PluginView {...state} marketplaceName={marketplaceName} onRefresh={() => void state.refresh()} onSetEnabled={state.setEnabled} />;
}

function setupScan(scan = codexPluginFixture()) {
  mockedInvoke.mockResolvedValue(scan);
  render(<Harness />);
  return screen.findByRole("button", { name: "禁用 writer（personal）" });
}

describe("Codex plugin management", () => {
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
    expect(screen.queryByText("该市场暂无已安装插件。")).toBeNull();
    expect(screen.getByText(/插件清单暂不可用/)).toBeTruthy();
  });

  it("shows a successful empty inventory and disables writes when configuration is unreadable", async () => {
    mockedInvoke.mockResolvedValueOnce({ ...codexPluginFixture(), plugins: [] });
    render(<Harness />);
    expect(await screen.findByText("该市场暂无已安装插件。")).toBeTruthy();
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

  it("keeps the approved target frozen while incoming props change", async () => {
    const onSetEnabled = vi.fn().mockResolvedValue(undefined);
    const props = { scan: codexPluginFixture(), scanning: false, saving: false, error: null, result: null, onRefresh: vi.fn(), onSetEnabled };
    const view = render(<PluginView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "禁用 writer（personal）" }));
    const changed = codexPluginFixture();
    changed.snapshotId = "scan-new";
    changed.plugins[0].name = "new-name";
    view.rerender(<PluginView {...props} scan={changed} />);
    expect(within(screen.getByRole("alertdialog")).getByText("writer（personal）")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(onSetEnabled).toHaveBeenCalledExactlyOnceWith({ snapshotId: "scan-1", pluginId: "writer@personal", enabled: false }));
  });

  it("loads on first visit only and serializes refresh and save", async () => {
    let resolveScan!: (value: CodexPluginScan) => void;
    mockedInvoke.mockReturnValueOnce(new Promise((resolve) => { resolveScan = resolve; }));
    const hook = renderHook(({ active }) => useCodexPlugins(active), { initialProps: { active: false } });
    expect(mockedInvoke).not.toHaveBeenCalled();
    hook.rerender({ active: true });
    await act(async () => {
      await hook.result.current.refresh();
      await hook.result.current.setEnabled({ snapshotId: "old", pluginId: "writer@personal", enabled: false });
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    await act(async () => resolveScan(codexPluginFixture()));
    hook.rerender({ active: false });
    hook.rerender({ active: true });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });
});
