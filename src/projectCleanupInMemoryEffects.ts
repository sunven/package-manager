import type { ProjectCleanupEffects } from "./projectCleanupWorkflow";
import type {
  ProjectScanCandidateCounts,
  ProjectScanRecord,
  ProjectScanRecordDraft,
} from "./types";

function recordFromDraft(draft: ProjectScanRecordDraft, sequence: number): ProjectScanRecord {
  const seen = new Set<string>();
  const candidates: ProjectScanCandidateCounts = {
    total: 0,
    rustTarget: 0,
    mavenTarget: 0,
    nodeModules: 0,
  };
  for (const candidate of draft.candidates) {
    const key = `${candidate.kind}\n${candidate.directoryPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.total += 1;
    if (candidate.kind === "RustTarget") candidates.rustTarget += 1;
    if (candidate.kind === "MavenTarget") candidates.mavenTarget += 1;
    if (candidate.kind === "NodeModules") candidates.nodeModules += 1;
  }
  return {
    id: `scan-record-${sequence}`,
    presetId: draft.presetId,
    scanId: draft.scanId,
    rootPath: draft.rootPath,
    maxDepth: draft.maxDepth,
    finishedAt: draft.finishedAt,
    discovery: { complete: draft.skipped === 0, skipped: draft.skipped },
    measurement: draft.measurement,
    projects: draft.projects,
    candidates,
    baseline: null,
    changes: null,
  };
}

export function createInMemoryProjectCleanupEffects(
  overrides: Partial<ProjectCleanupEffects> = {},
): ProjectCleanupEffects {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected Project Cleanup effect");
  };
  let recordSequence = 0;

  return {
    readSettings: unexpected,
    chooseRoot: unexpected,
    selectPreset: unexpected,
    removePreset: unexpected,
    updateDepth: unexpected,
    scan: unexpected,
    measure: unexpected,
    runBatch: unexpected,
    requestStop: async () => undefined,
    openRoot: unexpected,
    openCandidate: unexpected,
    readScanHistory: async () => ({ histories: {}, warning: null }),
    recordScanHistory: async (draft) => {
      recordSequence += 1;
      return recordFromDraft(draft, recordSequence);
    },
    ...overrides,
  };
}
