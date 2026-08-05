import type {
  DirectoryMeasurement,
  ProjectCleanupResult,
  ProjectCleanupSettings,
  ProjectDataCandidate,
  ProjectDataScan,
} from "./types";

export interface ProjectCleanupEffects {
  readSettings(): Promise<ProjectCleanupSettings>;
  chooseRoot(): Promise<ProjectCleanupSettings | null>;
  scan(input: { rootId: string; maxDepth: number }): Promise<ProjectDataScan>;
  measure(input: { scanId: string; candidateId: string }): Promise<DirectoryMeasurement>;
  clean(input: { scanId: string; candidateId: string }): Promise<ProjectCleanupResult>;
  openRoot(rootId: string): Promise<void>;
  openCandidate(input: {
    scanId: string;
    candidateId: string;
    target: "Project" | "Directory";
  }): Promise<void>;
}

export interface WorkflowFailure {
  operation: "settings" | "root" | "scan" | "measure" | "clean" | "open";
  message: string;
  candidateId?: string;
}

export type WorkflowOutcome<T> =
  | { kind: "succeeded"; value: T }
  | { kind: "cancelled" }
  | { kind: "unavailable"; reason: string }
  | { kind: "invalid"; message: string }
  | { kind: "failed"; failure: WorkflowFailure };

export interface ProjectCleanupSettingsView {
  phase: "loading" | "ready" | "failed";
  rootId: string | null;
  rootPath: string | null;
  maxDepth: number;
  failure: WorkflowFailure | null;
}

export type CandidateCleanability =
  | { kind: "measuring" }
  | { kind: "cleanable" }
  | {
      kind: "blocked";
      reason:
        | "identity-not-verified"
        | "directory-footprint-incomplete"
        | "cleanup-mechanism-unavailable";
    }
  | { kind: "requires-rescan" };

export interface ProjectCleanupCandidateView extends ProjectDataCandidate {
  cleanability: CandidateCleanability;
  selected: boolean;
  cleanup: CandidateCleanupState;
}

export type CandidateCleanupOutcome =
  | { kind: "result"; result: ProjectCleanupResult }
  | { kind: "effect-failed"; failure: WorkflowFailure };

export type CandidateCleanupState =
  | { kind: "not-attempted" }
  | { kind: "attempting" }
  | { kind: "attempted"; outcome: CandidateCleanupOutcome };

export type ProjectCleanupScanSessionView = Omit<ProjectDataScan, "candidates"> & {
  candidates: ProjectCleanupCandidateView[];
};

export interface ProjectCleanupScanView {
  phase: "idle" | "discovering" | "measuring" | "ready" | "stopped" | "failed";
  session: ProjectCleanupScanSessionView | null;
  pendingMeasurements: number;
  failure: WorkflowFailure | null;
}

export interface ProjectCleanupTotalsView {
  verifiedBytes: number;
  reviewBytes: number;
  reviewCount: number;
  selectedCount: number;
  selectedBytes: number;
  cleanedBytes: number;
}

export type CleanupBatchItemState =
  | { kind: "not-started" }
  | { kind: "running" }
  | { kind: "stopped" }
  | { kind: "finished"; outcome: CandidateCleanupOutcome };

export interface CleanupBatchCandidateView {
  candidateId: string;
  kind: ProjectDataCandidate["kind"];
  projectPath: string;
  directoryPath: string;
  beforeBytes: number;
  state: CleanupBatchItemState;
}

export interface CleanupBatchView {
  phase: "confirmation" | "running" | "result";
  batchId: string;
  scanId: string;
  selectedBytes: number;
  candidates: CleanupBatchCandidateView[];
  completedCount: number;
  stopRequested: boolean;
  finish: "completed" | "stopped" | null;
  cleanedBytes: number;
}

export interface CleanupBatchSummary {
  finish: "completed" | "stopped";
  totalCount: number;
  completedCount: number;
  failedCount: number;
  cleanedBytes: number;
}

export interface ProjectCleanupView {
  settings: ProjectCleanupSettingsView;
  scan: ProjectCleanupScanView;
  totals: ProjectCleanupTotalsView;
  batch: CleanupBatchView | null;
}

