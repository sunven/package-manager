import type { AsyncStatus, ManagerId, PackageSignal } from "./types";

export interface PackageRowLike {
  name: string;
  signals: PackageSignal[];
}

export interface PipOutdatedPreviewLike {
  status: AsyncStatus;
  outdated: string[];
  message: string | null;
}

export interface PipHealthLike {
  outdatedCount: number;
  outdatedStatus: AsyncStatus;
  outdatedMessage: string | null;
}

export interface PipSnapshotLike {
  packages: PackageRowLike[];
  pip: PipHealthLike | null;
}

export type MaintenanceRequest =
  | {
      kind: "uninstallGlobalPackage";
      managerId: "Npm";
      packageIndex: number;
      packageName: string;
    }
  | {
      kind: "uninstallGlobalPackage";
      managerId: "Pnpm";
      packageIndex: number;
      packageName: string;
    }
  /**
   * One request kind covers every manager. With a single backend entry point,
   * "clean npm's cache" and "prune pnpm's store" are the same operation applied
   * to different managers — the plan table holds what differs.
   */
  | {
      kind: "cleanupCache";
      managerId: ManagerId;
    };

export type NpmMaintenanceRequest = Extract<MaintenanceRequest, { managerId: "Npm" }>;

export interface MaintenanceUiState {
  confirmation: MaintenanceRequest | null;
  pending: MaintenanceRequest | null;
  result?: MaintenanceResult | null;
}

export interface MaintenanceResult {
  /// `warn` is a partially completed multi-step cleanup: some steps deleted
  /// things, a later one did not. Neither success nor failure describes it.
  tone: "ok" | "bad" | "warn";
  message: string;
}

export function applyPipOutdatedPreview<T extends PipSnapshotLike>(
  snapshot: T,
  preview: PipOutdatedPreviewLike,
): T {
  if (!snapshot.pip) return snapshot;

  const outdated = new Set(preview.outdated.map((name) => name.toLowerCase()));
  snapshot.packages.forEach((pkg) => {
    pkg.signals = pkg.signals.filter((signal) => signal !== "Outdated");
    if (outdated.has(pkg.name.toLowerCase())) {
      pkg.signals.push("Outdated");
    }
  });

  snapshot.pip.outdatedStatus = preview.status;
  snapshot.pip.outdatedCount = preview.status === "Ready" ? outdated.size : 0;
  snapshot.pip.outdatedMessage = preview.message;

  return snapshot;
}

export function shouldApplyHydrationResult(token: number, currentToken: number) {
  return token === currentToken;
}

export function requestNpmPackageUninstall(
  state: MaintenanceUiState,
  packageIndex: number,
  packageName: string,
): MaintenanceUiState {
  return requestPackageUninstall(state, "Npm", packageIndex, packageName);
}

export function requestPackageUninstall(
  state: MaintenanceUiState,
  managerId: Extract<ManagerId, "Npm" | "Pnpm">,
  packageIndex: number,
  packageName: string,
): MaintenanceUiState {
  if (state.pending) return state;
  return {
    ...state,
    confirmation: {
      kind: "uninstallGlobalPackage",
      managerId,
      packageIndex,
      packageName,
    },
    result: null,
  };
}

export function requestCacheCleanup(
  state: MaintenanceUiState,
  managerId: ManagerId,
): MaintenanceUiState {
  if (state.pending) return state;
  return {
    ...state,
    confirmation: { kind: "cleanupCache", managerId },
    result: null,
  };
}

export function cancelMaintenanceConfirmation(state: MaintenanceUiState): MaintenanceUiState {
  return {
    ...state,
    confirmation: null,
  };
}

export function startConfirmedMaintenanceOperation(state: MaintenanceUiState): MaintenanceUiState {
  if (!state.confirmation || state.pending) return state;
  return {
    ...state,
    pending: state.confirmation,
  };
}

export function finishMaintenanceOperation(state: MaintenanceUiState): MaintenanceUiState {
  return finishMaintenanceOperationWithResult(state, null);
}

export function finishMaintenanceOperationWithResult(
  state: MaintenanceUiState,
  result: MaintenanceResult | null,
): MaintenanceUiState {
  return {
    ...state,
    pending: null,
    result,
  };
}

export function completeMaintenanceOperation(state: MaintenanceUiState): MaintenanceUiState {
  return {
    ...state,
    confirmation: null,
    pending: null,
    result: null,
  };
}

export function failMaintenanceOperation(state: MaintenanceUiState, message: string): MaintenanceUiState {
  return finishMaintenanceOperationWithResult(state, { tone: "bad", message });
}

export interface CleanupStepLike {
  label: string;
  command: { preview: string } | null;
  state: "Succeeded" | "Failed" | "Skipped";
  stdout: string;
  stderr: string;
  failure: { message: string } | null;
}

export interface CacheCleanupRunLike {
  outcome: "Succeeded" | "PartiallyCompleted" | "Failed" | "NoPlan";
  steps: CleanupStepLike[];
  message: string | null;
}

function stepName(step: CleanupStepLike) {
  return step.command?.preview ?? step.label;
}

export function cacheCleanupStepSummary(run: CacheCleanupRunLike) {
  return run.steps.map(stepName).join("；");
}

/**
 * Names the steps that ran and the step that broke.
 *
 * A partially completed plan already deleted something. Telling the user only
 * "it failed" would send them back to redo work that already happened.
 */
export function cacheCleanupPartialMessage(run: CacheCleanupRunLike) {
  const done = run.steps.filter((step) => step.state === "Succeeded").map(stepName);
  const failed = run.steps.find((step) => step.state === "Failed");
  const reason = failed?.failure?.message ?? run.message ?? "未知原因";

  return `已完成：${done.join("；")}。未完成：${failed ? stepName(failed) : "后续步骤"}（${reason}）`;
}

export function cacheCleanupFailureMessage(run: CacheCleanupRunLike) {
  const failed = run.steps.find((step) => step.state === "Failed");
  return (
    failed?.stderr || failed?.stdout || failed?.failure?.message || run.message || "清理失败"
  );
}
