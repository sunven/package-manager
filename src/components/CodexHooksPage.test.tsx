// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CodexHooksPage } from "./CodexHooksPage";
import { useCodexHooks } from "../hooks/useCodexHooks";
import { useCodexPlugins } from "../hooks/useCodexPlugins";
import { codexHookScanFixture } from "../test/codexHookFixtures";
import { codexPluginFixture } from "../test/codexPluginFixtures";
import type { CodexHookScan } from "../codexHooks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

function Harness() {
  const state = useCodexHooks(true);
  return <CodexHooksPage {...state} onRefresh={() => void state.refresh()} onSetEnabled={state.setEnabled} onShowPlugins={vi.fn()} />;
}

describe("Codex hooks management", () => {
  it("shows full details and native trust states without enabling untrusted hooks", async () => {
    mockedInvoke.mockResolvedValue(codexHookScanFixture());
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /PostToolUse.*查看配置详情/ }));
    expect(screen.getByText("Edit|Write|apply_patch")).toBeTruthy();
    expect(screen.getByText("/Users/example/.codex/plugins/cache/team-tools/review/local/hooks/hooks.json")).toBeTruthy();
    expect(screen.getByText(/在 Codex CLI 输入 \/hooks/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^禁用 SessionStart/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("workspace / load_context")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "信任" })).toBeNull();
  });

  it("confirms the exact hook, cancels without writing and restores focus", async () => {
    mockedInvoke.mockResolvedValue(codexHookScanFixture());
    render(<Harness />);
    const trigger = await screen.findByRole("button", { name: /^禁用 Stop/ });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Stop · 用户配置")).toBeTruthy();
    expect(within(dialog).getByText("/Users/example/scripts/notify.sh")).toBeTruthy();
    expect(within(dialog).getByText("启用 → 禁用")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("saves only after confirmation and reads the actual persisted state", async () => {
    const after = codexHookScanFixture();
    after.snapshotId = "hooks-2";
    after.hooks[1].enabled = true;
    mockedInvoke.mockResolvedValueOnce(codexHookScanFixture())
      .mockResolvedValueOnce({ status: "Saved", message: "配置已保存，信任记录保持不变。" })
      .mockResolvedValueOnce(after);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^启用 PostToolUse/ }));
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("set_codex_hook_enabled", {
      request: { snapshotId: "hooks-1", key: after.hooks[1].key, enabled: true },
    }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("button", { name: /^禁用 PostToolUse/ })).toBeTruthy();
    expect(mockedInvoke.mock.calls.map(([method]) => method)).toEqual(["scan_codex_hooks", "set_codex_hook_enabled", "scan_codex_hooks"]);
  });

  it("keeps a saved result separate from a failed reload and revokes old write eligibility", async () => {
    mockedInvoke.mockResolvedValueOnce(codexHookScanFixture())
      .mockResolvedValueOnce({ status: "Saved", message: "配置已保存" })
      .mockRejectedValueOnce(new Error("CLI 读取超时"));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^禁用 Stop/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    expect(await screen.findByText("配置已保存，但清单刷新失败")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText(/下方为上次结果，已过期/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^禁用 Stop/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^启用 Stop/ })).toBeNull();
  });

  it("refreshes conflicts without automatically retrying the change", async () => {
    mockedInvoke.mockResolvedValueOnce(codexHookScanFixture())
      .mockResolvedValueOnce({ status: "Conflict", message: "配置已变化" })
      .mockResolvedValueOnce(codexHookScanFixture());
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^禁用 Stop/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    expect(await screen.findByText("设置已变化，请重新确认")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockedInvoke.mock.calls.filter(([method]) => method === "set_codex_hook_enabled")).toHaveLength(1);
  });

  it.each(["MissingCli", "Incompatible", "Failed"] as const)("does not confuse %s with an empty inventory", async (status) => {
    mockedInvoke.mockResolvedValue({ ...codexHookScanFixture(), snapshotId: null, hooks: [], status, featureEnabled: null, message: "具体读取错误" });
    render(<Harness />);
    expect(await screen.findByText("具体读取错误")).toBeTruthy();
    expect(screen.queryByText(/当前范围未返回 Hooks/)).toBeNull();
  });

  it("distinguishes the global switch from an empty inventory and links to plugin management", async () => {
    const onShowPlugins = vi.fn();
    render(<CodexHooksPage scan={{ ...codexHookScanFixture(), hooks: [], snapshotId: null, featureEnabled: false }} scanning={false} saving={false} error={null} result={null} onRefresh={vi.fn()} onSetEnabled={vi.fn()} onShowPlugins={onShowPlugins} />);
    expect(screen.getByText("Hooks 总开关已关闭")).toBeTruthy();
    expect(screen.queryByText(/当前范围未返回 Hooks/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "前往插件市场" }));
    expect(onShowPlugins).toHaveBeenCalledOnce();
  });

  it("retains warnings and prevents writes when configuration or inventory is incomplete", async () => {
    mockedInvoke.mockResolvedValue({
      ...codexHookScanFixture(), snapshotId: null, configError: "用户配置不可读",
      warnings: ["同层使用两种表示"], message: "清单可能不完整",
    });
    render(<Harness />);
    expect(await screen.findByText("同层使用两种表示")).toBeTruthy();
    expect(screen.getByText("用户配置无法核实")).toBeTruthy();
    expect(screen.getByText("Hooks 清单尚未完整核实")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^禁用 Stop/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("freezes the reviewed identity when a new scan arrives", async () => {
    const onSetEnabled = vi.fn().mockResolvedValue(undefined);
    const props = { scan: codexHookScanFixture(), scanning: false, saving: false, error: null, result: null, onRefresh: vi.fn(), onSetEnabled, onShowPlugins: vi.fn() };
    const view = render(<CodexHooksPage {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^禁用 Stop/ }));
    const next = codexHookScanFixture();
    next.snapshotId = "new-snapshot";
    next.hooks[0].command = "changed-command";
    view.rerender(<CodexHooksPage {...props} scan={next} />);
    expect(within(screen.getByRole("alertdialog")).getByText("/Users/example/scripts/notify.sh")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(onSetEnabled).toHaveBeenCalledExactlyOnceWith({ snapshotId: "hooks-1", key: props.scan.hooks[0].key, enabled: false }));
  });

  it("loads lazily, serializes requests, and rereads after an invalidation", async () => {
    let resolve!: (scan: CodexHookScan) => void;
    mockedInvoke.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const hook = renderHook(({ active, revision }) => useCodexHooks(active, revision), { initialProps: { active: false, revision: 0 } });
    expect(mockedInvoke).not.toHaveBeenCalled();
    hook.rerender({ active: true, revision: 0 });
    await act(async () => {
      await hook.result.current.refresh();
      await hook.result.current.setEnabled({ snapshotId: "old", key: "not-shown", enabled: true });
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    await act(async () => resolve(codexHookScanFixture()));
    hook.rerender({ active: false, revision: 1 });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    mockedInvoke.mockResolvedValue(codexHookScanFixture());
    hook.rerender({ active: true, revision: 1 });
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledTimes(2));
  });

  it("invalidates the hook inventory after a plugin enablement attempt", async () => {
    mockedInvoke.mockImplementation(async (method) => {
      if (method === "scan_codex_plugins") return codexPluginFixture();
      if (method === "set_codex_plugin_enabled") return { status: "Saved", message: "saved" };
      return codexHookScanFixture();
    });
    const hook = renderHook(({ active }) => {
      const plugins = useCodexPlugins(!active);
      const hooks = useCodexHooks(active, plugins.hookRevision);
      return { plugins, hooks };
    }, { initialProps: { active: true } });
    await waitFor(() => expect(hook.result.current.hooks.scan).toBeTruthy());
    hook.rerender({ active: false });
    await waitFor(() => expect(hook.result.current.plugins.scan).toBeTruthy());
    await act(async () => hook.result.current.plugins.setEnabled({ snapshotId: "scan-1", pluginId: "writer@personal", enabled: false }));
    hook.rerender({ active: true });
    await waitFor(() => expect(mockedInvoke.mock.calls.filter(([method]) => method === "scan_codex_hooks")).toHaveLength(2));
  });
});
