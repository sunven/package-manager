import { describe, expect, it } from "vitest";
import {
  createAppUpdateWorkflow,
  type AppUpdateEffects,
  type AppUpdateRelease,
} from "./appUpdateWorkflow";

function fakeRelease(
  version: string,
  download?: (onProgress: (percent: number | null) => void) => Promise<void>,
): AppUpdateRelease {
  return {
    version,
    notes: `发布说明 ${version}`,
    downloadAndInstall: async (onProgress) => {
      if (download) await download(onProgress);
    },
  };
}

function setup(overrides: Partial<AppUpdateEffects> = {}) {
  const state = {
    dismissed: null as string | null,
    checked: 0,
    relaunched: false,
    nextRelease: null as AppUpdateRelease | null,
  };
  const effects: AppUpdateEffects = {
    currentVersion: async () => "0.1.0",
    check: async () => {
      state.checked += 1;
      return state.nextRelease;
    },
    relaunch: async () => {
      state.relaunched = true;
    },
    readDismissedVersion: () => state.dismissed,
    writeDismissedVersion: (version) => {
      state.dismissed = version;
    },
    isDevMode: () => false,
    ...overrides,
  };

  return { effects, state, workflow: createAppUpdateWorkflow(effects) };
}

describe("app update workflow", () => {
  it("loads the current version and the dismissed version on initialize", async () => {
    const { state, workflow } = setup();
    state.dismissed = "0.0.9";

    await workflow.initialize();

    expect(workflow.read().currentVersion).toBe("0.1.0");
    expect(workflow.read().dismissedVersion).toBe("0.0.9");
    expect(workflow.read().phase).toBe("idle");
  });

  it("reports an up-to-date check", async () => {
    const { workflow } = setup();

    await workflow.checkForUpdate();

    expect(workflow.read().phase).toBe("upToDate");
    expect(workflow.read().availableVersion).toBeNull();
    expect(workflow.read().promptVersion).toBeNull();
  });

  it("offers a prompt for an available version", async () => {
    const { state, workflow } = setup();
    state.nextRelease = fakeRelease("0.1.2");

    await workflow.checkForUpdate();

    expect(workflow.read().phase).toBe("available");
    expect(workflow.read().availableVersion).toBe("0.1.2");
    expect(workflow.read().notes).toBe("发布说明 0.1.2");
    expect(workflow.read().promptVersion).toBe("0.1.2");
  });

  it("suppresses the prompt while keeping the update available after a skip", async () => {
    const { state, workflow } = setup();
    state.nextRelease = fakeRelease("0.1.2");
    await workflow.checkForUpdate();

    workflow.skipVersion();

    expect(state.dismissed).toBe("0.1.2");
    expect(workflow.read().phase).toBe("available");
    expect(workflow.read().promptVersion).toBeNull();

    await workflow.checkForUpdate();
    expect(workflow.read().promptVersion).toBeNull();

    state.nextRelease = fakeRelease("0.1.3");
    await workflow.checkForUpdate();
    expect(workflow.read().promptVersion).toBe("0.1.3");
  });

  it("hides the prompt for the rest of the session when dismissed", async () => {
    const { state, workflow } = setup();
    state.nextRelease = fakeRelease("0.1.2");
    await workflow.checkForUpdate();

    workflow.dismissPrompt();

    expect(workflow.read().promptVersion).toBeNull();
    expect(state.dismissed).toBeNull();
    expect(workflow.read().availableVersion).toBe("0.1.2");
  });

  it("maps check failures to user-facing messages", async () => {
    const { workflow } = setup({
      check: async () => {
        throw new Error("fetch failed");
      },
    });

    await workflow.checkForUpdate();

    expect(workflow.read().phase).toBe("failed");
    expect(workflow.read().error).toBe("网络连接失败，请检查网络设置。");
  });

  it("skips checking in development mode", async () => {
    const { state, workflow } = setup({ isDevMode: () => true });

    await workflow.checkForUpdate();

    expect(state.checked).toBe(0);
    expect(workflow.read().devMode).toBe(true);
    expect(workflow.read().phase).toBe("idle");
  });

  it("reports download progress and relaunches after installing", async () => {
    const { state, workflow } = setup();
    state.nextRelease = fakeRelease("0.1.2", async (onProgress) => {
      onProgress(null);
      onProgress(42);
      onProgress(100);
    });
    const progress: (number | null)[] = [];
    workflow.subscribe(() => {
      const view = workflow.read();
      if (view.phase === "downloading") progress.push(view.progress);
    });
    await workflow.checkForUpdate();

    await workflow.downloadAndInstall();

    expect(progress).toEqual([null, null, 42, 100]);
    expect(state.relaunched).toBe(true);
    expect(workflow.read().phase).toBe("installing");
  });

  it("keeps the available version and maps signature failures", async () => {
    const { state, workflow } = setup();
    state.nextRelease = fakeRelease("0.1.2", async () => {
      throw new Error("signature verification failed");
    });
    await workflow.checkForUpdate();

    await workflow.downloadAndInstall();

    expect(workflow.read().phase).toBe("failed");
    expect(workflow.read().error).toBe("更新包签名验证失败，请联系开发者。");
    expect(workflow.read().availableVersion).toBe("0.1.2");
  });
});
