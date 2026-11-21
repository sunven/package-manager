import type { ProjectCleanupEffects } from "./projectCleanupWorkflow";

export function createInMemoryProjectCleanupEffects(
  overrides: Partial<ProjectCleanupEffects> = {},
): ProjectCleanupEffects {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected Project Cleanup effect");
  };

  return {
    readSettings: unexpected,
    chooseRoot: unexpected,
    selectPreset: unexpected,
    removePreset: unexpected,
    updateDepth: unexpected,
    runScan: unexpected,
    requestScanStop: async () => undefined,
    runBatch: unexpected,
    requestStop: async () => undefined,
    openRoot: unexpected,
    openCandidate: unexpected,
    readScanHistory: async () => ({ histories: {}, warning: null }),
    ...overrides,
  };
}
