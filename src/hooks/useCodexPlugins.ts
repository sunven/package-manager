import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexPluginChangeRequest, CodexPluginChangeResult, CodexPluginLifecycleRequest, CodexPluginScan } from "../codexPlugins";
import { errorToString } from "../utils/format";

export function useCodexPlugins(active: boolean, revision = 0) {
  const [scan, setScan] = useState<CodexPluginScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CodexPluginChangeResult | null>(null);
  const [hookRevision, setHookRevision] = useState(0);
  const started = useRef(false);
  const busy = useRef(false);
  const observedRevision = useRef(revision);

  const read = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const next = await invoke<CodexPluginScan>("scan_codex_plugins");
      setScan((previous) => next.status !== "Ready" && previous?.directory === next.directory
        ? { ...next, plugins: previous.plugins, snapshotId: null } : next);
      if (next.status !== "Ready") setError(next.message ?? "插件清单读取失败，请刷新重试。");
    } catch (caught) {
      setError(errorToString(caught));
      setScan((previous) => previous ? { ...previous, snapshotId: null } : null);
    } finally {
      setScanning(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    started.current = true;
    observedRevision.current = revision;
    setResult(null);
    try {
      await read();
    } finally {
      busy.current = false;
    }
  }, [read, revision]);

  useEffect(() => {
    if (active && (!started.current || observedRevision.current !== revision)) void refresh();
  }, [active, refresh, revision]);

  const mutate = useCallback(async (command: "set_codex_plugin_enabled" | "change_codex_plugin", request: CodexPluginChangeRequest | CodexPluginLifecycleRequest) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setResult(null);
    try {
      try {
        setResult(await invoke<CodexPluginChangeResult>(command, { request }));
      } catch (caught) {
        setResult({ status: "Failed", message: `未能确认操作结果：${errorToString(caught)}。请核对重读后的插件清单和用户设置，勿直接重复执行。` });
      }
      // Refresh has its own error state: a saved configuration stays reported as saved.
      setHookRevision((value) => value + 1);
      await read();
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }, [read]);

  const setEnabled = useCallback((request: CodexPluginChangeRequest) => mutate("set_codex_plugin_enabled", request), [mutate]);
  const change = useCallback((request: CodexPluginLifecycleRequest) => mutate("change_codex_plugin", request), [mutate]);
  return { scan, scanning, saving, error, result, refresh, setEnabled, change, hookRevision };
}
