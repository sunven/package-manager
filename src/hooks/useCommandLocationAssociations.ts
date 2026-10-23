import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCommandLocationDescriptors,
  buildCommandLocationScope,
  buildCommandLocationTargets,
  deriveCommandLocationAssociations,
  type CandidateLocationAssociation,
  type CommandLocationAssociationResult,
  type CommandLocationDescriptor,
  type CommandLocationInput,
  type CommandLocationScope,
} from "../commandLocationAssociation";
import type { EnvironmentInspection } from "../environmentInspection";
import type { ManagerScanState } from "../managerScanning";
import type { ObservationRecord } from "../observationLedger";
import type { ObservationItemId } from "../observationItems";
import type { ManagerId, ManagerSnapshot } from "../types";
import { errorToString } from "../utils/format";

const EMPTY_RESULT: CommandLocationAssociationResult = {
  matches: [],
  unreadableLocationIds: [],
};

interface Settled {
  requestKey: string;
  contentKey: string;
  result: CommandLocationAssociationResult;
  error: string | null;
}

export interface CommandLocationAssociations {
  byTarget: Map<string, CandidateLocationAssociation>;
  hasUsableLocations: boolean;
  descriptors: CommandLocationDescriptor[];
  scope: CommandLocationScope;
  unreadableLocationIds: string[];
  resultAvailable: boolean;
  busy: boolean;
  error: string | null;
}

export function useCommandLocationAssociations(
  environment: EnvironmentInspection | null,
  enabledManagers: ManagerId[],
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>,
  scanStates: Partial<Record<ManagerId, ManagerScanState>>,
  ledgerRecords: Partial<Record<ObservationItemId, ObservationRecord>>,
): CommandLocationAssociations {
  const [settled, setSettled] = useState<Settled>({
    requestKey: "",
    contentKey: "",
    result: EMPTY_RESULT,
    error: null,
  });
  const sequence = useRef(0);
  const managersKey = enabledManagers.join(",");

  const descriptors = useMemo(
    () => buildCommandLocationDescriptors(enabledManagers, managerSnapshots),
    // The key captures the content that matters; snapshot identity can change for path sizes.
    [managersKey, managerSnapshots],
  );
  const targets = useMemo(
    () => (environment ? buildCommandLocationTargets(environment) : []),
    [environment],
  );
  const targetKey = useMemo(
    () => targets.map((target) => `${target.id}\u0000${target.target}`).join("\u0001"),
    [targets],
  );
  const descriptorKey = useMemo(
    () => descriptors.map((descriptor) => `${descriptor.id}\u0000${descriptor.path}`).join("\u0001"),
    [descriptors],
  );
  const scanKey = enabledManagers
    .map((managerId) => `${managerId}:${scanStates[managerId]?.scannedAt ?? 0}`)
    .join(",");
  const contentKey = `${targetKey}\u0002${descriptorKey}`;
  const requestKey = `${contentKey}\u0002${environment?.capturedAt ?? 0}\u0002${scanKey}`;
  const requestReady = environment !== null && targets.length > 0 && descriptors.length > 0;
  const pending = requestReady && settled.requestKey !== requestKey;
  const contentCurrent = settled.contentKey === contentKey;
  const resultAvailable = !requestReady || contentCurrent;
  const currentResult = contentCurrent ? settled.result : EMPTY_RESULT;
  const currentError = contentCurrent ? settled.error : null;

  useEffect(() => {
    const current = ++sequence.current;
    if (!requestReady) {
      setSettled((previous) =>
        previous.requestKey === requestKey
          && previous.contentKey === contentKey
          && previous.result === EMPTY_RESULT
          && previous.error === null
          ? previous
          : { requestKey, contentKey, result: EMPTY_RESULT, error: null },
      );
      return;
    }
    const locations: CommandLocationInput[] = descriptors.map(({ id, managerId, path }) => ({
      id,
      managerId,
      path,
    }));
    void invoke<CommandLocationAssociationResult>("associate_command_locations", {
      request: { targets, locations },
    })
      .then((next) => {
        if (current !== sequence.current) return;
        setSettled({ requestKey, contentKey, result: next, error: null });
      })
      .catch((cause) => {
        if (current !== sequence.current) return;
        setSettled({
          requestKey,
          contentKey,
          result: EMPTY_RESULT,
          error: errorToString(cause),
        });
      });
  }, [contentKey, requestKey, requestReady]);

  useEffect(() => () => { sequence.current += 1; }, []);

  const derived = useMemo(
    () => deriveCommandLocationAssociations(
      targets.map((target) => target.id),
      descriptors,
      currentResult,
    ),
    [targets, descriptors, currentResult],
  );
  const scope = useMemo(
    () => buildCommandLocationScope(
      enabledManagers,
      managerSnapshots,
      scanStates,
      ledgerRecords,
      descriptors,
      currentResult.unreadableLocationIds,
    ),
    [
      enabledManagers,
      managerSnapshots,
      scanStates,
      ledgerRecords,
      descriptors,
      currentResult,
    ],
  );

  return {
    byTarget: derived.byTarget,
    hasUsableLocations: derived.hasUsableLocations,
    descriptors,
    scope,
    unreadableLocationIds: currentResult.unreadableLocationIds,
    resultAvailable,
    busy: pending,
    error: currentError,
  };
}
