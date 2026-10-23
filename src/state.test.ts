import { describe, expect, it } from "vitest";
import {
  cacheCleanupFailureMessage,
  cacheCleanupPartialMessage,
  cacheCleanupStepSummary,
  type CacheCleanupRunLike,
  type CleanupStepLike,
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
