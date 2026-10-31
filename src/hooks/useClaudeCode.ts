import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import type {
  ClaudeChangeRequest,
  ClaudeChangeResult,
  ClaudeHookPreview,
  ClaudeHookRequest,
  ClaudeHookScan,
  ClaudeMarketplaceScan,
  ClaudePluginScan,
} from "../claudeCode";
import { isMarketOperation } from "../claudeCode";
import { errorToString } from "../utils/format";
import { claudeObservationFacts, recordObservationFacts } from "../observationFacts";
import { recordObservation } from "../observationLedger";
import { useNativeInventory, type NativeInventoryAdapter } from "./useNativeInventory";

const marketplacesAdapter: NativeInventoryAdapter<ClaudeMarketplaceScan> = {
  retain: (previous, next) => next.status !== "Ready" && previous?.directory === next.directory
    ? { ...next, marketplaces: previous.marketplaces }
    : next,
  revoke: (scan) => ({ ...scan, snapshotId: null, writeBlockedReason: "清单已过期，请重新读取。" }),
  invalidate: (scan) => ({ ...scan, snapshotId: null }),
  ready: (scan) => scan.status === "Ready",
  message: (scan) => scan.message ?? "市场清单读取失败，请重新读取。",
};

const pluginsAdapter: NativeInventoryAdapter<ClaudePluginScan> = {
  retain: (previous, next) => next.status !== "Ready" && previous?.directory === next.directory
    ? { ...next, plugins: previous.plugins }
    : next,
  revoke: (scan) => ({ ...scan, snapshotId: null, writeBlockedReason: "清单已过期，请重新读取。" }),
  invalidate: (scan) => ({ ...scan, snapshotId: null }),
  ready: (scan) => scan.status === "Ready",
  message: (scan) => scan.message ?? "插件清单读取失败，请重新读取。",
};

const hookAdapter: NativeInventoryAdapter<ClaudeHookScan> = {
  retain: (_previous, next) => next,
  revoke: (scan) => ({ ...scan, snapshotId: null, writeBlockedReason: "定义清单已过期，请重新读取。" }),
  invalidate: (scan, reason) => ({ ...scan, snapshotId: null, writeBlockedReason: reason ?? "用户配置已变化，请重新读取。" }),
  ready: () => true,
  message: () => null,
};

