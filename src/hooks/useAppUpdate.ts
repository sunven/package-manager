import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createAppUpdateTauriEffects } from "../appUpdateTauriEffects";
import { createAppUpdateWorkflow } from "../appUpdateWorkflow";

const checkDelayMs = 1000;

export function useAppUpdate() {
  const [workflow] = useState(() => createAppUpdateWorkflow(createAppUpdateTauriEffects()));
  const view = useSyncExternalStore(workflow.subscribe, workflow.read);

  useEffect(() => {
    void workflow.initialize();
    const timer = setTimeout(() => void workflow.checkForUpdate(), checkDelayMs);
    return () => clearTimeout(timer);
  }, [workflow]);

  const checkForUpdate = useCallback(() => void workflow.checkForUpdate(), [workflow]);
  const downloadAndInstall = useCallback(() => void workflow.downloadAndInstall(), [workflow]);
  const skipVersion = useCallback(() => workflow.skipVersion(), [workflow]);
  const dismissPrompt = useCallback(() => workflow.dismissPrompt(), [workflow]);

  return useMemo(
    () => ({ view, checkForUpdate, downloadAndInstall, skipVersion, dismissPrompt }),
    [view, checkForUpdate, downloadAndInstall, skipVersion, dismissPrompt],
  );
}
