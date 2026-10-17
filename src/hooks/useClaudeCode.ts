import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeChangeRequest, ClaudeChangeResult, ClaudeExtensionScan, ClaudeHookPreview, ClaudeHookRequest, ClaudeHookScan } from "../claudeCode";
import { errorToString } from "../utils/format";

export function useClaudeCode(active: boolean, tab: string, externalBusy = false) {
  const [extensions, setExtensions] = useState<ClaudeExtensionScan | null>(null);
  const [hooks, setHooks] = useState<ClaudeHookScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaudeChangeResult | null>(null);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const started = useRef({ marketplaces: false, hooks: false });

  const readExtensions = useCallback(async () => {
    try {
      const next = await invoke<ClaudeExtensionScan>("scan_claude_extensions");
      setExtensions((previous) => next.status !== "Ready" && previous?.directory === next.directory
        ? { ...next, marketplaces: previous.marketplaces, plugins: previous.plugins } : next);
      if (next.status !== "Ready") setError(next.message ?? "市场与插件读取失败，请重新读取。");
      return next;
    } catch (caught) {
      setError(errorToString(caught));
      setExtensions((previous) => previous ? { ...previous, snapshotId: null, writeBlockedReason: "清单已过期，请重新读取。" } : null);
      return null;
    }
  }, []);

  const readHooks = useCallback(async () => {
    try {
      const next = await invoke<ClaudeHookScan>("scan_claude_hooks");
      setHooks(next); return next;
    } catch (caught) {
      setError(errorToString(caught));
      setHooks((previous) => previous ? { ...previous, snapshotId: null, writeBlockedReason: "定义清单已过期，请重新读取。" } : null);
      return null;
    }
  }, []);

  const refresh = useCallback(async (view: string = tab) => {
    if (lock.current || externalBusy) return null;
    lock.current = true; setBusy(true); setError(null); setResult(null);
    try {
      if (view === "hooks") { started.current.hooks = true; return await readHooks(); }
      started.current.marketplaces = true; await readExtensions(); return null;
    } finally { lock.current = false; setBusy(false); }
  }, [tab, readExtensions, readHooks, externalBusy]);

  useEffect(() => {
    if (active && tab !== "skills" && !externalBusy && !started.current[tab === "hooks" ? "hooks" : "marketplaces"] && !busy) void refresh(tab);
  }, [active, tab, refresh, busy, externalBusy]);

  const change = useCallback(async (request: ClaudeChangeRequest) => {
    if (lock.current || externalBusy) return null;
    lock.current = true; setBusy(true); setError(null); setResult(null);
    let outcome: ClaudeChangeResult;
    try {
      try { outcome = await invoke<ClaudeChangeResult>("change_claude_extension", { request }); }
      catch (caught) { outcome = { status: "Unconfirmed", message: errorToString(caught), executed: true }; }
      setResult(outcome); setRevision((value) => value + 1);
      started.current.hooks = false;
      setHooks((previous) => previous ? { ...previous, snapshotId: null, writeBlockedReason: "插件或市场已变化，请重新读取定义。" } : null);
      await readExtensions();
      return outcome;
    } finally { lock.current = false; setBusy(false); }
  }, [readExtensions, externalBusy]);

  const prepareHook = useCallback(async (request: ClaudeHookRequest) => {
    if (lock.current || externalBusy) throw new Error("请等待当前操作完成。");
    lock.current = true; setBusy(true);
    try { return await invoke<ClaudeHookPreview>("prepare_claude_hook", { request }); }
    finally { lock.current = false; setBusy(false); }
  }, [externalBusy]);

  const commitHook = useCallback(async (previewId: string) => {
    if (lock.current || externalBusy) throw new Error("请等待当前操作完成。");
    lock.current = true; setBusy(true); setError(null); setResult(null);
    let outcome: ClaudeChangeResult;
    try {
      try { outcome = await invoke<ClaudeChangeResult>("commit_claude_hook", { request: { previewId } }); }
      catch (caught) { outcome = { status: "Unconfirmed", message: errorToString(caught), executed: true }; }
      setResult(outcome); setRevision((value) => value + 1);
      await readHooks();
      // Hook edits change the same settings file used by the extension snapshot.
      started.current.marketplaces = false;
      setExtensions((previous) => previous ? { ...previous, snapshotId: null } : null);
      return outcome;
    } finally { lock.current = false; setBusy(false); }
  }, [readHooks, externalBusy]);

  const invalidate = useCallback(() => {
    started.current = { marketplaces: false, hooks: false };
    setExtensions((value) => value ? { ...value, snapshotId: null } : null);
    setHooks((value) => value ? { ...value, snapshotId: null, writeBlockedReason: "用户配置已变化，请重新读取。" } : null);
  }, []);
  return { extensions, hooks, busy: busy || externalBusy, error, result, revision, invalidate, refresh, change, prepareHook, commitHook };
}
export type ClaudeCodeState = ReturnType<typeof useClaudeCode>;
