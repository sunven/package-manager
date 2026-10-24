import { managerOrder } from "./constants";
import type { ManagerId } from "./types";
import {
  managerObservationId,
  OBSERVATION_GROUPS,
  OBSERVATION_ITEMS,
  type ObservationGroupId,
  type ObservationItemId,
} from "./observationItems";
import type { ObservationScope, ObservationScopes, ObservationRecord } from "./observationLedger";
import type { ObservationFacts, ObservationFactsMap } from "./observationFacts";

export type CoverageStatus =
  | "disabled"
  | "inProgress"
  | "invalidated"
  | "scopeChanged"
  | "failed"
  | "unavailable"
  | "observed"
  | "partial"
  | "lastObserved"
  | "notObserved";

export interface ObservationCoverageItem {
  id: ObservationItemId;
  group: ObservationGroupId;
  label: string;
  status: CoverageStatus;
  completeness: "complete" | "partial" | "unknown";
  note: string | null;
  lastSuccessAt: number | null;
  lastSuccessScopeLabel: string | null;
  lastAttemptAt: number | null;
  lastAttemptOutcome: "succeeded" | "failed" | "unavailable" | null;
  lastAttemptReason: string | null;
  invalidatedAt: number | null;
  invalidatedReason: string | null;
  currentScopeLabel: string | null;
  scopeChanged: boolean;
  attention: boolean;
  actions: { view: boolean; refresh: boolean; adjustScope: boolean };
}

export interface ObservationCoverageGroup {
  id: ObservationGroupId;
  label: string;
  items: ObservationCoverageItem[];
  attentionCount: number;
  observedCount: number;
  disabledCount: number;
  inProgressCount: number;
  enabledCount: number;
}

export interface ObservationCoverageSummary {
  observed: number;
  partial: number;
  failed: number;
  unavailable: number;
  invalidated: number;
  scopeChanged: number;
  notObserved: number;
  disabled: number;
  inProgress: number;
  attention: number;
}

export interface ObservationCoverage {
  items: ObservationCoverageItem[];
  groups: ObservationCoverageGroup[];
  summary: ObservationCoverageSummary;
}

export interface ObservationCoverageInput {
  records: Partial<Record<ObservationItemId, ObservationRecord>>;
  facts: ObservationFactsMap;
  scopes: ObservationScopes;
  enabledManagers: ManagerId[];
}

const REFRESHABLE = new Set<ObservationItemId>([
  "environment",
  "vscode-storage",
  "session:codex",
  "session:claude",
  "session:opencode",
  "codex:marketplaces",
  "codex:plugins",
  "codex:hooks",
  "codex:skills",
  "claude:extensions",
  "claude:hooks",
  "claude:skills",
]);

const MANAGER_IDS = new Map(managerOrder.map((manager) => [managerObservationId(manager), manager]));

function emptyFacts(): ObservationFacts {
  return { phase: "idle", success: null, failure: null, invalidated: null, currentScope: null };
}

function activeManagerId(id: ObservationItemId): ManagerId | null {
  return MANAGER_IDS.get(id) ?? null;
}

function currentScope(
  id: ObservationItemId,
  facts: ObservationFacts,
  scopes: ObservationScopes,
): ObservationScope | null {
  return scopes[id] ?? facts.currentScope ?? null;
}

function effectiveStatus(
  disabled: boolean,
  facts: ObservationFacts,
  record: ObservationRecord | undefined,
  changed: boolean,
): CoverageStatus {
  if (disabled) return "disabled";
  if (facts.phase === "reading") return "inProgress";
  const invalidation = facts.invalidated ?? record?.invalidated ?? null;
  if (invalidation && !facts.success) return "invalidated";
  if (changed) return "scopeChanged";
  if (facts.failure) return facts.failure.outcome === "unavailable" ? "unavailable" : "failed";
  if (facts.success) return facts.success.completeness === "partial" ? "partial" : "observed";
  if (record?.lastAttempt && record.lastAttempt.outcome !== "succeeded") {
    return record.lastAttempt.outcome === "unavailable" ? "unavailable" : "failed";
  }
  if (record?.lastSuccess) return "lastObserved";
  return "notObserved";
}

function completenessFor(
  status: CoverageStatus,
  facts: ObservationFacts,
  record: ObservationRecord | undefined,
): "complete" | "partial" | "unknown" {
  if (status === "observed" || status === "partial") return facts.success?.completeness ?? "unknown";
  if (status === "lastObserved") return record?.lastSuccess?.completeness ?? "unknown";
  if (status === "inProgress") {
    return facts.success?.completeness ?? record?.lastSuccess?.completeness ?? "unknown";
  }
  if (status === "disabled" || status === "invalidated") {
    return record?.lastSuccess?.completeness ?? facts.success?.completeness ?? "unknown";
  }
  return "unknown";
}

function noteFor(
  status: CoverageStatus,
  id: ObservationItemId,
  facts: ObservationFacts,
  record: ObservationRecord | undefined,
  current: ObservationScope | null,
): string | null {
  if (status === "failed" || status === "unavailable") {
    return facts.failure?.reason ?? record?.lastAttempt?.reason ?? null;
  }
  if (status === "invalidated") {
    return facts.invalidated?.reason ?? record?.invalidated?.reason ?? null;
  }
  if (status === "scopeChanged") return "范围已变化";
  if (status === "observed" || status === "partial") return facts.success?.note ?? null;
  if (status === "lastObserved") return record?.lastSuccess?.note ?? null;
  if (status === "inProgress") {
    return facts.success?.note ?? record?.lastSuccess?.note ?? null;
  }
  if (status === "disabled") return record?.lastSuccess?.note ?? null;
  if (status === "notObserved" && id === "project-scan" && !current) {
    return "未选择扫描根目录";
  }
  return null;
}

