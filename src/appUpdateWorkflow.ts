import { appUpdateErrorMessage } from "./appUpdateErrors";

export interface AppUpdateRelease {
  version: string;
  notes: string | null;
  downloadAndInstall(onProgress: (percent: number | null) => void): Promise<void>;
}

export interface AppUpdateEffects {
  currentVersion(): Promise<string>;
  check(): Promise<AppUpdateRelease | null>;
  relaunch(): Promise<void>;
  readDismissedVersion(): string | null;
  writeDismissedVersion(version: string | null): void;
  isDevMode(): boolean;
}

export type AppUpdatePhase = "idle" | "checking" | "upToDate" | "available" | "downloading" | "installing" | "failed";

export interface AppUpdateView {
  phase: AppUpdatePhase;
  devMode: boolean;
  currentVersion: string | null;
  availableVersion: string | null;
  notes: string | null;
  progress: number | null;
  error: string | null;
  dismissedVersion: string | null;
  promptVersion: string | null;
}

export interface AppUpdateWorkflow {
  read(): AppUpdateView;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  checkForUpdate(): Promise<void>;
  downloadAndInstall(): Promise<void>;
  skipVersion(): void;
  dismissPrompt(): void;
}

export function createAppUpdateWorkflow(effects: AppUpdateEffects): AppUpdateWorkflow {
  const listeners = new Set<() => void>();
  let release: AppUpdateRelease | null = null;
  let promptedVersion: string | null = null;
  let initialized = false;
  let view: AppUpdateView = {
    phase: "idle",
    devMode: effects.isDevMode(),
    currentVersion: null,
    availableVersion: null,
    notes: null,
    progress: null,
    error: null,
    dismissedVersion: effects.readDismissedVersion(),
    promptVersion: null,
  };

  function publish(patch: Partial<AppUpdateView>) {
    view = { ...view, ...patch };
    view.promptVersion =
      view.phase === "available" &&
      view.availableVersion !== null &&
      view.availableVersion !== view.dismissedVersion &&
      view.availableVersion !== promptedVersion
        ? view.availableVersion
        : null;
    listeners.forEach((listener) => listener());
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    publish({ devMode: effects.isDevMode(), dismissedVersion: effects.readDismissedVersion() });

    try {
      publish({ currentVersion: await effects.currentVersion() });
    } catch {
      // The update check reports its own failure; a missing version only hides the label.
    }
  }

  async function checkForUpdate() {
    if (["checking", "downloading", "installing"].includes(view.phase)) return;
    if (effects.isDevMode()) {
      publish({ devMode: true });
      return;
    }

    publish({ phase: "checking", error: null, progress: null });
    try {
      const found = await effects.check();
      if (!found) {
        release = null;
        publish({ phase: "upToDate", availableVersion: null, notes: null, error: null });
        return;
      }
      release = found;
      publish({ phase: "available", availableVersion: found.version, notes: found.notes, error: null });
    } catch (error) {
      release = null;
      publish({ phase: "failed", availableVersion: null, notes: null, error: appUpdateErrorMessage(error, "check") });
    }
  }

  async function downloadAndInstall() {
    const current = release;
    if (!current || ["downloading", "installing"].includes(view.phase)) return;

    publish({ phase: "downloading", progress: null, error: null });
    try {
      await current.downloadAndInstall((percent) => publish({ progress: percent }));
      publish({ phase: "installing", progress: 100 });
      try {
        await effects.relaunch();
      } catch {
        publish({ phase: "failed", error: "更新已安装，但自动重启失败，请手动重新打开应用。" });
      }
    } catch (error) {
      publish({ phase: "failed", error: appUpdateErrorMessage(error, "download") });
    }
  }

  function skipVersion() {
    if (!view.availableVersion) return;
    effects.writeDismissedVersion(view.availableVersion);
    publish({ dismissedVersion: view.availableVersion });
  }

  function dismissPrompt() {
    if (!view.availableVersion) return;
    promptedVersion = view.availableVersion;
    publish({});
  }

  return {
    read: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize,
    checkForUpdate,
    downloadAndInstall,
    skipVersion,
    dismissPrompt,
  };
}
