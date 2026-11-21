import { useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  ageEligibleCounts,
  removeCompletedRecords,
  type SessionRecord,
  type SessionRecordScan,
  type SessionRemovalProgress,
  type SessionRemovalResult,
  type SessionSourceId,
  type SessionSourceScan,
} from "../sessionRecords";
import { recordMaintenanceFollowUp } from "../maintenanceFollowUp";
import { errorToString } from "../utils/format";
import { recordObservationFacts, sessionObservationFacts, type ObservationFacts } from "../observationFacts";
import { sessionObservationId } from "../observationItems";
import { useSessionOperation, type SessionOperationAdapter, type SessionRead } from "./useSessionOperation";

type PendingRemoval = (
  | { kind: "one"; source: SessionSourceId; record: SessionRecord }
  | { kind: "age"; source: SessionSourceId; label: string; days: 7 | 30; count: number }
  | { kind: "selected"; source: SessionSourceId; label: string; records: SessionRecord[] }) & { expectedDirectory?: string; cutoffMs?: number };

function confirmedRecord(record: SessionRecord) {
  return {
    id: record.id,
    title: record.title,
    workingDirectory: record.workingDirectory,
    lastActivityMs: record.lastActivityMs,
  };
}

const SESSION_SCOPES = ["codex", "claude", "grok", "qoder", "qoder-cn"] as const;

type SessionSourceObservation = {
  scan: SessionSourceScan | null;
  scanning: boolean;
  facts: ObservationFacts;
};

function isDirectoryScoped(source: SessionSourceId) {
  return source === "grok" || source === "qoder" || source === "qoder-cn";
}

function failedSource(previous: SessionSourceScan | undefined, message: string): SessionSourceScan {
  return {
    directory: "",
    records: [],
    ageEligible: { days7: 0, days30: 0 },
    ...previous,
    status: "Failed",
    message,
  };
}

function retained(previous: SessionSourceScan | undefined, next: SessionSourceScan): SessionSourceScan {
  return next.status === "Failed"
    ? {
        ...next,
        records: previous?.records ?? [],
        ageEligible: previous?.ageEligible ?? next.ageEligible,
      }
    : next;
}

function failureOf(scan: SessionSourceScan) {
  return scan.status === "Failed" || scan.status === "Partial"
    ? scan.message ?? "会话记录未能完整读取。"
    : undefined;
}

function abortedResult(message: string): SessionRemovalResult {
  return { moved: 0, failed: 0, skipped: 0, items: [], operationError: message, message: null };
}

const adapter: SessionOperationAdapter<SessionSourceId, SessionSourceScan, PendingRemoval, SessionRemovalResult, SessionRemovalProgress> = {
  observe: (source, scan, failure, at, readFailed) => {
    const error = readFailed || !scan || scan.status === "Failed"
      ? failure ?? "会话记录读取失败"
      : null;
    recordObservationFacts(
      sessionObservationId(source),
      sessionObservationFacts(source, scan, false, error),
      at,
    );
  },
  read: async (scopes, previous): Promise<SessionRead<SessionSourceId, SessionSourceScan>> => {
    if (scopes.length === 1) {
      const source = scopes[0];
      try {
        const next = await invoke<SessionSourceScan>("scan_session_source", { source });
        const scan = retained(previous[source], next);
        const failure = failureOf(scan);
        return {
          scans: { [source]: scan },
          failures: failure ? { [source]: failure } : {},
          globalError: null,
        };
      } catch (caught) {
        const message = errorToString(caught);
        return {
          scans: { [source]: failedSource(previous[source], message) },
          failures: { [source]: message },
          globalError: null,
        };
      }
    }

    try {
      const next = await invoke<SessionRecordScan>("scan_session_records");
      const scans: Partial<Record<SessionSourceId, SessionSourceScan>> = {};
      const failures: Partial<Record<SessionSourceId, string>> = {};
      for (const source of scopes) {
        const nextSource = next[source];
        if (!nextSource) continue;
        const scan = retained(previous[source], nextSource);
        scans[source] = scan;
        const failure = failureOf(scan);
        if (failure) failures[source] = failure;
      }
      return { scans, failures, globalError: null };
    } catch (caught) {
      const message = errorToString(caught);
      const scans: Partial<Record<SessionSourceId, SessionSourceScan>> = {};
      const failures: Partial<Record<SessionSourceId, string>> = {};
      for (const source of scopes) {
        scans[source] = failedSource(previous[source], message);
        failures[source] = message;
      }
      return { scans, failures, globalError: message };
    }
  },
  scopesFor: (target) => [target.source],
  execute: (target, report) => {
    const scope = isDirectoryScoped(target.source) ? { expectedDirectory: target.expectedDirectory } : {};
    if (target.kind === "one") {
      return invoke<SessionRemovalResult>("remove_session_record", {
        source: target.source,
        id: target.record.id,
        confirmedRecord: confirmedRecord(target.record),
        ...scope,
      });
    }
    const onProgress = new Channel<SessionRemovalProgress>(report);
    if (target.kind === "age") {
      return invoke<SessionRemovalResult>("remove_session_records_older_than", {
        source: target.source,
        days: target.days,
        confirmedCount: target.count,
        ...scope,
        ...(isDirectoryScoped(target.source) ? { cutoffMs: target.cutoffMs } : {}),
        onProgress,
      });
    }
    return invoke<SessionRemovalResult>("remove_session_records", {
      source: target.source,
      ids: target.records.map((record) => record.id),
      confirmedRecords: target.records.map(confirmedRecord),
      ...scope,
      onProgress,
    });
  },
  completedIds: (_target, result) => result.items
    .filter((item) => item.status === "Moved")
    .map((item) => item.id),
  removeCompleted: (scans, target, completedIds) => {
    const next = removeCompletedRecords(scans, target.source, completedIds);
    if (completedIds.length === 0) return next;
    const scan = next[target.source];
    return scan
      ? { ...next, [target.source]: { ...scan, ageEligible: ageEligibleCounts(scan.records, Date.now()) } }
      : next;
  },
  shouldRefresh: () => false,
};

