import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import type { CodexMarketplace, CodexMarketplaceRequest, CodexMarketplaceResult, CodexMarketplaceScan } from "../codexMarketplaces";
import type { CodexPlugin, CodexPluginChangeRequest, CodexPluginChangeResult, CodexPluginLifecycleRequest, CodexPluginScan } from "../codexPlugins";
import type { CodexHook, CodexHookChangeRequest, CodexHookChangeResult, CodexHookDefinitions, CodexHookScan, HookDefinitionPreview, HookDefinitionRequest } from "../codexHooks";
import { errorToString } from "../utils/format";
import {
  useNativeInventory,
  withoutSnapshot,
  type NativeInventoryAdapter,
} from "./useNativeInventory";

type MarketplaceIntent = { kind: "marketplace" } & Omit<CodexMarketplaceRequest, "snapshotId">;
type PluginIntent = { kind: "plugin" } & (Omit<CodexPluginChangeRequest, "snapshotId"> | Omit<CodexPluginLifecycleRequest, "snapshotId">);
type HookIntent = { kind: "hook" } & Omit<CodexHookChangeRequest, "snapshotId">;
type DefinitionIntent = { kind: "definition"; basisRevision: number } & Omit<HookDefinitionRequest, "snapshotId">;
export type CodexMaintenanceIntent = MarketplaceIntent | PluginIntent | HookIntent | DefinitionIntent;
export type CodexDefinitionView = Omit<CodexHookDefinitions, "snapshotId"> & { current: boolean; revision: number };
export type CodexDefinitionPreview = Omit<HookDefinitionPreview, "planId">;
type NativeScan = CodexMarketplaceScan | CodexPluginScan | CodexHookScan;
type Outcome = CodexMarketplaceResult | CodexPluginChangeResult | CodexHookChangeResult;
type InventoryView<T, R> = { scan: T | null; current: boolean; revision: number; scanning: boolean; error: string | null; result: R | null };
type HookScanView = Omit<CodexHookScan, "snapshotId" | "definitions"> & { definitions?: CodexDefinitionView | null };
type OperationDetail =
  | { kind: "marketplace"; target: CodexMarketplace | null; intent: MarketplaceIntent }
  | { kind: "plugin"; target: CodexPlugin; intent: PluginIntent }
  | { kind: "hook"; target: CodexHook; intent: HookIntent }
  | { kind: "definition"; intent: DefinitionIntent; preview: CodexDefinitionPreview | null };
export type CodexOperation = OperationDetail & { id: number; phase: "preparing" | "confirming" | "executing" | "reading"; directory: string; configPath: string };
export type CodexExtensions = {
  marketplaces: InventoryView<Omit<CodexMarketplaceScan, "snapshotId">, CodexMarketplaceResult>;
  plugins: InventoryView<Omit<CodexPluginScan, "snapshotId">, CodexPluginChangeResult>;
  hooks: InventoryView<HookScanView, CodexHookChangeResult>;
  operation: CodexOperation | null;
  processing: boolean;
  request: (intent: CodexMaintenanceIntent) => Promise<string | null>;
  confirm: (id?: number) => Promise<Outcome | null>;
  cancel: (id: number) => boolean;
  refresh: () => Promise<void>;
};

function revoke<T extends NativeScan>(scan: T): T {
  return { ...scan, snapshotId: null, ...("hooks" in scan && scan.definitions
    ? { definitions: { ...scan.definitions, snapshotId: null } } : {}) };
}

function retained<T extends NativeScan>(previous: T | null, next: T): T {
  if (next.status === "Ready" || previous?.directory !== next.directory) return next;
  return revoke({ ...next,
    ...("marketplaces" in previous ? { marketplaces: previous.marketplaces } : {}),
    ...("plugins" in previous ? { plugins: previous.plugins } : {}),
    ...("hooks" in previous && "hooks" in next ? { hooks: previous.hooks, definitions: next.definitions ?? previous.definitions } : {}),
  });
}

function codexAdapter<Scan extends NativeScan>(): NativeInventoryAdapter<Scan> {
  return {
    retain: (previous, next) => retained(previous, next),
    revoke: (scan) => revoke(scan),
    invalidate: (scan) => revoke(scan),
    ready: (scan) => scan.status === "Ready",
    message: (scan) => scan.message ?? "清单读取失败，请重新读取。",
  };
}

