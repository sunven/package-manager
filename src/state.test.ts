import { describe, expect, it } from "vitest";
import {
  applyPipOutdatedPreview,
  cacheCleanupFailureMessage,
  cacheCleanupPartialMessage,
  cacheCleanupStepSummary,
  cancelMaintenanceConfirmation,
  completeMaintenanceOperation,
  failMaintenanceOperation,
  finishMaintenanceOperationWithResult,
  requestCacheCleanup,
  requestNpmPackageUninstall,
  requestPackageUninstall,
  shouldApplyHydrationResult,
  startConfirmedMaintenanceOperation,
  type CacheCleanupRunLike,
  type CleanupStepLike,
  type MaintenanceUiState,
  type PipSnapshotLike,
} from "./state";

function cleanupStep(
  preview: string | null,
  label: string,
  state: CleanupStepLike["state"],
  failureMessage?: string,
): CleanupStepLike {
  return {
    label,
    command: preview ? { preview } : null,
    state,
    stdout: "",
    stderr: "",
    failure: failureMessage ? { message: failureMessage } : null,
  };
}

function partiallyCompletedDockerRun(): CacheCleanupRunLike {
  return {
    outcome: "PartiallyCompleted",
    steps: [
      cleanupStep("docker builder prune -f", "docker builder prune -f", "Succeeded"),
      cleanupStep(
        "docker image prune -f",
        "docker image prune -f",
        "Failed",
        "docker image prune -f failed",
      ),
    ],
    message: "docker image prune -f failed",
  };
}

function partiallyCompletedNpmRun(): CacheCleanupRunLike {
  return {
    outcome: "PartiallyCompleted",
    steps: [
      cleanupStep("npm cache clean --force", "npm cache clean --force", "Succeeded"),
      cleanupStep(
        null,
        "remove the npm _npx cache directory",
        "Failed",
        "Could not remove /tmp/npm-cache/_npx",
      ),
    ],
    message: "Could not remove /tmp/npm-cache/_npx",
  };
}

function snapshot(): PipSnapshotLike {
  return {
    packages: [
      { name: "black", signals: [] },
      { name: "requests", signals: ["Outdated"] },
      { name: "local-tool", signals: ["Editable"] },
    ],
    pip: {
      outdatedCount: 1,
      outdatedStatus: "Pending",
      outdatedMessage: null,
    },
  };
}

describe("pip outdated hydration state", () => {
  it("ignores stale hydration tokens", () => {
    expect(shouldApplyHydrationResult(1, 2)).toBe(false);
    expect(shouldApplyHydrationResult(2, 2)).toBe(true);
  });

  it("replaces outdated signals with the current result", () => {
    const state = snapshot();

    applyPipOutdatedPreview(state, {
      status: "Ready",
      outdated: ["BLACK"],
      message: null,
    });

    expect(state.packages[0].signals).toEqual(["Outdated"]);
    expect(state.packages[1].signals).toEqual([]);
    expect(state.packages[2].signals).toEqual(["Editable"]);
    expect(state.pip?.outdatedCount).toBe(1);
    expect(state.pip?.outdatedStatus).toBe("Ready");
  });

  it("records failed hydration without erasing installed rows", () => {
    const state = snapshot();

    applyPipOutdatedPreview(state, {
      status: "Failed",
      outdated: [],
      message: "index unavailable",
    });

    expect(state.packages.map((pkg) => pkg.name)).toEqual(["black", "requests", "local-tool"]);
    expect(state.packages[2].signals).toEqual(["Editable"]);
    expect(state.pip?.outdatedCount).toBe(0);
    expect(state.pip?.outdatedStatus).toBe("Failed");
    expect(state.pip?.outdatedMessage).toBe("index unavailable");
  });
});

describe("npm maintenance operation state", () => {
  it("confirms an npm package uninstall once and prevents duplicate starts while pending", () => {
    let state: MaintenanceUiState = { confirmation: null, pending: null };

    state = requestNpmPackageUninstall(state, 0, "@scope/tool");
    expect(state.confirmation).toEqual({
      kind: "uninstallGlobalPackage",
      managerId: "Npm",
      packageIndex: 0,
      packageName: "@scope/tool",
    });

    state = startConfirmedMaintenanceOperation(state);
    expect(state.pending).toEqual({
      kind: "uninstallGlobalPackage",
      managerId: "Npm",
      packageIndex: 0,
      packageName: "@scope/tool",
    });
    expect(state.confirmation).toEqual({
      kind: "uninstallGlobalPackage",
      managerId: "Npm",
      packageIndex: 0,
      packageName: "@scope/tool",
    });

    state = startConfirmedMaintenanceOperation(state);
    expect(state.pending).toEqual({
      kind: "uninstallGlobalPackage",
      managerId: "Npm",
      packageIndex: 0,
      packageName: "@scope/tool",
    });
  });

  it("can cancel npm cache clean confirmation and close the dialog after success", () => {
    let state: MaintenanceUiState = { confirmation: null, pending: null };

    state = requestCacheCleanup(state, "Npm");
    expect(state.confirmation).toEqual({ kind: "cleanupCache", managerId: "Npm" });

    state = cancelMaintenanceConfirmation(state);
    expect(state.confirmation).toBeNull();

    state = requestCacheCleanup(state, "Npm");
    state = startConfirmedMaintenanceOperation(state);
    expect(state.pending).toEqual({ kind: "cleanupCache", managerId: "Npm" });

    state = completeMaintenanceOperation(state);
    expect(state).toEqual({
      confirmation: null,
      pending: null,
      result: null,
    });
  });

  it("keeps the dialog open and records a failure result", () => {
    let state: MaintenanceUiState = { confirmation: null, pending: null };

    state = requestNpmPackageUninstall(state, 1, "missing-tool");
    state = startConfirmedMaintenanceOperation(state);
    state = failMaintenanceOperation(state, "not installed");

    expect(state).toEqual({
      confirmation: {
        kind: "uninstallGlobalPackage",
        managerId: "Npm",
        packageIndex: 1,
        packageName: "missing-tool",
      },
      pending: null,
      result: { tone: "bad", message: "not installed" },
    });
  });
});

