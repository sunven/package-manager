import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { openCodeDeletionPlan, type OpenCodeDeletionResult, type OpenCodeSessionScan, type SessionRefresh } from "../sessionRecords";
import { errorToString } from "../utils/format";

type PendingDeletion = { kind: "one" | "selected"; plan: ReturnType<typeof openCodeDeletionPlan> };
type Operation = { id: number; phase: "confirming" | "executing" | "refreshing"; target: PendingDeletion };
type DeletionOutcome = { pending: PendingDeletion; result: OpenCodeDeletionResult | null; error: string | null; completedIds: string[]; refresh: SessionRefresh };

export function useOpenCodeSessions(active: boolean) {
  const [scan, setScan] = useState<OpenCodeSessionScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [outcome, setOutcome] = useState<DeletionOutcome | null>(null);
  const pending = useRef<Operation | null>(null);
  const operationId = useRef(0);
  const epoch = useRef(0);

  const read = useCallback(async () => {
    const ticket = ++epoch.current;
    setScanning(true);
    setError(null);
    setOutcome((current) => current && { ...current, refresh: { status: "refreshing", message: null } });
    try {
      const next = await invoke<OpenCodeSessionScan>("scan_opencode_sessions");
      if (epoch.current === ticket) {
        setScan((current) => epoch.current !== ticket ? current : next.status === "ready" ? next : { ...next, records: current?.records ?? [] });
        setOutcome((current) => current && epoch.current === ticket ? {
          ...current,
          refresh: { status: next.status === "ready" ? "ready" : "failed", message: next.status === "ready" ? null : next.message ?? "OpenCode 会话暂不可读取。" },
        } : current);
      }
    } catch (caught) {
      if (epoch.current === ticket) {
        const message = errorToString(caught);
        setError(message);
        setScan((current) => current && epoch.current === ticket ? { ...current, status: "failed", message: null } : current);
        setOutcome((current) => current && epoch.current === ticket ? { ...current, refresh: { status: "failed", message } } : current);
      }
    } finally {
      if (epoch.current === ticket) setScanning(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (pending.current && pending.current.phase !== "confirming") return;
    await read();
  }, [read]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const openSession = useCallback(async (sessionId: string) => {
    try {
      await invoke("open_opencode_session", { sessionId });
      return null;
    } catch (caught) {
      return errorToString(caught);
    }
  }, []);

  function request(kind: "one" | "selected", ids: string[]) {
    if (pending.current || scan?.status !== "ready") return;
    const plan = openCodeDeletionPlan(scan.records.map((record) => ({ ...record })), ids);
    if (!plan.selected.length || (kind === "one" && plan.selected.length !== 1)) return;
    pending.current = { id: ++operationId.current, phase: "confirming", target: { kind, plan } };
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
    ++epoch.current;
    setScanning(false);
    let result: OpenCodeDeletionResult | null = null;
    let failure: string | null = null;
    try {
      if (target.kind === "one") {
        const sessionId = target.plan.selected[0].id;
        await invoke("delete_opencode_session", { sessionId });
        result = { preflightError: null, items: [{ id: sessionId, status: "deleted", message: null }] };
      } else {
        // The backend needs every explicit target to preflight missing records;
        // it deduplicates the actual DELETE requests after reading current ancestry.
        result = await invoke<OpenCodeDeletionResult>("delete_opencode_sessions", { sessionIds: target.plan.selected.map((record) => record.id) });
      }
    } catch (caught) {
      // The single-delete command cannot distinguish rejection from a lost response.
      failure = errorToString(caught);
    }
    const deleted = result?.items.filter((item) => item.status === "deleted").map((item) => item.id) ?? [];
    const completedIds = openCodeDeletionPlan(target.plan.affectedRecords, deleted).affectedRecords.map((record) => record.id);
    setScan((current) => current && { ...current, records: current.records.filter((record) => !completedIds.includes(record.id)) });
    const needsRefresh = !result?.preflightError;
    setOutcome({ pending: target, result, error: failure, completedIds, refresh: { status: needsRefresh ? "refreshing" : "notRequested", message: null } });
    if (needsRefresh) {
      pending.current = { ...approval, phase: "refreshing" };
      setOperation(pending.current);
      await read();
    }
    pending.current = null;
    setOperation(null);
  }

  return { scan, scanning, error, refresh, openSession, operation, outcome, request, confirm, cancel };
}
