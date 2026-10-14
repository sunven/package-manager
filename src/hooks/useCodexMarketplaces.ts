import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexMarketplaceRequest, CodexMarketplaceResult, CodexMarketplaceScan } from "../codexMarketplaces";
import { errorToString } from "../utils/format";

export function useCodexMarketplaces(active: boolean) {
  const [scan, setScan] = useState<CodexMarketplaceScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CodexMarketplaceResult | null>(null);
  const [pluginRevision, setPluginRevision] = useState(0);
  const busy = useRef(false);
  const started = useRef(false);

  const read = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const next = await invoke<CodexMarketplaceScan>("scan_codex_marketplaces");
      setScan((previous) => next.status !== "Ready" && previous?.directory === next.directory
        ? { ...next, marketplaces: previous.marketplaces, snapshotId: null } : next);
      if (next.status !== "Ready") setError(next.message ?? "市场清单读取失败，请重新读取。");
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
    setResult(null);
    try { await read(); } finally { busy.current = false; }
  }, [read]);

  useEffect(() => { if (active && !started.current) void refresh(); }, [active, refresh]);

  const change = useCallback(async (request: CodexMarketplaceRequest) => {
    if (busy.current) return null;
    busy.current = true;
    setPending(true);
    setResult(null);
    let outcome: CodexMarketplaceResult;
    try {
      try {
        outcome = await invoke<CodexMarketplaceResult>("change_codex_marketplace", { request });
      } catch (caught) {
        outcome = { status: "Failed", message: `未能确认命令结果：${errorToString(caught)}。请核对重读后的清单，勿直接重复执行。`, executed: true };
      }
      setResult(outcome);
      // Even a failed command may have changed plugin contents before failing.
      if (outcome.executed) setPluginRevision((revision) => revision + 1);
      await read();
      return outcome;
    } finally {
      setPending(false);
      busy.current = false;
    }
  }, [read]);

  return { scan, scanning, pending, error, result, pluginRevision, refresh, change };
}