describe("package manager maintenance operation state", () => {
  it("confirms a pnpm package uninstall once and prevents duplicate starts while pending", () => {
    let state: MaintenanceUiState = { confirmation: null, pending: null };

    state = requestPackageUninstall(state, "Pnpm", 0, "@scope/tool");
    expect(state.confirmation).toEqual({
      kind: "uninstallGlobalPackage",
      managerId: "Pnpm",
      packageIndex: 0,
      packageName: "@scope/tool",
    });

    state = startConfirmedMaintenanceOperation(state);
    expect(state.pending).toEqual({
      kind: "uninstallGlobalPackage",
      managerId: "Pnpm",
      packageIndex: 0,
      packageName: "@scope/tool",
    });

    state = requestPackageUninstall(state, "Pnpm", 1, "other-tool");
    expect(state.confirmation).toEqual({
      kind: "uninstallGlobalPackage",
      managerId: "Pnpm",
      packageIndex: 0,
      packageName: "@scope/tool",
    });
  });

  it("confirms pnpm store prune and prevents replacement while pending", () => {
    let state: MaintenanceUiState = { confirmation: null, pending: null };

    state = requestCacheCleanup(state, "Pnpm");
    expect(state.confirmation).toEqual({
      kind: "cleanupCache",
      managerId: "Pnpm",
    });

    state = startConfirmedMaintenanceOperation(state);
    state = requestCacheCleanup(state, "Pnpm");

    expect(state.pending).toEqual({
      kind: "cleanupCache",
      managerId: "Pnpm",
    });
    expect(state.confirmation).toEqual({
      kind: "cleanupCache",
      managerId: "Pnpm",
    });
  });
});

describe("cache cleanup reporting", () => {
  it("names the step that ran and the step that broke when a plan partly completes", () => {
    const message = cacheCleanupPartialMessage(partiallyCompletedNpmRun());

    expect(message).toContain("npm cache clean --force");
    expect(message).toContain("remove the npm _npx cache directory");
    expect(message).toContain("Could not remove /tmp/npm-cache/_npx");
  });

  it("describes a guarded deletion by its label because it has no command to show", () => {
    const run: CacheCleanupRunLike = {
      outcome: "Succeeded",
      steps: [
        cleanupStep("npm cache clean --force", "npm cache clean --force", "Succeeded"),
        cleanupStep(null, "remove the npm _npx cache directory", "Succeeded"),
      ],
      message: null,
    };

    expect(cacheCleanupStepSummary(run)).toBe(
      "npm cache clean --force；remove the npm _npx cache directory",
    );
  });

  it("prefers stderr over the generic message when a cleanup fails outright", () => {
    const run: CacheCleanupRunLike = {
      outcome: "Failed",
      steps: [
        {
          ...cleanupStep("npm cache clean --force", "npm cache clean --force", "Failed", "npm maintenance failed"),
          stderr: "EACCES: permission denied",
        },
        cleanupStep(null, "remove the npm _npx cache directory", "Skipped"),
      ],
      message: "npm maintenance failed",
    };

    expect(cacheCleanupFailureMessage(run)).toBe("EACCES: permission denied");
  });

  it("falls back to the run message when no step carries output", () => {
    const run: CacheCleanupRunLike = {
      outcome: "NoPlan",
      steps: [],
      message: "This package manager has no cleanup plan.",
    };

    expect(cacheCleanupFailureMessage(run)).toBe("This package manager has no cleanup plan.");
  });
});

describe("Docker two-step cleanup reporting", () => {
  it("says build cache was reclaimed even though image pruning failed", () => {
    // Docker is the first manager whose plan really has two commands, so this is
    // the first case where "it failed" would be an outright lie: space was freed.
    const message = cacheCleanupPartialMessage(partiallyCompletedDockerRun());

    expect(message).toContain("已完成：docker builder prune -f");
    expect(message).toContain("未完成：docker image prune -f");
  });

  it("renders a partial run in the warn tone, not as a failure", () => {
    let state: MaintenanceUiState = { confirmation: null, pending: null };

    state = requestCacheCleanup(state, "Docker");
    state = startConfirmedMaintenanceOperation(state);
    state = finishMaintenanceOperationWithResult(state, {
      tone: "warn",
      message: cacheCleanupPartialMessage(partiallyCompletedDockerRun()),
    });

    expect(state.pending).toBeNull();
    expect(state.result?.tone).toBe("warn");
    // The dialog stays open on a partial result so the user can read what ran.
    expect(state.confirmation).toEqual({ kind: "cleanupCache", managerId: "Docker" });
  });

  it("skips the second step when the daemon is unreachable and reports plain failure", () => {
    const run: CacheCleanupRunLike = {
      outcome: "Failed",
      steps: [
        {
          ...cleanupStep("docker builder prune -f", "docker builder prune -f", "Failed"),
          stderr: "Cannot connect to the Docker daemon",
        },
        cleanupStep("docker image prune -f", "docker image prune -f", "Skipped"),
      ],
      message: "docker builder prune -f failed",
    };

    expect(cacheCleanupFailureMessage(run)).toBe("Cannot connect to the Docker daemon");
  });
});
