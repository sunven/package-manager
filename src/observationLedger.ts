import { invoke } from "@tauri-apps/api/core";
import type { ManagerId } from "./types";
import {
  OBSERVATION_ITEM_BY_ID,
  type ObservationItemId,
} from "./observationItems";
import { errorToString } from "./utils/format";

export type ObservationCompleteness = "complete" | "partial" | "unknown";
export type ObservationAttemptOutcome = "succeeded" | "failed" | "unavailable";

export interface ObservationSuccessRecord {
  at: number;
  scope: string | null;
  scopeLabel: string | null;
  completeness: ObservationCompleteness;
  note: string | null;
}

export interface ObservationAttemptRecord {
  at: number;
  outcome: ObservationAttemptOutcome;
  scope: string | null;
  reason: string | null;
}

export interface ObservationInvalidationRecord {
  at: number;
  reason: string;
}

export interface ObservationRecord {
  itemId: ObservationItemId;
  lastSuccess: ObservationSuccessRecord | null;
  lastAttempt: ObservationAttemptRecord | null;
  invalidated: ObservationInvalidationRecord | null;
}

export interface ObservationScope {
  key: string;
  label: string;
}

export type ObservationScopes = Partial<Record<ObservationItemId, ObservationScope | null>>;

export type ObservationEvent =
  | {
      kind: "success";
      itemId: ObservationItemId;
      at: number;
      scope: string | null;
      scopeLabel: string | null;
      completeness: ObservationCompleteness;
      note: string | null;
    }
  | {
      kind: "attempt";
      itemId: ObservationItemId;
      at: number;
      outcome: "failed" | "unavailable";
      scope: string | null;
      reason: string;
    }
  | {
      kind: "invalidate";
      itemId: ObservationItemId;
      at: number;
      reason: string;
    };

export interface ObservationLedgerSnapshot {
  records: Partial<Record<ObservationItemId, ObservationRecord>>;
  warnings: string[];
  loaded: boolean;
}

const EMPTY_RECORD = (itemId: ObservationItemId): ObservationRecord => ({
  itemId,
  lastSuccess: null,
  lastAttempt: null,
  invalidated: null,
});

let snapshot: ObservationLedgerSnapshot = { records: {}, warnings: [], loaded: false };
let loadPromise: Promise<void> | null = null;
let writeQueue = Promise.resolve();
const listeners = new Set<() => void>();

function tauriAvailable() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function emit() {
  for (const listener of listeners) listener();
}

function setSnapshot(next: ObservationLedgerSnapshot) {
  snapshot = next;
  emit();
}

function addWarning(warning: string) {
  if (snapshot.warnings.includes(warning)) return;
  setSnapshot({ ...snapshot, warnings: [...snapshot.warnings, warning] });
}

function cap(value: string | null, limit: number) {
  return value === null ? null : [...value].slice(0, limit).join("");
}

function applyEvent(records: Partial<Record<ObservationItemId, ObservationRecord>>, event: ObservationEvent) {
  const current = records[event.itemId] ?? EMPTY_RECORD(event.itemId);
  const scope = cap(event.kind === "invalidate" ? null : event.scope, 500);
  const next: ObservationRecord = {
    itemId: event.itemId,
    lastSuccess: current.lastSuccess,
    lastAttempt: current.lastAttempt,
    invalidated: current.invalidated,
  };
  if (event.kind === "success") {
    next.lastSuccess = {
      at: event.at,
      scope,
      scopeLabel: cap(event.scopeLabel, 300),
      completeness: event.completeness,
      note: cap(event.note, 500),
    };
    next.lastAttempt = { at: event.at, outcome: "succeeded", scope, reason: null };
    next.invalidated = null;
  } else if (event.kind === "attempt") {
    next.lastAttempt = {
      at: event.at,
      outcome: event.outcome,
      scope,
      reason: cap(event.reason, 500),
    };
  } else {
    next.invalidated = { at: event.at, reason: cap(event.reason, 500) ?? "" };
  }
  return { ...records, [event.itemId]: next };
}

function later<T extends { at: number }>(left: T | null, right: T | null): T | null {
  if (!left) return right;
  if (!right) return left;
  return right.at >= left.at ? right : left;
}

function mergeRecord(loaded: ObservationRecord, local: ObservationRecord | undefined): ObservationRecord {
  if (!local) return loaded;
  const lastSuccess = later(loaded.lastSuccess, local.lastSuccess);
  const lastAttempt = later(loaded.lastAttempt, local.lastAttempt);
  let invalidated = later(loaded.invalidated, local.invalidated);
  if (lastSuccess && invalidated && lastSuccess.at >= invalidated.at) invalidated = null;
  return { itemId: loaded.itemId, lastSuccess, lastAttempt, invalidated };
}

export function getObservationLedgerSnapshot() {
  return snapshot;
}

export function subscribeObservationLedger(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadObservationLedgerOnce() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!tauriAvailable()) {
      setSnapshot({ ...snapshot, loaded: true });
      return;
    }
    try {
      const result = await invoke<{ records: ObservationRecord[]; warnings: string[] }>("load_observation_ledger");
      const loadedRecords: Partial<Record<ObservationItemId, ObservationRecord>> = {};
      for (const record of result.records) {
        if (!OBSERVATION_ITEM_BY_ID.has(record.itemId)) continue;
        const local = snapshot.records[record.itemId];
        loadedRecords[record.itemId] = mergeRecord(record, local);
      }
      const records = { ...loadedRecords };
      for (const [id, local] of Object.entries(snapshot.records) as [ObservationItemId, ObservationRecord][]) {
        if (!records[id]) records[id] = local;
      }
      setSnapshot({
        records,
        warnings: [...new Set([...snapshot.warnings, ...(result.warnings ?? [])])],
        loaded: true,
      });
    } catch (error) {
      setSnapshot({
        ...snapshot,
        warnings: [...new Set([...snapshot.warnings, `观察台账无法读取：${errorToString(error)}`])],
        loaded: true,
      });
    }
  })();
  return loadPromise;
}

export function recordObservation(event: ObservationEvent) {
  if (!OBSERVATION_ITEM_BY_ID.has(event.itemId)) {
    throw new Error(`Unknown observation item: ${event.itemId}`);
  }
  setSnapshot({ ...snapshot, records: applyEvent(snapshot.records, event) });
  if (!tauriAvailable()) return;
  writeQueue = writeQueue.then(async () => {
    try {
      const result = await invoke<{ warning: string | null }>("record_observation", { event });
      if (result?.warning) addWarning(result.warning);
    } catch (error) {
      addWarning(`观察台账未保存：${errorToString(error)}`);
    }
  });
}

export async function flushObservationLedgerWrites() {
  await writeQueue;
}

export async function loadObservationScopes(enabledManagers: ManagerId[]): Promise<ObservationScopes> {
  if (!tauriAvailable()) return {};
  const result = await invoke<Record<string, ObservationScope | null>>("load_observation_scopes", { enabledManagers });
  const scopes: ObservationScopes = {};
  for (const [id, scope] of Object.entries(result)) {
    if (OBSERVATION_ITEM_BY_ID.has(id as ObservationItemId)) {
      scopes[id as ObservationItemId] = scope;
    }
  }
  return scopes;
}

export function resetObservationLedgerForTests() {
  snapshot = { records: {}, warnings: [], loaded: false };
  loadPromise = null;
  writeQueue = Promise.resolve();
  listeners.clear();
}
