import { useEffect, useSyncExternalStore } from "react";
import {
  createProjectCleanupWorkflow,
} from "../projectCleanupWorkflow";
import { createTauriProjectCleanupEffects } from "../projectCleanupTauriEffects";

const workflow = createProjectCleanupWorkflow(createTauriProjectCleanupEffects());
let initializationStarted = false;

export function useProjectCleanup() {
  const view = useSyncExternalStore(
    workflow.subscribe,
    workflow.read,
    workflow.read,
  );

  useEffect(() => {
    if (!initializationStarted) {
      initializationStarted = true;
      void workflow.initialize();
    }
  }, []);

  return { view, workflow };
}
