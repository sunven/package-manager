import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import {
  openCodeAgeDeletionPlan,
  openCodeDeletionPlan,
  type OpenCodeDeletionResult,
  type OpenCodeSessionScan,
} from "../sessionRecords";
import { errorToString } from "../utils/format";
import { useSessionOperation, type SessionOperationAdapter, type SessionRead } from "./useSessionOperation";

type PendingDeletion = { kind: "one" | "selected"; plan: ReturnType<typeof openCodeDeletionPlan> }
  | { kind: "age"; days: 7 | 30; cutoffMs: number; plan: ReturnType<typeof openCodeDeletionPlan> };

const OPENCODE_SCOPES = ["opencode"] as const;

const adapter: SessionOperationAdapter<"opencode", OpenCodeSessionScan, PendingDeletion, OpenCodeDeletionResult> = {
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
  execute: async (target): Promise<OpenCodeDeletionResult> => {
    if (target.kind === "one") {
      const sessionId = target.plan.selected[0].id;
      await invoke("delete_opencode_session", { sessionId });
      return { preflightError: null, items: [{ id: sessionId, status: "deleted", message: null }] };
    }
    if (target.kind === "age") {
      return invoke<OpenCodeDeletionResult>("delete_opencode_sessions_older_than", {
        sessionIds: target.plan.roots.map((record) => record.id),
        cutoffMs: target.cutoffMs,
        expectedRecords: target.plan.affectedRecords.map(({ id, parentId }) => ({ id, parentId })),
      });
    }
    // The backend preflights every explicit target, then deduplicates the DELETE
    // requests by the ancestry it reads at execution time.
    return invoke<OpenCodeDeletionResult>("delete_opencode_sessions", {
      sessionIds: target.plan.selected.map((record) => record.id),
    });
  },
  completedIds: (target, result) => {
    const deleted = result.items.filter((item) => item.status === "deleted").map((item) => item.id);
    return openCodeDeletionPlan(target.plan.affectedRecords, deleted).affectedRecords.map((record) => record.id);
  },
  removeCompleted: (scans, _target, completedIds) => {
    const scan = scans.opencode;
    return scan
      ? { ...scans, opencode: { ...scan, records: scan.records.filter((record) => !completedIds.includes(record.id)) } }
      : scans;
  },
  shouldRefresh: (target, result) => target.kind === "age" || !result?.preflightError,
};

export function useOpenCodeSessions(active: boolean) {
  const { scans, scanning, error, operation, outcome, refresh, begin, cancel, confirm } =
    useSessionOperation(adapter, { active, scopes: OPENCODE_SCOPES });
  const scan = scans.opencode ?? null;

  const openSession = useCallback(async (sessionId: string) => {
    try {
      await invoke("open_opencode_session", { sessionId });
      return null;
    } catch (caught) {
      return errorToString(caught);
    }
  }, []);

  function request(kind: "one" | "selected", ids: string[]) {
    if (operation || scan?.status !== "ready") return;
    const plan = openCodeDeletionPlan(scan.records.map((record) => ({ ...record })), ids);
    if (!plan.selected.length || (kind === "one" && plan.selected.length !== 1)) return;
    begin({ kind, plan });
  }

  function requestAge(days: 7 | 30, nowMs: number = Date.now()) {
    if (operation || scanning.opencode || scan?.status !== "ready") return;
    const target = openCodeAgeDeletionPlan(
      scan.records.map((record) => ({ ...record })),
      scan.activeSessionIds,
      days,
      nowMs,
    );
    if (!target) return;
    begin({ kind: "age", ...target });
  }

  const publicOutcome = outcome ? {
    pending: outcome.target,
    result: outcome.result,
    error: outcome.error,
    completedIds: outcome.completedIds,
    refresh: outcome.refresh,
  } : null;

  return {
    scan,
    scanning: scanning.opencode ?? false,
    error,
    refresh: () => refresh(OPENCODE_SCOPES),
    openSession,
    operation,
    outcome: publicOutcome,
    request,
    requestAge,
    confirm,
    cancel,
  };
}