const marketplaceAdapter = codexAdapter<CodexMarketplaceScan>();
const pluginAdapter = codexAdapter<CodexPluginScan>();
const hookAdapter = codexAdapter<CodexHookScan>();

export function useCodexExtensions(active: boolean, tab: string): CodexExtensions {
  const [operation, setOperation] = useState<CodexOperation | null>(null);
  const pending = useRef<{ view: CodexOperation; execute: (() => Promise<Outcome>) | null } | null>(null);
  const sequence = useRef(0);
  const visible = useRef({ marketplaces: false, plugins: false, hooks: false });
  visible.current = { marketplaces: active && tab === "marketplaces", plugins: active && tab === "marketplaces", hooks: active && tab === "hooks" };
  const marketplaces = useNativeInventory<CodexMarketplaceScan, CodexMarketplaceResult>({
    command: "scan_codex_marketplaces",
    visible: visible.current.marketplaces,
    autoRead: !operation,
    adapter: marketplaceAdapter,
  });
  const plugins = useNativeInventory<CodexPluginScan, CodexPluginChangeResult>({
    command: "scan_codex_plugins",
    visible: visible.current.plugins,
    autoRead: !operation,
    adapter: pluginAdapter,
  });
  const hooks = useNativeInventory<CodexHookScan, CodexHookChangeResult>({
    command: "scan_codex_hooks",
    visible: visible.current.hooks,
    autoRead: !operation,
    adapter: hookAdapter,
  });
  const inventories = { marketplaces, plugins, hooks };

  async function readVisible(force: boolean) {
    await Promise.all(Object.entries(visible.current).filter(([key, shown]) => shown && (force || inventories[key as keyof typeof inventories].needsRead())).map(([key]) => inventories[key as keyof typeof inventories].read()));
  }

  async function refresh() {
    if (pending.current && pending.current.view.phase !== "confirming") return;
    await readVisible(true);
  }

  async function request(intent: CodexMaintenanceIntent) {
    if (pending.current) return "正在处理其他维护操作，请先确认或取消。";
    const inventory = intent.kind === "marketplace" ? marketplaces : intent.kind === "plugin" ? plugins : hooks;
    const scan = inventory.native.current;
    if (!inventory.view.current || inventory.running.current || inventory.view.revision !== inventory.revision.current || !scan || (intent.kind !== "definition" && !scan.snapshotId) || scan.configError) return "清单已过期或配置无法核实，请重新读取后再确认。";
    const frozen = structuredClone(intent);
    const { kind: _, ...change } = frozen;
    function hold(detail: OperationDetail, execute: (() => Promise<Outcome>) | null) {
      const view: CodexOperation = { ...detail, id: ++sequence.current, phase: "confirming", directory: scan!.directory, configPath: scan!.configPath };
      pending.current = { view, execute };
      setOperation(view);
      return null;
    }
    if (frozen.kind === "marketplace" && "marketplaces" in scan) {
      const market = scan.marketplaces.find((item) => item.id === frozen.marketplaceId) ?? null;
      if (frozen.operation !== "Add" && (!market || market.readOnlyReason)) return market?.readOnlyReason ?? "所选市场已变化，请重新读取。";
      if (frozen.operation === "Refresh" && market?.sourceKind !== "git") return "本地市场无需 Git 同步，请重新读取。";
      marketplaces.setResult(null);
      return hold({ kind: "marketplace", target: market ? structuredClone(market) : null, intent: frozen }, () => invoke<CodexMarketplaceResult>("change_codex_marketplace", { request: { ...change, snapshotId: scan.snapshotId } }));
    }
    if (frozen.kind === "plugin" && "plugins" in scan) {
      const plugin = scan.plugins.find((item) => item.pluginId === frozen.pluginId);
      if (!plugin || plugin.readOnlyReason) return plugin?.readOnlyReason ?? "所选插件已变化，请重新读取。";
      if ("enabled" in frozen && !plugin.installed) return "未安装插件不能修改启用设置。";
      if ("operation" in frozen && frozen.operation !== "Uninstall" && plugin.installBlockedReason) return plugin.installBlockedReason;
      plugins.setResult(null);
      return hold({ kind: "plugin", target: structuredClone(plugin), intent: frozen }, () => invoke<CodexPluginChangeResult>("enabled" in frozen ? "set_codex_plugin_enabled" : "change_codex_plugin", { request: { ...change, snapshotId: scan.snapshotId } }));
    }
    if (frozen.kind === "hook" && "hooks" in scan) {
      const hook = scan.hooks.find((item) => item.key === frozen.key);
      if (!hook || hook.readOnlyReason || scan.featureEnabled !== true || scan.message) return hook?.readOnlyReason ?? "所选 Hook 当前不能维护，请重新读取。";
      hooks.setResult(null);
      return hold({ kind: "hook", target: structuredClone(hook), intent: frozen }, () => invoke<CodexHookChangeResult>("set_codex_hook_enabled", { request: { ...change, snapshotId: scan.snapshotId } }));
    }
    if (frozen.kind === "definition" && "hooks" in scan) {
      const definitions = scan.definitions;
      if (!definitions?.snapshotId || definitions.readOnlyReason || frozen.basisRevision !== hooks.view.revision) return definitions?.readOnlyReason ?? "定义快照已变化，请核对当前定义后重新检查。";
      const definition = definitions.entries.find((entry) => entry.id === frozen.id);
      if (frozen.action !== "create" && (!definition || definition.readOnlyReason)) return definition?.readOnlyReason ?? "所选定义已变化，请重新读取。";
      const { kind: _, basisRevision: __, ...definitionRequest } = frozen;
      hold({ kind: "definition", intent: frozen, preview: null }, null);
      const approval = pending.current!;
      approval.view = { ...approval.view, phase: "preparing" };
      setOperation(approval.view);
      hooks.setResult(null);
      try {
        const { planId, ...preview } = await invoke<HookDefinitionPreview>("prepare_codex_hook_definition", { request: { ...definitionRequest, snapshotId: definitions.snapshotId } });
        approval.view = { ...approval.view, phase: "confirming", ...{ preview } } as CodexOperation;
        approval.execute = () => invoke<CodexHookChangeResult>("commit_codex_hook_definition", { request: { planId } });
        setOperation(approval.view);
        return null;
      } catch (caught) {
        const message = errorToString(caught);
        hooks.setResult({ status: "Failed", message });
        pending.current = null;
        setOperation(null);
        return message;
      }
    }
    return "所选维护对象与清单不匹配，请重新读取。";
  }

  async function confirm(id = pending.current?.view.id) {
    const approval = pending.current;
    if (!approval || approval.view.id !== id || approval.view.phase !== "confirming" || !approval.execute) return null;
    approval.view = { ...approval.view, phase: "executing" };
    setOperation(approval.view);
    const owner = approval.view.kind === "marketplace" ? marketplaces : approval.view.kind === "plugin" ? plugins : hooks;
    owner.invalidate();
    let outcome: Outcome;
    try { outcome = await approval.execute(); } catch (caught) {
      const message = "未能确认操作结果：" + errorToString(caught) + "。请核对重读后的清单和配置，勿直接重复执行。";
      outcome = approval.view.kind === "marketplace" ? { status: "Failed", message, executed: true }
        : { status: approval.view.kind === "definition" ? "Partial" : "Failed", message };
    }
    // A read started before confirmation may have finished while the write ran.
    owner.invalidate();
    if (approval.view.kind === "marketplace") {
      const result = outcome as CodexMarketplaceResult;
      marketplaces.setResult(result);
      if (result.executed) { plugins.invalidate(); hooks.invalidate(); }
    } else if (approval.view.kind === "plugin") {
      plugins.setResult(outcome as CodexPluginChangeResult);
      if (outcome.status !== "Conflict") hooks.invalidate();
    } else {
      hooks.setResult(outcome as CodexHookChangeResult);
      if (outcome.status !== "Conflict") plugins.invalidate();
    }
    approval.view = { ...approval.view, phase: "reading" };
    setOperation(approval.view);
    await readVisible(false);
    pending.current = null;
    setOperation(null);
    return outcome;
  }

  function cancel(id: number) {
    if (pending.current?.view.id !== id || pending.current.view.phase !== "confirming") return false;
    pending.current = null;
    setOperation(null);
    return true;
  }

  const scan = hooks.view.scan;
  const { definitions, ...hookView } = scan ?? {};
  return {
    marketplaces: marketplaces.view,
    plugins: plugins.view,
    hooks: { ...hooks.view, scan: scan ? { ...hookView, definitions: definitions ? { ...withoutSnapshot(definitions), current: hooks.view.current && Boolean(definitions.snapshotId), revision: hooks.view.revision } : definitions } as HookScanView : null },
    operation, processing: Boolean(operation && operation.phase !== "confirming"), request, confirm, cancel, refresh,
  };
}