export interface ProjectCleanupWorkflow {
  read(): ProjectCleanupView;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<WorkflowOutcome<void>>;
  setMaxDepth(value: number): WorkflowOutcome<{ maxDepth: number }>;
  chooseRoot(): Promise<WorkflowOutcome<{ rootId: string }>>;
  startScan(): Promise<
    WorkflowOutcome<{ scanId: string; finish: "completed" }>
  >;
  requestScanStop(): WorkflowOutcome<void>;
  setSelected(
    candidateIds: readonly string[],
    selected: boolean,
  ): WorkflowOutcome<{ changed: number; notCleanable: readonly string[] }>;
  clearSelection(): WorkflowOutcome<void>;
  prepareCleanupBatch(
    orderedSelectedCandidateIds: readonly string[],
  ): WorkflowOutcome<{ batchId: string }>;
  runCleanupBatch(): Promise<WorkflowOutcome<CleanupBatchSummary>>;
  requestCleanupStop(): WorkflowOutcome<void>;
  closeCleanupBatch(): WorkflowOutcome<void>;
  openRoot(): Promise<WorkflowOutcome<void>>;
  openCandidate(
    candidateId: string,
    target: "Project" | "Directory",
  ): Promise<WorkflowOutcome<void>>;
  dispose(): void;
}

