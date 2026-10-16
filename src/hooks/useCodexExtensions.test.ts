// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookDefinitionPreview } from "../codexHooks";
import { useCodexExtensions, type CodexMaintenanceIntent } from "./useCodexExtensions";
import { codexMarketplaceFixture } from "../test/codexMarketplaceFixtures";
import { codexPluginFixture } from "../test/codexPluginFixtures";
import { codexHookDefinitionScanFixture } from "../test/codexHookFixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
let markets = codexMarketplaceFixture();
let plugins = codexPluginFixture();
let hooks = codexHookDefinitionScanFixture();
let marketOutcome = { status: "Succeeded" as "Succeeded" | "Partial" | "Failed" | "Conflict", message: "市场同步已执行", executed: true };

beforeEach(() => {
  vi.resetAllMocks();
  markets = codexMarketplaceFixture();
  plugins = codexPluginFixture();
  hooks = codexHookDefinitionScanFixture();
  marketOutcome = { status: "Succeeded", message: "市场同步已执行", executed: true };
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "change_codex_marketplace") {
      if (marketOutcome.executed) { plugins.plugins[0].version = "3.0.0"; hooks.hooks[0].command = "/scripts/after-market.sh"; }
      return marketOutcome;
    }
    if (command === "scan_codex_marketplaces") return structuredClone(markets);
    if (command === "scan_codex_plugins") return structuredClone(plugins);
    if (command === "scan_codex_hooks") return structuredClone(hooks);
    if (command === "change_codex_plugin") {
      plugins.plugins[2].defaultEnabled = true;
      hooks.hooks[0].command = "/scripts/after-plugin.sh";
      return { status: "Succeeded", message: "插件已重新安装" };
    }
    if (command === "set_codex_hook_enabled") {
      plugins.snapshotId = "plugins-after-hook";
      plugins.plugins[0].version = "1.3.0";
      hooks.hooks[0].enabled = false;
      return { status: "Saved", message: "钩子设置已保存" };
    }
    throw new Error(`测试中未预期的命令：${command}`);
  });
});
afterEach(cleanup);

const reads = (command: string) => mockedInvoke.mock.calls.filter(([name]) => name === command).length;

async function openWorkflow() {
  const workflow = renderHook(({ tab }) => useCodexExtensions(true, tab), { initialProps: { tab: "marketplaces" } });
  await waitFor(() => expect(workflow.result.current.plugins.current).toBe(true));
  await waitFor(() => expect(workflow.result.current.marketplaces.current).toBe(true));
  return workflow;
}

async function confirm(workflow: Awaited<ReturnType<typeof openWorkflow>>) {
  const id = workflow.result.current.operation!.id;
  await act(async () => { await workflow.result.current.confirm(id); });
}

