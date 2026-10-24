import { managerOrder } from "../constants";
import {
  buildObservationCoverage,
  indexObservationCoverage,
  requireCoverageItem,
  type ObservationCoverageIndex,
  type ObservationCoverageItem,
} from "../observationCoverage";
import type { ObservationFactsMap } from "../observationFacts";
import type { ObservationRecord } from "../observationLedger";
import { managerObservationId, observationItem, type ObservationItemId } from "../observationItems";
import type { ManagerId } from "../types";

export const NOW = new Date("2026-10-24T12:00:00Z").getTime();
export const OBSERVED_AT = NOW - 2 * 60 * 60 * 1000;

export function observationCoverageItem(
  id: ObservationItemId,
  overrides: Partial<ObservationCoverageItem> = {},
): ObservationCoverageItem {
  const item = observationItem(id);
  return {
    id,
    group: item.group,
    label: item.label,
    status: "observed",
    completeness: "complete",
    note: null,
    lastSuccessAt: OBSERVED_AT,
    lastSuccessScopeLabel: null,
    lastAttemptAt: null,
    lastAttemptOutcome: "succeeded",
    lastAttemptReason: null,
    invalidatedAt: null,
    invalidatedReason: null,
    currentScopeLabel: null,
    scopeChanged: false,
    attention: false,
    actions: { view: true, refresh: true, adjustScope: false },
    ...overrides,
  };
}

export function managerCoverageIndex(
  overrides: Partial<Record<ManagerId, Partial<ObservationCoverageItem>>> = {},
): ObservationCoverageIndex {
  return new Map(
    managerOrder.map((manager) => [
      managerObservationId(manager),
      observationCoverageItem(managerObservationId(manager), overrides[manager]),
    ]),
  );
}

export function coverageIndexFromFacts(
  facts: ObservationFactsMap,
  records: Partial<Record<ObservationItemId, ObservationRecord>> = {},
  enabledManagers: ManagerId[] = [],
): ObservationCoverageIndex {
  return indexObservationCoverage(buildObservationCoverage({ facts, records, scopes: {}, enabledManagers }));
}

export function coverageItemFromFacts(
  id: ObservationItemId,
  facts: ObservationFactsMap,
  records: Partial<Record<ObservationItemId, ObservationRecord>> = {},
  enabledManagers: ManagerId[] = [],
): ObservationCoverageItem {
  return requireCoverageItem(coverageIndexFromFacts(facts, records, enabledManagers), id);
}