function attentionFor(status: CoverageStatus, completeness: "complete" | "partial" | "unknown") {
  if (status === "disabled" || status === "observed" || status === "inProgress") return false;
  if (status === "lastObserved") return completeness === "partial";
  return true;
}

function compareScope(
  facts: ObservationFacts,
  record: ObservationRecord | undefined,
  current: ObservationScope | null,
) {
  const observed = facts.success?.scope ?? record?.lastSuccess?.scope ?? null;
  return Boolean(current?.key && observed && current.key !== observed);
}

export function buildObservationCoverage(input: ObservationCoverageInput): ObservationCoverage {
  const enabled = new Set(input.enabledManagers);
  const items: ObservationCoverageItem[] = OBSERVATION_ITEMS.map((item) => {
    const facts = input.facts[item.id] ?? emptyFacts();
    const record = input.records[item.id];
    const manager = activeManagerId(item.id);
    const disabled = Boolean(manager && !enabled.has(manager));
    const current = currentScope(item.id, facts, input.scopes);
    const changed = compareScope(facts, record, current);
    let status = effectiveStatus(disabled, facts, record, changed);
    if (item.id === "project-scan" && !current && !facts.success && !facts.failure) {
      status = "notObserved";
    }
    const completeness = completenessFor(status, facts, record);
    const attention = attentionFor(status, completeness);
    const liveAttemptSucceeded = Boolean(facts.success && !facts.failure);
    return {
      id: item.id,
      group: item.group,
      label: item.label,
      status,
      completeness,
      note: noteFor(status, item.id, facts, record, current),
      lastSuccessAt: facts.success?.at ?? record?.lastSuccess?.at ?? null,
      lastSuccessScopeLabel: facts.success?.scopeLabel ?? record?.lastSuccess?.scopeLabel ?? null,
      lastAttemptAt: facts.failure
        ? record?.lastAttempt?.at ?? null
        : liveAttemptSucceeded
          ? facts.success?.at ?? record?.lastAttempt?.at ?? null
          : record?.lastAttempt?.at ?? null,
      lastAttemptOutcome: facts.failure?.outcome ?? (liveAttemptSucceeded ? "succeeded" : record?.lastAttempt?.outcome ?? null),
      lastAttemptReason: facts.failure?.reason ?? (liveAttemptSucceeded ? null : record?.lastAttempt?.reason ?? null),
      invalidatedAt: facts.invalidated?.at ?? record?.invalidated?.at ?? null,
      invalidatedReason: facts.invalidated?.reason ?? record?.invalidated?.reason ?? null,
      currentScopeLabel: current?.label ?? null,
      scopeChanged: changed,
      attention,
      actions: {
        view: true,
        refresh: REFRESHABLE.has(item.id) && !disabled,
        adjustScope: Boolean(manager) || item.id === "project-scan",
      },
    };
  });

  const groups = OBSERVATION_GROUPS.map((group) => {
    const groupItems = items.filter((item) => item.group === group.id);
    const disabledCount = groupItems.filter((item) => item.status === "disabled").length;
    return {
      id: group.id,
      label: group.label,
      items: groupItems,
      attentionCount: groupItems.filter((item) => item.attention).length,
      observedCount: groupItems.filter((item) =>
        item.status === "observed" || item.status === "lastObserved" || item.status === "partial"
      ).length,
      disabledCount,
      inProgressCount: groupItems.filter((item) => item.status === "inProgress").length,
      enabledCount: groupItems.length - disabledCount,
    };
  });

  const count = (status: CoverageStatus) => items.filter((item) => item.status === status).length;
  const observed = items.filter((item) =>
    item.status === "observed" || item.status === "lastObserved" || item.status === "partial"
  ).length;
  const summary: ObservationCoverageSummary = {
    observed,
    partial: items.filter((item) =>
      (item.status === "observed" || item.status === "lastObserved" || item.status === "partial")
      && item.completeness === "partial"
    ).length,
    failed: count("failed"),
    unavailable: count("unavailable"),
    invalidated: count("invalidated"),
    scopeChanged: count("scopeChanged"),
    notObserved: count("notObserved"),
    disabled: count("disabled"),
    inProgress: count("inProgress"),
    attention: items.filter((item) => item.attention).length,
  };

  return { items, groups, summary };
}

export type ObservationCoverageIndex = ReadonlyMap<ObservationItemId, ObservationCoverageItem>;

export function indexObservationCoverage(coverage: ObservationCoverage): ObservationCoverageIndex {
  return new Map(coverage.items.map((item) => [item.id, item]));
}

export function requireCoverageItem(
  index: ObservationCoverageIndex,
  id: ObservationItemId,
): ObservationCoverageItem {
  const item = index.get(id);
  if (!item) throw new Error(`Missing observation coverage item: ${id}`);
  return item;
}

export function managerCoverageByManager(index: ObservationCoverageIndex): Record<ManagerId, ObservationCoverageItem> {
  return Object.fromEntries(
    managerOrder.map((manager) => [manager, requireCoverageItem(index, managerObservationId(manager))]),
  ) as Record<ManagerId, ObservationCoverageItem>;
}

export function formatObservationTime(at: number, now = Date.now()) {
  return `${new Date(at).toLocaleString()}（${relativeObservationTime(at, now)}）`;
}

export function relativeObservationTime(at: number, now = Date.now()) {
  const delta = Math.max(0, now - at);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < 2 * day) return "昨天";
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
  return new Date(at).toLocaleDateString();
}
