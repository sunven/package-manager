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
  | {
      kind: "cleanCache";
      managerId: "Npm";
    }
  | {
      kind: "storePrune";
      managerId: "Pnpm";
    };

export type NpmMaintenanceRequest = Extract<MaintenanceRequest, { managerId: "Npm" }>;

export interface MaintenanceUiState {
  confirmation: MaintenanceRequest | null;
  pending: MaintenanceRequest | null;
  result?: MaintenanceResult | null;
}

export interface MaintenanceResult {
  tone: "ok" | "bad";
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

export function requestNpmCacheClean(state: MaintenanceUiState): MaintenanceUiState {
  if (state.pending) return state;
  return {
    ...state,
    confirmation: { kind: "cleanCache", managerId: "Npm" },
    result: null,
  };
}

export function requestPnpmStorePrune(state: MaintenanceUiState): MaintenanceUiState {
  if (state.pending) return state;
  return {
    ...state,
    confirmation: { kind: "storePrune", managerId: "Pnpm" },
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
