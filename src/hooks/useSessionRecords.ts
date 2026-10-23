import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  SessionRecord,
  SessionRecordScan,
  SessionRemovalProgress,
  SessionRemovalResult,
  SessionSourceId,
  SessionSourceScan,
} from "../sessionRecords";
import { errorToString } from "../utils/format";
import { useSessionOperation, type SessionOperationAdapter, type SessionRead } from "./useSessionOperation";

type PendingRemoval =
  | { kind: "one"; source: SessionSourceId; record: SessionRecord }
  | { kind: "age"; source: SessionSourceId; label: string; days: 7 | 30; count: number }
  | { kind: "selected"; source: SessionSourceId; label: string; records: SessionRecord[] };

function confirmedRecord(record: SessionRecord) {
  return {
    id: record.id,
    title: record.title,
    workingDirectory: record.workingDirectory,
    lastActivityMs: record.lastActivityMs,
  };
}

const SESSION_SCOPES = ["codex", "claude"] as const;

function emptySource(): SessionSourceScan {
  return { directory: "", status: "Missing", records: [], message: null };
}

function retained(previous: SessionSourceScan | undefined, next: SessionSourceScan): SessionSourceScan {
  return next.status === "Failed" ? { ...next, records: previous?.records ?? [] } : next;
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
          scans: { [source]: { ...(previous[source] ?? emptySource()), status: "Failed", message } },
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
        const scan = retained(previous[source], next[source]);
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
        scans[source] = { ...(previous[source] ?? emptySource()), status: "Failed", message };
        failures[source] = message;
      }
      return { scans, failures, globalError: message };
    }
  },
  scopesFor: (target) => [target.source],
  execute: (target, report) => {
    if (target.kind === "one") {
      return invoke<SessionRemovalResult>("remove_session_record", {
        source: target.source,
        id: target.record.id,
        confirmedRecord: confirmedRecord(target.record),
      });
    }
    const onProgress = new Channel<SessionRemovalProgress>(report);
    if (target.kind === "age") {
      return invoke<SessionRemovalResult>("remove_session_records_older_than", {
        source: target.source,
        days: target.days,
        confirmedCount: target.count,
        onProgress,
      });
    }
    return invoke<SessionRemovalResult>("remove_session_records", {
      source: target.source,
      ids: target.records.map((record) => record.id),
      confirmedRecords: target.records.map(confirmedRecord),
      onProgress,
    });
  },
  completedIds: (_target, result) => result.items
    .filter((item) => item.status === "Moved")
    .map((item) => item.id),
  removeCompleted: (scans, target, completedIds) => {
    const scan = scans[target.source];
    return scan
      ? { ...scans, [target.source]: { ...scan, records: scan.records.filter((record) => !completedIds.includes(record.id)) } }
      : scans;
  },
  shouldRefresh: () => true,
  recordFollowUp: async (_target, result, refresh) => {
    if (!result.historyId) return;
    await invoke("record_maintenance_followup", {
      id: result.historyId,
      status: refresh.status,
      message: refresh.message,
    });
  },
};

export function useSessionRecords(active: boolean) {
  const { scans, scanning, error, operation, outcome, refresh, begin, cancel, confirm } =
    useSessionOperation(adapter, { active, scopes: SESSION_SCOPES });

  const scan: SessionRecordScan | null = scans.codex || scans.claude
    ? { codex: scans.codex ?? emptySource(), claude: scans.claude ?? emptySource() }
    : null;
  const scanningSources = { codex: scanning.codex ?? false, claude: scanning.claude ?? false };
  const publicOutcome = outcome ? {
    source: outcome.target.source,
    result: outcome.result ?? (outcome.error ? abortedResult(outcome.error) : null),
    completedIds: outcome.completedIds,
    refresh: outcome.refresh,
    followUpWarning: outcome.followUpWarning,
  } : null;

  return {
    scan,
    scanningSources,
    error,
    refresh: (source?: SessionSourceId) => refresh(source ? [source] : SESSION_SCOPES),
    operation,
    outcome: publicOutcome,
    request: (target: PendingRemoval) => begin(target),
    confirm,
    cancel,
  };
}