export function createProjectCleanupWorkflow(
  effects: ProjectCleanupEffects,
): ProjectCleanupWorkflow {
  const listeners = new Set<() => void>();
  let disposed = false;
  let scanGeneration = 0;
  let batchSequence = 0;
  let view: ProjectCleanupView = {
    settings: {
      phase: "loading",
      rootId: null,
      rootPath: null,
      maxDepth: 8,
      failure: null,
    },
    scan: {
      phase: "idle",
      session: null,
      pendingMeasurements: 0,
      failure: null,
    },
    totals: emptyTotals(),
    batch: null,
  };

  const publish = (next: ProjectCleanupView) => {
    if (disposed) return;
    view = {
      ...next,
      totals: calculateTotals(next.scan.session),
    };
    listeners.forEach((listener) => listener());
  };

  return {
    read: () => view,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    initialize: async () => {
      if (disposed) return { kind: "unavailable", reason: "disposed" };
      try {
        const settings = await effects.readSettings();
        publish({
          ...view,
          settings: {
            phase: "ready",
            rootId: settings.rootId,
            rootPath: settings.rootPath,
            maxDepth: settings.maxDepth,
            failure: null,
          },
        });
        return { kind: "succeeded", value: undefined };
      } catch (error) {
        const failure: WorkflowFailure = {
          operation: "settings",
          message: errorText(error),
        };
        publish({
          ...view,
          settings: {
            ...view.settings,
            phase: "failed",
            failure,
          },
        });
        return { kind: "failed", failure };
      }
    },
    setMaxDepth: (value) => {
      if (view.batch) return { kind: "unavailable", reason: "batch-lock" };
      if (view.scan.phase === "discovering" || view.scan.phase === "measuring") {
        return { kind: "unavailable", reason: "scan-active" };
      }
      if (!Number.isFinite(value)) {
        return { kind: "invalid", message: "scan depth must be a finite number" };
      }
      const maxDepth = Math.max(0, Math.min(32, Math.trunc(value)));
      if (maxDepth !== view.settings.maxDepth) {
        publish({
          ...view,
          settings: { ...view.settings, maxDepth },
        });
      }
      return { kind: "succeeded", value: { maxDepth } };
    },
    chooseRoot: async () => {
      if (disposed) return { kind: "unavailable", reason: "disposed" };
      if (view.batch) return { kind: "unavailable", reason: "batch-lock" };
      if (view.scan.phase === "discovering" || view.scan.phase === "measuring") {
        return { kind: "unavailable", reason: "scan-active" };
      }
      try {
        const settings = await effects.chooseRoot();
        if (!settings) return { kind: "cancelled" };
        scanGeneration += 1;
        publish({
          ...view,
          settings: {
            phase: "ready",
            rootId: settings.rootId,
            rootPath: settings.rootPath,
            maxDepth: settings.maxDepth,
            failure: null,
          },
          scan: {
            phase: "idle",
            session: null,
            pendingMeasurements: 0,
            failure: null,
          },
        });
        return {
          kind: "succeeded",
          value: { rootId: settings.rootId! },
        };
      } catch (error) {
        const failure: WorkflowFailure = {
          operation: "root",
          message: errorText(error),
        };
        return { kind: "failed", failure };
      }
    },
    startScan: async () => {
      if (disposed) return { kind: "unavailable", reason: "disposed" };
      if (view.batch) return { kind: "unavailable", reason: "batch-lock" };
      const rootId = view.settings.rootId;
      if (!rootId) return { kind: "unavailable", reason: "no-root" };
      if (view.scan.phase === "discovering" || view.scan.phase === "measuring") {
        return { kind: "unavailable", reason: "scan-active" };
      }
      const generation = scanGeneration + 1;
      scanGeneration = generation;

      publish({
        ...view,
        scan: {
          phase: "discovering",
          session: null,
          pendingMeasurements: 0,
          failure: null,
        },
      });

      try {
        const discovered = await effects.scan({
          rootId,
          maxDepth: view.settings.maxDepth,
        });
        if (generation !== scanGeneration) return { kind: "cancelled" };
        const session: ProjectCleanupScanSessionView = {
          ...discovered,
          candidates: discovered.candidates.map((candidate) =>
            candidateView(candidate, discovered.cargoAvailable),
          ),
        };
        const candidates = session.candidates.filter(
          (candidate) => candidate.status === "Ready" || candidate.status === "Unrecognized",
        );
        publish({
          ...view,
          scan: {
            phase: candidates.length ? "measuring" : "ready",
            session,
            pendingMeasurements: candidates.length,
            failure: null,
          },
        });

        let cursor = 0;
        const measureNext = async () => {
          while (generation === scanGeneration && cursor < candidates.length) {
            const candidate = candidates[cursor];
            cursor += 1;
            let measurement: DirectoryMeasurement;
            try {
              measurement = await effects.measure({
                scanId: session.scanId,
                candidateId: candidate.candidateId,
              });
            } catch (error) {
              measurement = failedMeasurement(error);
            }
            if (generation !== scanGeneration) return;
            const currentSession = view.scan.session;
            if (!currentSession || currentSession.scanId !== session.scanId) return;
            publish({
              ...view,
              scan: {
                ...view.scan,
                session: {
                  ...currentSession,
                  candidates: currentSession.candidates.map((current) =>
                    current.candidateId === candidate.candidateId
                      ? candidateView(
                          { ...current, measurement },
                          currentSession.cargoAvailable,
                          current.selected,
                        )
                      : current,
                  ),
                },
                pendingMeasurements: Math.max(0, view.scan.pendingMeasurements - 1),
              },
            });
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(4, candidates.length) }, () => measureNext()),
        );
        if (generation !== scanGeneration) return { kind: "cancelled" };
        publish({
          ...view,
          scan: {
            ...view.scan,
            phase: "ready",
          },
        });
        return {
          kind: "succeeded",
          value: { scanId: session.scanId, finish: "completed" },
        };
      } catch (error) {
        if (generation !== scanGeneration) return { kind: "cancelled" };
        const failure: WorkflowFailure = {
          operation: "scan",
          message: errorText(error),
        };
        publish({
          ...view,
          scan: {
            ...view.scan,
            phase: "failed",
            pendingMeasurements: 0,
            failure,
          },
        });
        return { kind: "failed", failure };
      }
    },
    requestScanStop: () => {
      if (view.batch) return { kind: "unavailable", reason: "batch-lock" };
      if (view.scan.phase !== "discovering" && view.scan.phase !== "measuring") {
        return { kind: "unavailable", reason: "scan-inactive" };
      }
      scanGeneration += 1;
      publish({
        ...view,
        scan: {
          ...view.scan,
          phase: "stopped",
          pendingMeasurements: 0,
        },
      });
      return { kind: "succeeded", value: undefined };
    },
    setSelected: (candidateIds, selected) => {
      if (view.batch) return { kind: "unavailable", reason: "batch-lock" };
      const session = view.scan.session;
      if (!session) return { kind: "unavailable", reason: "no-scan-session" };
      const requested = new Set(candidateIds);
      const notCleanable = candidateIds.filter((candidateId) => {
        const candidate = session.candidates.find(
          (current) => current.candidateId === candidateId,
        );
        return !candidate || (selected && candidate.cleanability.kind !== "cleanable");
      });
      const accepted = new Set(
        candidateIds.filter((candidateId) => !notCleanable.includes(candidateId)),
      );
      let changed = 0;
      const candidates = session.candidates.map((candidate) => {
        if (!requested.has(candidate.candidateId) || !accepted.has(candidate.candidateId)) {
          return candidate;
        }
        if (candidate.selected === selected) return candidate;
        changed += 1;
        return { ...candidate, selected };
      });
      if (changed > 0) {
        publish({
          ...view,
          scan: {
            ...view.scan,
            session: { ...session, candidates },
          },
        });
      }
      return {
        kind: "succeeded",
        value: { changed, notCleanable },
      };
    },
    clearSelection: () => {
      if (view.batch) return { kind: "unavailable", reason: "batch-lock" };
      const session = view.scan.session;
      if (!session) return { kind: "unavailable", reason: "no-scan-session" };
      if (session.candidates.some((candidate) => candidate.selected)) {
        publish({
          ...view,
          scan: {
            ...view.scan,
            session: {
              ...session,
              candidates: session.candidates.map((candidate) =>
                candidate.selected ? { ...candidate, selected: false } : candidate,
              ),
            },
          },
        });
      }
      return { kind: "succeeded", value: undefined };
    },
    prepareCleanupBatch: (orderedSelectedCandidateIds) => {
      if (view.batch) return { kind: "unavailable", reason: "batch-lock" };
      const session = view.scan.session;
      if (!session) return { kind: "unavailable", reason: "no-scan-session" };
      const selected = session.candidates.filter((candidate) => candidate.selected);
      if (!selected.length) return { kind: "unavailable", reason: "no-selection" };
      const selectedIds = new Set(selected.map((candidate) => candidate.candidateId));
      const orderedIds = new Set(orderedSelectedCandidateIds);
      if (
        orderedSelectedCandidateIds.length !== selected.length ||
        orderedIds.size !== orderedSelectedCandidateIds.length ||
        orderedSelectedCandidateIds.some((candidateId) => !selectedIds.has(candidateId))
      ) {
        return {
          kind: "invalid",
          message: "cleanup batch order must contain every selected candidate exactly once",
        };
      }
      const candidatesById = new Map(
        selected.map((candidate) => [candidate.candidateId, candidate]),
      );
      const candidates = orderedSelectedCandidateIds.map((candidateId) => {
        const candidate = candidatesById.get(candidateId)!;
        return {
          candidateId,
          kind: candidate.kind,
          projectPath: candidate.projectPath,
          directoryPath: candidate.directoryPath,
          beforeBytes: candidate.measurement.bytes ?? 0,
          state: { kind: "not-started" } as const,
        };
      });
      const batchId = `batch-${batchSequence + 1}`;
      batchSequence += 1;
      publish({
        ...view,
        batch: {
          phase: "confirmation",
          batchId,
          scanId: session.scanId,
          selectedBytes: candidates.reduce(
            (total, candidate) => total + candidate.beforeBytes,
            0,
          ),
          candidates,
          completedCount: 0,
          stopRequested: false,
          finish: null,
          cleanedBytes: 0,
        },
      });
      return { kind: "succeeded", value: { batchId } };
    },
    runCleanupBatch: async () => {
      if (!view.batch || view.batch.phase !== "confirmation") {
        return { kind: "unavailable", reason: "batch-not-ready" };
      }
      publish({
        ...view,
        batch: {
          ...view.batch,
          phase: "running",
        },
      });

      for (let index = 0; index < view.batch.candidates.length; index += 1) {
        const batch = view.batch;
        const session = view.scan.session;
        if (!batch || !session) break;
        if (batch.stopRequested) break;
        const item = batch.candidates[index];
        publish({
          ...view,
          scan: {
            ...view.scan,
            session: {
              ...session,
              candidates: session.candidates.map((candidate) =>
                candidate.candidateId === item.candidateId
                  ? {
                      ...candidate,
                      selected: false,
                      cleanability: { kind: "requires-rescan" },
                      cleanup: { kind: "attempting" },
                    }
                  : candidate,
              ),
            },
          },
          batch: {
            ...batch,
            candidates: batch.candidates.map((candidate, candidateIndex) =>
              candidateIndex === index
                ? { ...candidate, state: { kind: "running" } }
                : candidate,
            ),
          },
        });

        let outcome: CandidateCleanupOutcome;
        try {
          const result = await effects.clean({
            scanId: batch.scanId,
            candidateId: item.candidateId,
          });
          outcome = { kind: "result", result };
        } catch (error) {
          outcome = {
            kind: "effect-failed",
            failure: {
              operation: "clean",
              message: errorText(error),
              candidateId: item.candidateId,
            },
          };
        }

        const currentBatch = view.batch;
        const currentSession = view.scan.session;
        if (!currentBatch || !currentSession) break;
        publish({
          ...view,
          scan: {
            ...view.scan,
            session: {
              ...currentSession,
              candidates: currentSession.candidates.map((candidate) => {
                if (candidate.candidateId !== item.candidateId) return candidate;
                return {
                  ...candidate,
                  measurement:
                    outcome.kind === "result"
                      ? outcome.result.measurement
                      : candidate.measurement,
                  selected: false,
                  cleanability: { kind: "requires-rescan" },
                  cleanup: { kind: "attempted", outcome },
                };
              }),
            },
          },
          batch: {
            ...currentBatch,
            candidates: currentBatch.candidates.map((candidate, candidateIndex) =>
              candidateIndex === index
                ? { ...candidate, state: { kind: "finished", outcome } }
                : candidate,
            ),
            completedCount: currentBatch.completedCount + 1,
            cleanedBytes:
              currentBatch.cleanedBytes +
              (outcome.kind === "result" ? outcome.result.cleanedBytes : 0),
          },
        });
      }

      const batch = view.batch!;
      const finish = batch.stopRequested ? "stopped" : "completed";
      const candidates = batch.candidates.map((candidate) =>
        finish === "stopped" && candidate.state.kind === "not-started"
          ? { ...candidate, state: { kind: "stopped" } as const }
          : candidate,
      );
      const summary: CleanupBatchSummary = {
        finish,
        totalCount: candidates.length,
        completedCount: batch.completedCount,
        failedCount: candidates.filter(
          (candidate) =>
            candidate.state.kind === "finished" &&
            cleanupOutcomeFailed(candidate.state.outcome),
        ).length,
        cleanedBytes: batch.cleanedBytes,
      };
      publish({
        ...view,
        batch: {
          ...batch,
          phase: "result",
          finish,
          candidates,
        },
      });
      return { kind: "succeeded", value: summary };
    },
    requestCleanupStop: () => {
      if (!view.batch || view.batch.phase !== "running") {
        return { kind: "unavailable", reason: "cleanup-inactive" };
      }
      if (!view.batch.stopRequested) {
        publish({
          ...view,
          batch: {
            ...view.batch,
            stopRequested: true,
          },
        });
      }
      return { kind: "succeeded", value: undefined };
    },
    closeCleanupBatch: () => {
      if (!view.batch) return { kind: "unavailable", reason: "no-cleanup-batch" };
      if (view.batch.phase === "running") {
        return { kind: "unavailable", reason: "cleanup-active" };
      }
      publish({ ...view, batch: null });
      return { kind: "succeeded", value: undefined };
    },
    openRoot: async () => {
      if (disposed) return { kind: "unavailable", reason: "disposed" };
      const rootId = view.settings.rootId;
      if (!rootId) return { kind: "unavailable", reason: "no-root" };
      try {
        await effects.openRoot(rootId);
        return { kind: "succeeded", value: undefined };
      } catch (error) {
        const failure: WorkflowFailure = {
          operation: "open",
          message: errorText(error),
        };
        return { kind: "failed", failure };
      }
    },
    openCandidate: async (candidateId, target) => {
      if (disposed) return { kind: "unavailable", reason: "disposed" };
      const session = view.scan.session;
      if (!session) return { kind: "unavailable", reason: "no-scan-session" };
      if (!session.candidates.some((candidate) => candidate.candidateId === candidateId)) {
        return { kind: "invalid", message: "candidate is not in the current Scan Session" };
      }
      try {
        await effects.openCandidate({ scanId: session.scanId, candidateId, target });
        return { kind: "succeeded", value: undefined };
      } catch (error) {
        const failure: WorkflowFailure = {
          operation: "open",
          message: errorText(error),
          candidateId,
        };
        return { kind: "failed", failure };
      }
    },
    dispose: () => {
      disposed = true;
      scanGeneration += 1;
      listeners.clear();
    },
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function candidateView(
  candidate: ProjectDataCandidate,
  cargoAvailable: boolean,
  selected = false,
): ProjectCleanupCandidateView {
  const cleanup: CandidateCleanupState =
    "cleanup" in candidate
      ? (candidate as ProjectCleanupCandidateView).cleanup
      : { kind: "not-attempted" };
  let cleanability: CandidateCleanability;
  if (cleanup.kind !== "not-attempted") {
    cleanability = { kind: "requires-rescan" };
  } else if (candidate.status !== "Ready") {
    cleanability = { kind: "blocked", reason: "identity-not-verified" };
  } else if (candidate.measurement.status === "Pending") {
    cleanability = { kind: "measuring" };
  } else if (
    candidate.measurement.status !== "Ready" ||
    candidate.measurement.skipped !== 0
  ) {
    cleanability = {
      kind: "blocked",
      reason: "directory-footprint-incomplete",
    };
  } else if (candidate.kind === "RustTarget" && !cargoAvailable) {
    cleanability = {
      kind: "blocked",
      reason: "cleanup-mechanism-unavailable",
    };
  } else {
    cleanability = { kind: "cleanable" };
  }

  return {
    ...candidate,
    cleanability,
    selected: selected && cleanability.kind === "cleanable",
    cleanup,
  };
}

function failedMeasurement(error: unknown): DirectoryMeasurement {
  return {
    status: "Error",
    bytes: null,
    human: null,
    files: 0,
    directories: 0,
    skipped: 0,
    latestModifiedMs: null,
    message: errorText(error),
  };
}

function emptyTotals(): ProjectCleanupTotalsView {
  return {
    verifiedBytes: 0,
    reviewBytes: 0,
    reviewCount: 0,
    selectedCount: 0,
    selectedBytes: 0,
    cleanedBytes: 0,
  };
}

function calculateTotals(
  session: ProjectCleanupScanSessionView | null,
): ProjectCleanupTotalsView {
  if (!session) return emptyTotals();
  const totals = emptyTotals();
  for (const candidate of session.candidates) {
    const bytes = candidate.measurement.bytes ?? 0;
    if (candidate.cleanup.kind === "attempted" && candidate.cleanup.outcome.kind === "result") {
      totals.cleanedBytes += candidate.cleanup.outcome.result.cleanedBytes;
      if (
        candidate.cleanup.outcome.result.status === "Succeeded" ||
        candidate.cleanup.outcome.result.status === "Skipped"
      ) {
        continue;
      }
    }
    if (
      candidate.status === "Ready" &&
      candidate.measurement.status === "Ready"
    ) {
      totals.verifiedBytes += bytes;
    } else if (
      candidate.status !== "Ready" ||
      candidate.measurement.status !== "Pending"
    ) {
      totals.reviewBytes += bytes;
      totals.reviewCount += 1;
    }
    if (candidate.selected) {
      totals.selectedCount += 1;
      totals.selectedBytes += bytes;
    }
  }
  return totals;
}

function cleanupOutcomeFailed(outcome: CandidateCleanupOutcome) {
  return (
    outcome.kind === "effect-failed" ||
    (outcome.result.status !== "Succeeded" && outcome.result.status !== "Skipped")
  );
}