export function useSessionRecords(active: boolean) {
  const { scans, scanning, error, operation, outcome, refresh, begin, cancel, confirm } =
    useSessionOperation(adapter, {
      active,
      scopes: SESSION_SCOPES,
      readOnActivate: false,
      recordFollowUp: recordMaintenanceFollowUp,
    });
  const activated = useRef(false);

  useEffect(() => {
    if (!active) {
      activated.current = false;
      return;
    }
    if (activated.current) return;
    activated.current = true;
    void Promise.all(SESSION_SCOPES.map((scope) => refresh([scope])));
  }, [active, refresh]);

  const [openingSession, setOpeningSession] = useState<{ source: SessionSourceId; id: string } | null>(null);
  const opening = useRef(false);
  const mutation = useRef(false);
  const sources = useMemo(
    () => Object.fromEntries(SESSION_SCOPES.map((source) => {
      const scan = scans[source] ?? null;
      const busy = scanning[source] ?? false;
      return [source, { scan, scanning: busy, facts: sessionObservationFacts(source, scan, busy, null) }];
    })) as Record<SessionSourceId, SessionSourceObservation>,
    [scans, scanning],
  );
  async function openSession(source: SessionSourceId, record: SessionRecord): Promise<string | null> {
    if (opening.current || mutation.current || operation || scanning[source]) return "当前操作尚未结束，请稍后重试。";
    const scanSource = scans[source];
    if (!scanSource || scanSource.status === "Failed") return "请先刷新会话记录。";
    if (source === "grok") {
      if (!record.grok) return "请先刷新 Grok Build 会话记录。";
      if (record.grok.resumeError) return record.grok.resumeError;
    }
    opening.current = true;
    setOpeningSession({ source, id: record.id });
    try {
      if (source === "grok") {
        await invoke("open_grok_session", { id: record.id, expectedDirectory: scanSource.directory });
      } else if (source === "qoder" || source === "qoder-cn") {
        await invoke("open_qoder_session", { source, id: record.id, expectedDirectory: scanSource.directory });
      }
      void refresh([source]);
      return null;
    } catch (caught) {
      return errorToString(caught);
    } finally {
      opening.current = false;
      setOpeningSession(null);
    }
  }
  function request(target: PendingRemoval) {
    if (opening.current || mutation.current) return;
    if (scans[target.source]?.removalBlockedReason) return;
    if (target.kind === "one" && target.record.inUse !== false) return;
    if (target.kind === "selected" && target.records.some((record) => record.inUse !== false)) return;
    if (isDirectoryScoped(target.source)) {
      const source = scans[target.source];
      if (!source || scanning[target.source] || source.status === "Failed" || source.removalBlockedReason) return;
      target = { ...target, expectedDirectory: source.directory,
        ...(target.kind === "age" ? { cutoffMs: Date.now() - target.days * 86_400_000 } : {}),
      };
    }
    mutation.current = true;
    begin(target);
  }
  const publicOutcome = outcome ? {
    source: outcome.target.source,
    result: outcome.result ?? (outcome.error ? abortedResult(outcome.error) : null),
    completedIds: outcome.completedIds,
    refresh: outcome.refresh,
    followUpWarning: outcome.followUpWarning,
  } : null;

  return {
    sources,
    error,
    refresh: (source?: SessionSourceId) => refresh(source ? [source] : SESSION_SCOPES),
    operation,
    outcome: publicOutcome,
    request,
    confirm: async (id: number) => { try { await confirm(id); } finally { mutation.current = false; } },
    cancel: (id: number) => { cancel(id); mutation.current = false; },
    openSession,
    openingSession,
  };
}
