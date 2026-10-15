// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CodexMarketplacesPage } from "./CodexMarketplacesPage";
import { useCodexMarketplaces } from "../hooks/useCodexMarketplaces";
import { useCodexPlugins } from "../hooks/useCodexPlugins";
import { codexMarketplaceFixture } from "../test/codexMarketplaceFixtures";
import { codexPluginFixture } from "../test/codexPluginFixtures";
import type { CodexMarketplaceResult } from "../codexMarketplaces";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
const plugins = { scan: codexPluginFixture(), scanning: false, saving: false, error: null, result: null, onSetEnabled: vi.fn() };
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); });

function Harness() {
  const state = useCodexMarketplaces(true);
  return <CodexMarketplacesPage {...state} plugins={plugins} onRefresh={() => void state.refresh()} onChange={state.change} />;
}

function setup() {
  mockedInvoke.mockResolvedValue(codexMarketplaceFixture());
  render(<Harness />);
  return screen.findByRole("button", { name: "同步市场 team-tools" });
}

describe("Codex marketplace management", () => {
  it("shows all sources, limits writes by ownership, and keeps local sources free of Git refresh", async () => {
    await setup();
    expect(screen.getByRole("button", { name: "移除市场 local-tools" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "同步市场 local-tools" })).toBeNull();
    expect(screen.queryByRole("button", { name: "移除市场 managed-tools" })).toBeNull();
    expect(screen.getByText(/归属/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledTimes(2));
    expect(mockedInvoke.mock.calls.every(([command]) => command === "scan_codex_marketplaces")).toBe(true);
  });

  it("confirms refresh scope including disabled plugins and restores focus on cancel", async () => {
    const trigger = await setup();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/即使已禁用/)).toBeTruthy();
    expect(within(dialog).getByText("team-tools")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("adds only on explicit submit and treats duplicate sources as already existing", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "添加市场源" }));
    fireEvent.change(screen.getByLabelText("Git 仓库地址"), { target: { value: "owner/market" } });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    mockedInvoke.mockResolvedValueOnce({ status: "AlreadyExists", message: "该市场来源已存在。", executed: true }).mockResolvedValueOnce(codexMarketplaceFixture());
    fireEvent.click(screen.getByRole("button", { name: "确认添加" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("change_codex_marketplace", { request: { snapshotId: "market-scan-1", operation: "Add", sourceKind: "git", source: "owner/market" } }));
    expect(await screen.findByText("市场来源已存在")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("form", { name: "添加市场源" })).toBeNull());
  });

  it("submits Git ref and multiple sparse paths as structured optional arguments", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "添加市场源" }));
    fireEvent.change(screen.getByLabelText("Git 仓库地址"), { target: { value: "owner/market" } });
    fireEvent.click(screen.getByText("Git 高级选项"));
    fireEvent.change(screen.getByLabelText("分支或标签（可选）"), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText("稀疏检出目录（每行一个，可选）"), { target: { value: ".agents/plugins\nplugins" } });
    mockedInvoke.mockResolvedValueOnce({ status: "Succeeded", message: "完成", executed: true }).mockResolvedValueOnce(codexMarketplaceFixture());
    fireEvent.click(screen.getByRole("button", { name: "确认添加" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("change_codex_marketplace", { request: { snapshotId: "market-scan-1", operation: "Add", sourceKind: "git", source: "owner/market", refName: "main", sparsePaths: [".agents/plugins", "plugins"] } }));
  });

  it("uses a selected local directory and cancels without adding", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "添加市场源" }));
    fireEvent.click(screen.getByRole("radio", { name: "本地目录" }));
    mockedInvoke.mockResolvedValueOnce("/Users/example/Local Market");
    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    await waitFor(() => expect((screen.getByLabelText("市场根目录") as HTMLInputElement).value).toBe("/Users/example/Local Market"));
    fireEvent.click(screen.getByRole("button", { name: "取消添加" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "添加市场源" })));
    expect(mockedInvoke.mock.calls.some(([command]) => command === "change_codex_marketplace")).toBe(false);
  });

  it("allows removal with no plugin-count gate, preserving the frozen confirmation", async () => {
    const onChange = vi.fn().mockResolvedValue({ status: "Succeeded", message: "已移除", executed: true });
    const props = { scan: codexMarketplaceFixture(), scanning: false, pending: false, error: null, result: null, onRefresh: vi.fn(), onChange };
    const view = render(<CodexMarketplacesPage {...props} plugins={plugins} />);
    fireEvent.click(screen.getByRole("button", { name: "移除市场 team-tools" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("本地副本");
    expect(screen.getByRole("alertdialog").textContent).toContain("不会追加卸载插件");
    const next = codexMarketplaceFixture(); next.snapshotId = "new"; next.marketplaces[0].name = "changed";
    view.rerender(<CodexMarketplacesPage {...props} plugins={plugins} scan={next} />);
    expect(within(screen.getByRole("alertdialog")).getByText("team-tools")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith({ snapshotId: "market-scan-1", marketplaceId: "team-tools", operation: "Remove" }));
  });

  it("keeps success separate from a returned failed scan and prevents stale operations", async () => {
    await setup();
    mockedInvoke.mockResolvedValueOnce({ status: "Succeeded", message: "市场刷新已完成。", executed: true })
      .mockResolvedValueOnce({ ...codexMarketplaceFixture(), snapshotId: null, status: "Failed", marketplaces: [], message: "网络读取失败" });
    fireEvent.click(screen.getByRole("button", { name: "同步市场 team-tools" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认同步" }));
    expect(await screen.findByText("操作已完成，但清单读取失败")).toBeTruthy();
    expect(screen.getByText(/上次结果，已过期/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect((screen.getByRole("button", { name: "同步市场 team-tools" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["Conflict", "Partial"] as const)("reports %s and re-reads without retrying", async (status) => {
    await setup();
    mockedInvoke.mockResolvedValueOnce({ status, message: "需要重新核对来源", executed: status === "Partial" }).mockResolvedValueOnce(codexMarketplaceFixture());
    fireEvent.click(screen.getByRole("button", { name: "移除市场 local-tools" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认移除" }));
    expect(await screen.findByText(status === "Conflict" ? "来源已变化，请重新确认" : "市场操作部分完成")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "change_codex_marketplace")).toHaveLength(1);
  });

  it.each(["MissingCli", "Incompatible", "Failed"] as const)("does not confuse %s with an empty source list", async (status) => {
    mockedInvoke.mockResolvedValue({ ...codexMarketplaceFixture(), snapshotId: null, status, marketplaces: [], message: "具体读取原因" });
    render(<Harness />);
    expect(await screen.findByText(/具体读取原因/)).toBeTruthy();
    expect(screen.queryByText(/当前没有可见的市场来源/)).toBeNull();
    expect((screen.getByRole("button", { name: "添加市场源" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("provides an add action for an empty successful inventory and disables it on config failure", () => {
    const props = { scan: { ...codexMarketplaceFixture(), marketplaces: [] }, scanning: false, pending: false, error: null, result: null, onRefresh: vi.fn(), onChange: vi.fn() };
    const emptyPlugins = { ...plugins, scan: { ...plugins.scan, plugins: [] } };
    const view = render(<CodexMarketplacesPage {...props} plugins={emptyPlugins} />);
    expect(screen.getByText(/当前没有可见的市场来源/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "添加市场源" }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(<CodexMarketplacesPage {...props} plugins={emptyPlugins} scan={{ ...props.scan, snapshotId: null, configError: "来源无法核实" }} />);
    expect((screen.getByRole("button", { name: "添加市场源" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("retains previous sources after an IPC read error and serializes actions", async () => {
    let resolveChange!: (result: CodexMarketplaceResult) => void;
    mockedInvoke.mockResolvedValueOnce(codexMarketplaceFixture());
    const hook = renderHook(() => useCodexMarketplaces(true));
    await waitFor(() => expect(hook.result.current.scan?.snapshotId).toBe("market-scan-1"));
    mockedInvoke.mockReturnValueOnce(new Promise((resolve) => { resolveChange = resolve; })).mockRejectedValueOnce(new Error("读取失败"));
    let changing!: Promise<CodexMarketplaceResult | null>;
    act(() => { changing = hook.result.current.change({ snapshotId: "market-scan-1", operation: "Remove", marketplaceId: "team-tools" }); });
    await act(async () => { await hook.result.current.refresh(); });
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    await act(async () => { resolveChange({ status: "Succeeded", message: "已移除", executed: true }); await changing; });
    expect(hook.result.current.scan?.marketplaces).toHaveLength(3);
    expect(hook.result.current.scan?.snapshotId).toBeNull();
    expect(hook.result.current.result?.status).toBe("Succeeded");
    expect(hook.result.current.error).toContain("读取失败");
  });

  it("re-reads installed plugins after marketplace mutation even when returning to a cached tab", async () => {
    mockedInvoke.mockImplementation(async (command) => command === "scan_codex_plugins" ? codexPluginFixture()
      : command === "scan_codex_marketplaces" ? codexMarketplaceFixture()
        : { status: "Succeeded", message: "已刷新", executed: true });
    const hook = renderHook(({ installed }) => {
      const markets = useCodexMarketplaces(!installed);
      const plugins = useCodexPlugins(installed, markets.pluginRevision);
      return { markets, plugins };
    }, { initialProps: { installed: true } });
    await waitFor(() => expect(hook.result.current.plugins.scan).not.toBeNull());
    hook.rerender({ installed: false });
    await waitFor(() => expect(hook.result.current.markets.scan).not.toBeNull());
    await act(async () => { await hook.result.current.markets.change({ snapshotId: "market-scan-1", operation: "Refresh", marketplaceId: "team-tools" }); });
    hook.rerender({ installed: true });
    await waitFor(() => expect(mockedInvoke.mock.calls.filter(([command]) => command === "scan_codex_plugins")).toHaveLength(2));
  });
});
