import { describe, expect, it } from "vitest";
import {
  applyPipOutdatedPreview,
  cancelMaintenanceConfirmation,
  completeMaintenanceOperation,
  failMaintenanceOperation,
  requestNpmCacheClean,
  requestNpmPackageUninstall,
  shouldApplyHydrationResult,
  startConfirmedMaintenanceOperation,
  type MaintenanceUiState,
  type PipSnapshotLike,
} from "./state";

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
      packageIndex: 0,
      packageName: "@scope/tool",
    });

    state = startConfirmedMaintenanceOperation(state);
    expect(state.pending).toEqual({
      kind: "uninstallGlobalPackage",
      packageIndex: 0,
      packageName: "@scope/tool",
    });
    expect(state.confirmation).toEqual({
      kind: "uninstallGlobalPackage",
      packageIndex: 0,
      packageName: "@scope/tool",
    });

    state = startConfirmedMaintenanceOperation(state);
    expect(state.pending).toEqual({
      kind: "uninstallGlobalPackage",
      packageIndex: 0,
      packageName: "@scope/tool",
    });
  });

  it("can cancel npm cache clean confirmation and close the dialog after success", () => {
    let state: MaintenanceUiState = { confirmation: null, pending: null };

    state = requestNpmCacheClean(state);
    expect(state.confirmation).toEqual({ kind: "cleanCache" });

    state = cancelMaintenanceConfirmation(state);
    expect(state.confirmation).toBeNull();

    state = requestNpmCacheClean(state);
    state = startConfirmedMaintenanceOperation(state);
    expect(state.pending).toEqual({ kind: "cleanCache" });

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
        packageIndex: 1,
        packageName: "missing-tool",
      },
      pending: null,
      result: { tone: "bad", message: "not installed" },
    });
  });
});