describe("Codex 扩展工作流", () => {
  it("总开关关闭时仍可准备用户定义，不依赖启停清单的审批快照", async () => {
    hooks.featureEnabled = false;
    hooks.snapshotId = null;
    hooks.hooks = [];
    const delegate = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (command, args) => command === "prepare_codex_hook_definition"
      ? { planId: "definition-only", action: "create", sourcePath: hooks.directory + "/hooks.json", before: null, after: { command: "echo new" }, enabled: true, impacts: [] }
      : delegate(command, args));
    const workflow = renderHook(() => useCodexExtensions(true, "hooks"));
    await waitFor(() => expect(workflow.result.current.hooks.scan?.definitions?.current).toBe(true));
    await act(async () => {
      expect(await workflow.result.current.request({ kind: "definition", basisRevision: workflow.result.current.hooks.scan!.definitions!.revision,
        action: "create", source: "json", event: "Stop", fields: { kind: "command", command: "echo new" } })).toBeNull();
    });
    expect(workflow.result.current.operation?.phase).toBe("confirming");
  });

  it("插件待确认期间阻止其他维护，取消不会写入或触发失效", async () => {
    const workflow = await openWorkflow();
    await act(async () => {
      expect(await workflow.result.current.request({ kind: "plugin", pluginId: "writer@personal", operation: "Reinstall" })).toBeNull();
    });
    expect(workflow.result.current.operation?.phase).toBe("confirming");
    const id = workflow.result.current.operation!.id;
    await act(async () => {
      expect(await workflow.result.current.request({ kind: "marketplace", operation: "Remove", marketplaceId: "team-tools" })).toMatch(/其他维护操作/);
      expect(await workflow.result.current.request({ kind: "hook", key: hooks.hooks[0].key, enabled: false })).toMatch(/其他维护操作/);
      expect(workflow.result.current.cancel(id)).toBe(true);
    });
    expect(workflow.result.current.operation).toBeNull();
    expect(workflow.result.current.plugins.current).toBe(true);
    expect(reads("change_codex_plugin")).toBe(0);
    expect(reads("scan_codex_plugins")).toBe(1);
    expect(reads("scan_codex_marketplaces")).toBe(1);
  });
  it("定义准备与待确认共用互斥，预览可取消，提交只使用冻结的计划", async () => {
    const workflow = await openWorkflow();
    workflow.rerender({ tab: "hooks" });
    await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    let resolve!: (preview: HookDefinitionPreview) => void;
    const preparing = new Promise<HookDefinitionPreview>((done) => { resolve = done; });
    const delegate = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "prepare_codex_hook_definition") return preparing;
      if (command === "commit_codex_hook_definition") return { status: "Saved", message: "定义已保存" };
      return delegate(command, args);
    });
    const intent = { kind: "definition" as const, basisRevision: workflow.result.current.hooks.scan!.definitions!.revision,
      action: "update" as const, source: "json" as const, id: "hooks.json:Stop:0:0", event: "Stop", fields: { kind: "command" as const, command: "echo changed" } };
    let requesting!: Promise<string | null>;
    act(() => { requesting = workflow.result.current.request(intent); });
    expect(workflow.result.current.operation?.phase).toBe("preparing");
    expect(workflow.result.current.processing).toBe(true);
    await act(async () => { expect(await workflow.result.current.request({ kind: "plugin", pluginId: "writer@personal", operation: "Uninstall" })).toMatch(/其他维护操作/); });
    await act(async () => {
      resolve({ planId: "frozen-plan", action: "update", sourcePath: hooks.directory + "/hooks.json", before: { command: "echo before" }, after: { command: "echo changed" }, enabled: true, impacts: [] });
      expect(await requesting).toBeNull();
    });
    const preview = workflow.result.current.operation;
    expect(preview?.phase).toBe("confirming");
    expect(preview?.kind === "definition" && preview.preview).toEqual(expect.objectContaining({ after: { command: "echo changed" } }));
    expect(preview?.kind === "definition" && preview.preview).not.toHaveProperty("planId");
    act(() => { workflow.result.current.cancel(preview!.id); });
    expect(workflow.result.current.hooks.current).toBe(true);
    expect(reads("commit_codex_hook_definition")).toBe(0);
    await act(async () => { await workflow.result.current.request(intent); });
    await confirm(workflow);
    expect(mockedInvoke).toHaveBeenCalledWith("commit_codex_hook_definition", { request: { planId: "frozen-plan" } });
    expect(workflow.result.current.hooks.result?.status).toBe("Saved");
    expect(workflow.result.current.plugins.current).toBe(false);
  });

  it.each(["Succeeded", "Partial", "Failed"] as const)("市场命令已执行但返回 %s 时仍核对插件并失效钩子", async (status) => {
    const workflow = await openWorkflow();
    workflow.rerender({ tab: "hooks" });
    await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    workflow.rerender({ tab: "marketplaces" });
    marketOutcome = { status, message: "核对实际同步结果", executed: true };
    await act(async () => { expect(await workflow.result.current.request({ kind: "marketplace", operation: "Refresh", marketplaceId: "team-tools" })).toBeNull(); });
    await confirm(workflow);
    expect(workflow.result.current.marketplaces.result?.status).toBe(status);
    expect(workflow.result.current.plugins.scan?.plugins[0].version).toBe("3.0.0");
    expect(workflow.result.current.hooks.current).toBe(false);
    workflow.rerender({ tab: "hooks" });
    await waitFor(() => expect(workflow.result.current.hooks.scan?.hooks[0].command).toBe("/scripts/after-market.sh"));
  });

  it("重新安装后展示实际启用选择，并使已缓存的钩子在进入时重读", async () => {
    const workflow = await openWorkflow();
    workflow.rerender({ tab: "hooks" });
    await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    workflow.rerender({ tab: "marketplaces" });
    await act(async () => { await workflow.result.current.request({ kind: "plugin", pluginId: "code-review@personal", operation: "Reinstall" }); });
    await confirm(workflow);
    expect(workflow.result.current.plugins.result?.status).toBe("Succeeded");
    expect(workflow.result.current.plugins.scan?.plugins[2].defaultEnabled).toBe(true);
    expect(workflow.result.current.hooks.current).toBe(false);
    expect(reads("scan_codex_hooks")).toBe(1);
    workflow.rerender({ tab: "hooks" });
    await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    expect(workflow.result.current.hooks.scan?.hooks[0].command).toBe("/scripts/after-plugin.sh");
  });

  it("保存钩子后撤销缓存插件的写入资格，并在返回市场页时重读", async () => {
    const workflow = await openWorkflow();
    workflow.rerender({ tab: "hooks" });
    await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    await act(async () => {
      expect(await workflow.result.current.request({ kind: "hook", key: hooks.hooks[0].key, enabled: false })).toBeNull();
    });
    await confirm(workflow);
    expect(workflow.result.current.hooks.result?.status).toBe("Saved");
    expect(workflow.result.current.plugins.current).toBe(false);
    expect(workflow.result.current.plugins.scan?.plugins[0].version).toBe("1.2.0");
    expect(reads("scan_codex_plugins")).toBe(1);
    workflow.rerender({ tab: "marketplaces" });
    await waitFor(() => expect(workflow.result.current.plugins.current).toBe(true));
    expect(workflow.result.current.plugins.scan?.plugins[0].version).toBe("1.3.0");
  });

  it("钩子冲突明确未写入时只复核钩子，不撤销插件清单资格", async () => {
    const workflow = await openWorkflow();
    workflow.rerender({ tab: "hooks" });
    await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    const delegate = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (command, args) => command === "set_codex_hook_enabled"
      ? { status: "Conflict", message: "定义已变化，未保存" } : delegate(command, args));
    await act(async () => { await workflow.result.current.request({ kind: "hook", key: hooks.hooks[0].key, enabled: false }); });
    await confirm(workflow);
    expect(workflow.result.current.hooks.result?.status).toBe("Conflict");
    expect(workflow.result.current.hooks.current).toBe(true);
    expect(workflow.result.current.plugins.current).toBe(true);
    expect(reads("set_codex_hook_enabled")).toBe(1);
  });

  it("执行期间不启动手动重读，结果核对失败保留旧内容和已完成结果", async () => {
    const workflow = await openWorkflow();
    let resolve!: (value: typeof marketOutcome) => void;
    const execution = new Promise<typeof marketOutcome>((done) => { resolve = done; });
    const delegate = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "change_codex_marketplace") return execution;
      if (command === "scan_codex_marketplaces") throw new Error("读取超时");
      return delegate(command, args);
    });
    await act(async () => { await workflow.result.current.request({ kind: "marketplace", operation: "Remove", marketplaceId: "team-tools" }); });
    let confirming!: ReturnType<typeof workflow.result.current.confirm>;
    act(() => { confirming = workflow.result.current.confirm(workflow.result.current.operation!.id); });
    expect(workflow.result.current.operation?.phase).toBe("executing");
    await act(async () => { await workflow.result.current.refresh(); });
    expect(reads("scan_codex_marketplaces")).toBe(1);
    await act(async () => { resolve(marketOutcome); await confirming; });
    expect(workflow.result.current.marketplaces.result?.status).toBe("Succeeded");
    expect(workflow.result.current.marketplaces.error).toBe("读取超时");
    expect(workflow.result.current.marketplaces.scan?.marketplaces[0].name).toBe("team-tools");
    expect(workflow.result.current.marketplaces.current).toBe(false);
    await act(async () => {
      expect(await workflow.result.current.request({ kind: "marketplace", operation: "Remove", marketplaceId: "team-tools" })).toMatch(/清单已过期/);
    });
    expect(reads("change_codex_marketplace")).toBe(1);
  });

  it("确认前已开始的重读不能将执行前快照当成操作后的核对结果", async () => {
    const workflow = await openWorkflow();
    await act(async () => { await workflow.result.current.request({ kind: "plugin", pluginId: "code-review@personal", operation: "Reinstall" }); });
    let resolveScan!: (value: typeof plugins) => void;
    let resolveExecution!: () => void;
    const reading = new Promise<typeof plugins>((done) => { resolveScan = done; });
    const execution = new Promise<void>((done) => { resolveExecution = done; });
    const delegate = mockedInvoke.getMockImplementation()!;
    let firstRead = true;
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "scan_codex_plugins" && firstRead) { firstRead = false; return reading; }
      if (command === "change_codex_plugin") await execution;
      return delegate(command, args);
    });
    let refreshing!: Promise<void>;
    let confirming!: ReturnType<typeof workflow.result.current.confirm>;
    act(() => { refreshing = workflow.result.current.refresh(); });
    act(() => { confirming = workflow.result.current.confirm(workflow.result.current.operation!.id); });
    await act(async () => { resolveScan(structuredClone(plugins)); await refreshing; });
    expect(workflow.result.current.operation?.phase).toBe("executing");
    await act(async () => { resolveExecution(); await confirming; });
    expect(workflow.result.current.plugins.result?.status).toBe("Succeeded");
    expect(workflow.result.current.plugins.scan?.plugins[2].defaultEnabled).toBe(true);
    expect(workflow.result.current.plugins.current).toBe(true);
  });

  it.each(["marketplace", "plugin", "hook"] as const)("%s 待确认期间收到新快照，仍展示并提交原来确认的目标", async (kind) => {
    const workflow = await openWorkflow();
    if (kind === "hook") {
      workflow.rerender({ tab: "hooks" });
      await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    }
    const intent: CodexMaintenanceIntent = kind === "marketplace" ? { kind, operation: "Remove", marketplaceId: "team-tools" }
      : kind === "plugin" ? { kind, pluginId: "writer@personal", operation: "Reinstall" }
        : { kind, key: hooks.hooks[0].key, enabled: false };
    await act(async () => { await workflow.result.current.request(intent); });
    const approved = structuredClone(workflow.result.current.operation);
    markets.snapshotId = "new-market"; markets.marketplaces[0].name = "changed-market";
    plugins.snapshotId = "new-plugin"; plugins.plugins[0].name = "changed-plugin";
    hooks.snapshotId = "new-hooks"; hooks.hooks[0].command = "changed-command";
    await act(async () => { await workflow.result.current.refresh(); });
    expect(workflow.result.current.operation).toEqual(approved);
    await confirm(workflow);
    const { kind: _, ...request } = intent;
    expect(mockedInvoke).toHaveBeenCalledWith(kind === "marketplace" ? "change_codex_marketplace" : kind === "plugin" ? "change_codex_plugin" : "set_codex_hook_enabled",
      { request: { ...request, snapshotId: kind === "marketplace" ? "market-scan-1" : kind === "plugin" ? "scan-1" : "hooks-1" } });
  });

  it.each([false, true])("钩子重读中再次失效，旧响应不恢复资格（保持可见：%s）", async (keepVisible) => {
    const workflow = await openWorkflow();
    workflow.rerender({ tab: "hooks" });
    await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    const oldHooks = structuredClone(hooks);
    let resolve!: (value: typeof hooks) => void;
    const reading = new Promise<typeof hooks>((done) => { resolve = done; });
    let firstRead = true;
    const delegate = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "scan_codex_hooks" && firstRead) { firstRead = false; return reading; }
      return delegate(command, args);
    });
    let refreshing!: Promise<void>;
    act(() => { refreshing = workflow.result.current.refresh(); });
    workflow.rerender({ tab: "marketplaces" });
    await act(async () => { await workflow.result.current.request({ kind: "plugin", pluginId: "writer@personal", operation: "Reinstall" }); });
    if (keepVisible) workflow.rerender({ tab: "hooks" });
    let confirming!: ReturnType<typeof workflow.result.current.confirm>;
    act(() => { confirming = workflow.result.current.confirm(workflow.result.current.operation!.id); });
    await waitFor(() => expect(workflow.result.current.plugins.result?.status).toBe("Succeeded"));
    await act(async () => { resolve(oldHooks); await refreshing; await confirming; });
    if (!keepVisible) {
      expect(workflow.result.current.hooks.current).toBe(false);
      expect(workflow.result.current.hooks.scan?.hooks[0].command).toBe("/Users/example/scripts/notify.sh");
      expect(reads("scan_codex_hooks")).toBe(2);
      workflow.rerender({ tab: "hooks" });
    }
    await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    expect(workflow.result.current.hooks.scan?.hooks[0].command).toBe("/scripts/after-plugin.sh");
  });

  it("清单首次进入才读取，读取期间不能维护，返回已缓存页面不会重复读取", async () => {
    let resolve!: (value: typeof hooks) => void;
    const reading = new Promise<typeof hooks>((done) => { resolve = done; });
    mockedInvoke.mockReturnValue(reading);
    const workflow = renderHook(({ active }) => useCodexExtensions(active, "hooks"), { initialProps: { active: false } });
    expect(mockedInvoke).not.toHaveBeenCalled();
    workflow.rerender({ active: true });
    let refreshing!: Promise<void>;
    act(() => { refreshing = workflow.result.current.refresh(); });
    await act(async () => {
      expect(await workflow.result.current.request({ kind: "hook", key: hooks.hooks[0].key, enabled: false })).toMatch(/清单已过期/);
    });
    await act(async () => { resolve(hooks); await refreshing; });
    expect(workflow.result.current.hooks.current).toBe(true);
    workflow.rerender({ active: false });
    workflow.rerender({ active: true });
    expect(reads("scan_codex_hooks")).toBe(1);
    expect(reads("set_codex_hook_enabled")).toBe(0);
  });

  it("市场明确未执行时不使插件或钩子失效", async () => {
    const workflow = await openWorkflow();
    workflow.rerender({ tab: "hooks" });
    await waitFor(() => expect(workflow.result.current.hooks.current).toBe(true));
    workflow.rerender({ tab: "marketplaces" });
    marketOutcome = { status: "Failed", message: "未执行市场命令", executed: false };
    await act(async () => { await workflow.result.current.request({ kind: "marketplace", operation: "Refresh", marketplaceId: "team-tools" }); });
    await confirm(workflow);
    expect(workflow.result.current.marketplaces.result?.status).toBe("Failed");
    expect(workflow.result.current.plugins.current).toBe(true);
    expect(workflow.result.current.hooks.current).toBe(true);
    expect(reads("scan_codex_plugins")).toBe(1);
    expect(reads("scan_codex_hooks")).toBe(1);
  });
});
