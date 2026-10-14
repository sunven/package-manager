import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexPluginChangeRequest, CodexPluginChangeResult, CodexPluginScan } from "../codexPlugins";
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

  const setEnabled = useCallback(async (request: CodexPluginChangeRequest) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setResult(null);
    try {
      try {
        setResult(await invoke<CodexPluginChangeResult>("set_codex_plugin_enabled", { request }));
      } catch (caught) {
        setResult({ status: "Failed", message: `未能确认保存结果：${errorToString(caught)}。请核对刷新后的用户默认设置。` });
      }
      // Refresh has its own error state: a saved configuration stays reported as saved.
      setHookRevision((value) => value + 1);
      await read();
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }, [read]);

  return { scan, scanning, saving, error, result, refresh, setEnabled, hookRevision };
}
