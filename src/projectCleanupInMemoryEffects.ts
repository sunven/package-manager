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
    scan: unexpected,
    measure: unexpected,
    clean: unexpected,
    openRoot: unexpected,
    openCandidate: unexpected,
    ...overrides,
  };
}
