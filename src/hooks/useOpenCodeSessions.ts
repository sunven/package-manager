import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type OpenCodeDeletionPlan,
  type OpenCodeDeletionResult,
  type OpenCodeSessionScan,
} from "../sessionRecords";
import { errorToString } from "../utils/format";
import { useSessionOperation, type SessionOperationAdapter, type SessionRead } from "./useSessionOperation";

const OPENCODE_SCOPES = ["opencode"] as const;

const adapter: SessionOperationAdapter<"opencode", OpenCodeSessionScan, OpenCodeDeletionPlan, OpenCodeDeletionResult> = {
  read: async (_scopes, previous): Promise<SessionRead<"opencode", OpenCodeSessionScan>> => {
    try {
      const next = await invoke<OpenCodeSessionScan>("scan_opencode_sessions");
      const scan = next.status === "ready" ? next : { ...next, records: previous.opencode?.records ?? [] };
      return {
        scans: { opencode: scan },
        failures: next.status === "ready" ? {} : { opencode: next.message ?? "OpenCode 会话暂不可读取。" },
        globalError: null,
      };
    } catch (caught) {
      const message = errorToString(caught);
      const previousScan = previous.opencode;
      return {
        scans: previousScan ? { opencode: { ...previousScan, status: "failed", message: null } } : {},
        failures: { opencode: message },
        globalError: message,
      };
    }
  },
  scopesFor: () => ["opencode"],
  execute: (target) => invoke<OpenCodeDeletionResult>("commit_opencode_deletion", { planId: target.planId }),
  completedIds: (_target, result) => result.completedIds,
  removeCompleted: (scans, _target, completedIds) => {
    const scan = scans.opencode;
    return scan
      ? { ...scans, opencode: { ...scan, records: scan.records.filter((record) => !completedIds.includes(record.id)) } }
      : scans;
  },
  shouldRefresh: (target, result) => target.kind === "age" || !result?.preflightError,
  recordFollowUp: async (_target, result, refresh) => {
    if (!result.historyId) return;
    await invoke("record_maintenance_followup", {
      id: result.historyId,
      status: refresh.status,
      message: refresh.message,
    });
  },
};

type PrepareIntent =
  | { kind: "one" | "selected"; sessionIds: string[] }
  | { kind: "age"; days: 7 | 30 };

export function useOpenCodeSessions(active: boolean) {
  const { scans, scanning, error, operation, outcome, refresh: refreshScans, begin, cancel, confirm } =
    useSessionOperation(adapter, { active, scopes: OPENCODE_SCOPES });
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const preparingRef = useRef(false);
  const scan = scans.opencode ?? null;

  const openSession = useCallback(async (sessionId: string) => {
    try {
      await invoke("open_opencode_session", { sessionId });
      return null;
    } catch (caught) {
      return errorToString(caught);
    }
  }, []);

  useEffect(() => {
    setPrepareError(null);
  }, [scan]);

  async function prepare(intent: PrepareIntent) {
    if (preparingRef.current || operation || scan?.status !== "ready") return;
    if (intent.kind === "age" && (scanning.opencode || scan.activeSessionIds === null)) return;
    preparingRef.current = true;
    setPreparing(true);
    setPrepareError(null);
    try {
      const plan = await invoke<OpenCodeDeletionPlan>("prepare_opencode_deletion", { request: intent });
      begin(plan);
    } catch (caught) {
      setPrepareError(errorToString(caught));
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  }

  function request(kind: "one" | "selected", ids: string[]) {
    return prepare({ kind, sessionIds: ids });
  }

  function requestAge(days: 7 | 30) {
    return prepare({ kind: "age", days });
  }

  async function refresh() {
    setPrepareError(null);
    await refreshScans(OPENCODE_SCOPES);
  }

  const publicOutcome = outcome ? {
    pending: outcome.target,
    result: outcome.result,
    error: outcome.error,
    completedIds: outcome.completedIds,
    refresh: outcome.refresh,
    followUpWarning: outcome.followUpWarning,
  } : null;

  return {
    scan,
    scanning: scanning.opencode ?? false,
    preparing,
    prepareError,
    error,
    refresh,
    openSession,
    operation,
    outcome: publicOutcome,
    request,
    requestAge,
    confirm,
    cancel,
  };
}
