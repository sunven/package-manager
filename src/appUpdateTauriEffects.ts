import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { createAppUpdateProgressTracker } from "./appUpdateProgress";
import { readDismissedAppUpdateVersion, writeDismissedAppUpdateVersion } from "./appUpdateSettings";
import type { AppUpdateEffects } from "./appUpdateWorkflow";

export function createAppUpdateTauriEffects(): AppUpdateEffects {
  return {
    currentVersion: getVersion,
    check: async () => {
      const update = await check();
      if (!update) return null;

      return {
        version: update.version,
        notes: update.body ?? null,
        downloadAndInstall: async (onProgress) => {
          const tracker = createAppUpdateProgressTracker();
          await update.downloadAndInstall((event) => {
            if (event.event === "Started") {
              onProgress(tracker.started(event.data.contentLength));
            } else if (event.event === "Progress") {
              onProgress(tracker.progress(event.data.chunkLength));
            } else if (event.event === "Finished") {
              onProgress(tracker.finished());
            }
          });
        },
      };
    },
    relaunch,
    readDismissedVersion: readDismissedAppUpdateVersion,
    writeDismissedVersion: writeDismissedAppUpdateVersion,
    isDevMode: () => import.meta.env.DEV,
  };
}
