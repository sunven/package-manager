import type { AsyncStatus, PackageSignal } from "./types";

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
