import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexHookChangeRequest, CodexHookChangeResult, CodexHookScan, HookDefinitionRequest, HookDefinitionPreview } from "../codexHooks";
import { errorToString } from "../utils/format";

export function useCodexHooks(active: boolean, revision = 0) {
  const [scan, setScan] = useState<CodexHookScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CodexHookChangeResult | null>(null);
  const started = useRef(false);
  const busy = useRef(false);
  const observedRevision = useRef(revision);

  const read = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const next = await invoke<CodexHookScan>("scan_codex_hooks");
      setScan((previous) => next.status !== "Ready" && previous?.directory === next.directory
        ? { ...next, hooks: previous.hooks, snapshotId: null,
          definitions: next.definitions ?? (previous.definitions ? { ...previous.definitions, snapshotId: null } : null) } : next);
      if (next.status !== "Ready") setError(next.message ?? "Hooks 清单读取失败，请刷新重试。");
    } catch (caught) {
      setError(errorToString(caught));
      setScan((previous) => previous ? { ...previous, snapshotId: null,
        definitions: previous.definitions ? { ...previous.definitions, snapshotId: null } : null } : previous);
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

  const setEnabled = useCallback(async (request: CodexHookChangeRequest) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setResult(null);
    try {
      try {
        setResult(await invoke<CodexHookChangeResult>("set_codex_hook_enabled", { request }));
      } catch (caught) {
        setResult({ status: "Failed", message: "未能确认保存结果：" + errorToString(caught) + "。请核对刷新后的配置。" });
      }
      await read();
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }, [read]);

  const prepareDefinition = useCallback(async (request: HookDefinitionRequest) => {
    if (busy.current) throw new Error("正在处理其他操作，请稍后重试。");
    busy.current = true;
    setPreparing(true);
    try {
      return await invoke<HookDefinitionPreview>("prepare_codex_hook_definition", { request });
    } finally {
      busy.current = false;
      setPreparing(false);
    }
  }, []);

  const commitDefinition = useCallback(async (planId: string) => {
    if (busy.current) return { status: "Failed" as const, message: "正在处理其他操作，请稍后重试。" };
    busy.current = true;
    setSaving(true);
    setResult(null);
    let outcome: CodexHookChangeResult;
    try {
      try {
        outcome = await invoke<CodexHookChangeResult>("commit_codex_hook_definition", { request: { planId } });
      } catch (caught) {
        outcome = { status: "Partial", message: "无法确认保存完成到了哪一步：" + errorToString(caught) + "。请核对刷新后的定义和启用选择，不要直接重复提交。" };
      }
      setResult(outcome);
      await read();
      return outcome;
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }, [read]);

  return { scan, scanning, saving, preparing, error, result, refresh, setEnabled, prepareDefinition, commitDefinition };
}
