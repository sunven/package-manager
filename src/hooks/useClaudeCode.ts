import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import type {
  ClaudeChangeRequest,
  ClaudeChangeResult,
  ClaudeExtensionScan,
  ClaudeHookPreview,
  ClaudeHookRequest,
  ClaudeHookScan,
} from "../claudeCode";
import { errorToString } from "../utils/format";
import { claudeObservationFacts, recordObservationFacts } from "../observationFacts";
import { recordObservation } from "../observationLedger";
import { useNativeInventory, type NativeInventoryAdapter } from "./useNativeInventory";

const extensionAdapter: NativeInventoryAdapter<ClaudeExtensionScan> = {
  retain: (previous, next) => next.status !== "Ready" && previous?.directory === next.directory
    ? { ...next, marketplaces: previous.marketplaces, plugins: previous.plugins }
    : next,
  revoke: (scan) => ({ ...scan, snapshotId: null, writeBlockedReason: "清单已过期，请重新读取。" }),
  invalidate: (scan) => ({ ...scan, snapshotId: null }),
  ready: (scan) => scan.status === "Ready",
  message: (scan) => scan.message ?? "市场与插件读取失败，请重新读取。",
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

  const extensions = useNativeInventory<ClaudeExtensionScan, never>({
    command: "scan_claude_extensions",
    visible: active && tab === "marketplaces",
    autoRead: !externalBusy && !operationBusy,
    adapter: extensionAdapter,
    observe: (scan, error, at) => recordObservationFacts(
      "claude:extensions",
      claudeObservationFacts("extensions", { scan, current: !error && scan !== null, scanning: false, error }),
      at,
    ),
    observeInvalidation: (at, reason) => recordObservation({
      kind: "invalidate",
      itemId: "claude:extensions",
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

  const clearExtensionError = extensions.clearError;
  const clearHookError = hooks.clearError;
  const clearErrors = useCallback(() => {
    clearExtensionError();
    clearHookError();
  }, [clearExtensionError, clearHookError]);

  const refresh = useCallback(async (view: string = tab) => {
    if (lock.current || externalBusy) return;
    lock.current = true;
    setResult(null);
    clearErrors();
    try {
      if (view === "hooks") return await hooks.read();
      await extensions.read();
      return null;
    } finally {
      lock.current = false;
    }
  }, [tab, externalBusy, clearErrors, extensions.read, hooks.read]);

  const change = useCallback(async (request: ClaudeChangeRequest) => {
    if (lock.current || externalBusy) return null;
    lock.current = true;
    setOperationBusy(true);
    setResult(null);
    clearErrors();
    try {
      extensions.invalidate();
      let outcome: ClaudeChangeResult;
      try {
        outcome = await invoke<ClaudeChangeResult>("change_claude_extension", { request });
      } catch (caught) {
        outcome = { status: "Unconfirmed", message: errorToString(caught), executed: true };
      }
      setResult(outcome);
      setRevision((value) => value + 1);
      hooks.invalidate("插件或市场已变化，请重新读取定义。");
      await extensions.read();
      return outcome;
    } finally {
      lock.current = false;
      setOperationBusy(false);
    }
  }, [externalBusy, clearErrors, extensions.invalidate, extensions.read, hooks.invalidate]);

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
      extensions.invalidate();
      return outcome;
    } finally {
      lock.current = false;
      setOperationBusy(false);
    }
  }, [externalBusy, clearErrors, extensions.invalidate, hooks.invalidate, hooks.read]);

  const invalidate = useCallback(() => {
    extensions.invalidate();
    hooks.invalidate("用户配置已变化，请重新读取。");
  }, [extensions.invalidate, hooks.invalidate]);

  return {
    extensions: extensions.scan,
    hooks: hooks.scan,
    extensionsView: extensions.view,
    hooksView: hooks.view,
    busy: operationBusy || externalBusy || extensions.view.scanning || hooks.view.scanning,
    error: extensions.view.error ?? hooks.view.error,
    result,
    revision,
    invalidate,
    refresh,
    change,
    prepareHook,
    commitHook,
  };
}

export type ClaudeCodeState = ReturnType<typeof useClaudeCode>;
