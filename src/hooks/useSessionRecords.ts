import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionRecord, SessionRecordScan, SessionRefresh, SessionRemovalResult, SessionSourceId, SessionSourceScan } from "../sessionRecords";
import { errorToString } from "../utils/format";

type PendingRemoval =
  | { kind: "one"; source: SessionSourceId; id: string; title: string }
  | { kind: "age"; source: SessionSourceId; label: string; days: 7 | 30; count: number }
  | { kind: "selected"; source: SessionSourceId; label: string; records: SessionRecord[] };

type Operation = { id: number; phase: "confirming" | "executing" | "refreshing"; target: PendingRemoval };
type RemovalOutcome = { source: SessionSourceId; result: SessionRemovalResult; completedIds: string[]; refresh: SessionRefresh };
const idleScanning: Record<SessionSourceId, boolean> = { codex: false, claude: false };

export function useSessionRecords(active: boolean) {
  const [scan, setScan] = useState<SessionRecordScan | null>(null);
  const [scanningSources, setScanningSources] = useState(idleScanning);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [outcome, setOutcome] = useState<RemovalOutcome | null>(null);
  const pending = useRef<Operation | null>(null);
  const operationId = useRef(0);
  const epoch = useRef(0);
  const sourceEpoch = useRef<Record<SessionSourceId, number>>({ codex: 0, claude: 0 });

  const read = useCallback(async (source?: SessionSourceId) => {
    const ticket = ++epoch.current;
    const sources: SessionSourceId[] = source ? [source] : ["codex", "claude"];
    for (const key of sources) sourceEpoch.current[key] = ticket;
    setScanningSources((current) => ({ ...current, ...(source ? { [source]: true } : { codex: true, claude: true }) }));
    setError(null);
    setOutcome((current) => current && sources.includes(current.source) ? { ...current, refresh: { status: "refreshing", message: null } } : current);

    function publish(key: SessionSourceId, next: SessionSourceScan | null, failure?: string) {
      if (sourceEpoch.current[key] !== ticket) return;
      setScan((current) => {
        if (sourceEpoch.current[key] !== ticket) return current;
        const previous = current?.[key] ?? emptySource();
        const value = next?.status === "Failed"
          ? { ...next, records: previous.records }
          : next ?? { ...previous, status: "Failed" as const, message: failure! };
        return { codex: current?.codex ?? emptySource(), claude: current?.claude ?? emptySource(), [key]: value };
      });
      const failed = !next || next.status === "Failed" || next.status === "Partial";
      setOutcome((current) => current?.source === key && sourceEpoch.current[key] === ticket ? {
        ...current,
        refresh: { status: failed ? "failed" : "ready", message: failed ? failure ?? next?.message ?? "会话记录未能完整读取。" : null },
      } : current);
    }

    try {
      if (source) publish(source, await invoke<SessionSourceScan>("scan_session_source", { source }));
      else {
        const next = await invoke<SessionRecordScan>("scan_session_records");
        for (const key of sources) publish(key, next[key]);
      }
    } catch (caught) {
      const message = errorToString(caught);
      if (!source && sources.every((key) => sourceEpoch.current[key] === ticket)) setError(message);
      for (const key of sources) publish(key, null, message);
    } finally {
      setScanningSources((current) => {
        const next = { ...current };
        for (const key of sources) if (sourceEpoch.current[key] === ticket) next[key] = false;
        return next;
      });
    }
  }, []);

  const refresh = useCallback(async (source?: SessionSourceId) => {
    if (pending.current && pending.current.phase !== "confirming") return;
    await read(source);
  }, [read]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  function request(target: PendingRemoval) {
    if (pending.current) return;
    const snapshot = target.kind === "selected" ? { ...target, records: target.records.map((record) => ({ ...record })) } : { ...target };
    pending.current = { id: ++operationId.current, phase: "confirming", target: snapshot };
    setOperation(pending.current);
    setOutcome(null);
  }

  function cancel(id: number) {
    if (pending.current?.id !== id || pending.current.phase !== "confirming") return;
    pending.current = null;
    setOperation(null);
  }

  async function confirm(id: number) {
    const approval = pending.current;
    if (!approval || approval.id !== id || approval.phase !== "confirming") return;
    const target = approval.target;
    pending.current = { ...approval, phase: "executing" };
    setOperation(pending.current);
    // Reads started before this removal cannot restore its old inventory.
    sourceEpoch.current[target.source] = ++epoch.current;
    setScanningSources((current) => ({ ...current, [target.source]: false }));
    let result: SessionRemovalResult;
    try {
      result = target.kind === "one"
        ? await invoke<SessionRemovalResult>("remove_session_record", { source: target.source, id: target.id })
        : target.kind === "age"
          ? await invoke<SessionRemovalResult>("remove_session_records_older_than", { source: target.source, days: target.days })
          : await invoke<SessionRemovalResult>("remove_session_records", { source: target.source, ids: target.records.map((record) => record.id) });
    } catch (caught) {
      result = { moved: 0, failed: 0, skipped: 0, items: [], operationError: errorToString(caught), message: null };
    }
    const completedIds = result.items.filter((item) => item.status === "Moved").map((item) => item.id);
    setScan((current) => current && {
      ...current,
      [target.source]: { ...current[target.source], records: current[target.source].records.filter((record) => !completedIds.includes(record.id)) },
    });
    setOutcome({ source: target.source, result, completedIds, refresh: { status: "refreshing", message: null } });
    pending.current = { ...approval, phase: "refreshing" };
    setOperation(pending.current);
    await read(target.source);
    pending.current = null;
    setOperation(null);
  }

  return { scan, scanningSources, error, refresh, operation, outcome, request, confirm, cancel };
}

function emptySource(): SessionSourceScan {
  return { directory: "", status: "Missing", records: [], message: null };
}