export function useClaudeCode(active: boolean, tab: string, externalBusy = false) {
  const [operationBusy, setOperationBusy] = useState(false);
  const [result, setResult] = useState<ClaudeChangeResult | null>(null);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);

  const marketplaces = useNativeInventory<ClaudeMarketplaceScan, never>({
    command: "scan_claude_marketplaces",
    visible: active && tab === "marketplaces",
    autoRead: !externalBusy && !operationBusy,
    adapter: marketplacesAdapter,
    observe: (scan, error, at) => recordObservationFacts(
      "claude:marketplaces",
      claudeObservationFacts("marketplaces", { scan, current: !error && scan !== null, scanning: false, error }),
      at,
    ),
    observeInvalidation: (at, reason) => recordObservation({
      kind: "invalidate",
      itemId: "claude:marketplaces",
      at,
      reason: reason ?? "来源已失效",
    }),
  });

  // Without configured marketplaces the built-in directory only appears in the
  // plugin inventory, so an empty marketplace list is the cue to load it in the
  // background. Otherwise plugin rows stay unloaded until a market is expanded.
  const marketEmpty = Boolean(
    marketplaces.view.current
      && marketplaces.view.scan?.status === "Ready"
      && marketplaces.view.scan.marketplaces.length === 0
  );

  const plugins = useNativeInventory<ClaudePluginScan, never>({
    command: "scan_claude_plugins",
    visible: active && tab === "marketplaces",
    autoRead: !externalBusy && !operationBusy && marketEmpty,
    adapter: pluginsAdapter,
    observe: (scan, error, at) => recordObservationFacts(
      "claude:plugins",
      claudeObservationFacts("plugins", { scan, current: !error && scan !== null, scanning: false, error }),
      at,
    ),
    observeInvalidation: (at, reason) => recordObservation({
      kind: "invalidate",
      itemId: "claude:plugins",
      at,
      reason: reason ?? "来源已失效",
    }),
  });

  const hooks = useNativeInventory<ClaudeHookScan, never>({
    command: "scan_claude_hooks",
    visible: active && tab === "hooks",
    autoRead: !externalBusy && !operationBusy,
    adapter: hookAdapter,
    observe: (scan, error, at) => recordObservationFacts(
      "claude:hooks",
      claudeObservationFacts("hooks", { scan, current: !error && scan !== null, scanning: false, error }),
      at,
    ),
    observeInvalidation: (at, reason) => recordObservation({
      kind: "invalidate",
      itemId: "claude:hooks",
      at,
      reason: reason ?? "来源已失效",
    }),
  });

  const clearErrors = useCallback(() => {
    marketplaces.clearError();
    plugins.clearError();
    hooks.clearError();
  }, [marketplaces.clearError, plugins.clearError, hooks.clearError]);

  const refresh = useCallback(async (view: string = tab) => {
    if (lock.current || externalBusy) return;
    lock.current = true;
    setResult(null);
    clearErrors();
    try {
      if (view === "hooks") return await hooks.read();
      await marketplaces.read();
      if (plugins.native.current) await plugins.read();
      return null;
    } finally {
      lock.current = false;
    }
  }, [tab, externalBusy, clearErrors, hooks.read, marketplaces.read, plugins.native, plugins.read]);

  const change = useCallback(async (request: ClaudeChangeRequest) => {
    if (lock.current || externalBusy) return null;
    lock.current = true;
    setOperationBusy(true);
    setResult(null);
    clearErrors();
    const market = isMarketOperation(request.operation);
    try {
      (market ? marketplaces : plugins).invalidate();
      let outcome: ClaudeChangeResult;
      try {
        outcome = await invoke<ClaudeChangeResult>(market ? "change_claude_marketplace" : "change_claude_plugin", { request });
      } catch (caught) {
        outcome = { status: "Unconfirmed", message: errorToString(caught), executed: true };
      }
      setResult(outcome);
      setRevision((value) => value + 1);
      hooks.invalidate("插件或市场已变化，请重新读取定义。");
      if (market) {
        plugins.invalidate("市场已变化，请重新读取插件清单。");
        await marketplaces.read();
        if (plugins.native.current) await plugins.read();
      } else {
        marketplaces.invalidate("插件安装已变化，请重新读取市场清单。");
        await plugins.read();
        if (marketplaces.native.current) await marketplaces.read();
      }
      return outcome;
    } finally {
      lock.current = false;
      setOperationBusy(false);
    }
  }, [externalBusy, clearErrors, hooks.invalidate, marketplaces.invalidate, marketplaces.native, marketplaces.read, plugins.invalidate, plugins.native, plugins.read]);

  const prepareHook = useCallback(async (request: ClaudeHookRequest) => {
    if (lock.current || externalBusy) throw new Error("请等待当前操作完成。");
    lock.current = true;
    setOperationBusy(true);
    try {
      return await invoke<ClaudeHookPreview>("prepare_claude_hook", { request });
    } finally {
      lock.current = false;
      setOperationBusy(false);
    }
  }, [externalBusy]);

  const commitHook = useCallback(async (previewId: string) => {
    if (lock.current || externalBusy) throw new Error("请等待当前操作完成。");
    lock.current = true;
    setOperationBusy(true);
    setResult(null);
    clearErrors();
    try {
      hooks.invalidate();
      let outcome: ClaudeChangeResult;
      try {
        outcome = await invoke<ClaudeChangeResult>("commit_claude_hook", { request: { previewId } });
      } catch (caught) {
        outcome = { status: "Unconfirmed", message: errorToString(caught), executed: true };
      }
      setResult(outcome);
      setRevision((value) => value + 1);
      await hooks.read();
      marketplaces.invalidate("Hooks 已变化，请重新读取市场清单。");
      return outcome;
    } finally {
      lock.current = false;
      setOperationBusy(false);
    }
  }, [externalBusy, clearErrors, hooks.invalidate, hooks.read, marketplaces.invalidate]);

  const invalidate = useCallback(() => {
    marketplaces.invalidate();
    plugins.invalidate();
    hooks.invalidate("用户配置已变化，请重新读取。");
  }, [hooks.invalidate, marketplaces.invalidate, plugins.invalidate]);

  return {
    marketplaces: marketplaces.scan,
    plugins: plugins.scan,
    hooks: hooks.scan,
    marketplacesView: marketplaces.view,
    pluginsView: plugins.view,
    hooksView: hooks.view,
    busy: operationBusy || externalBusy,
    scanning: marketplaces.view.scanning || plugins.view.scanning,
    marketplacesScanning: marketplaces.view.scanning,
    pluginsScanning: plugins.view.scanning,
    error: marketplaces.view.error ?? plugins.view.error ?? hooks.view.error,
    result,
    revision,
    refresh,
    change,
    prepareHook,
    commitHook,
    invalidate,
    readMarketplaces: marketplaces.read,
    readPlugins: plugins.read,
  };
}

export type ClaudeCodeState = ReturnType<typeof useClaudeCode>;
