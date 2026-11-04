export interface MavenUnusedCandidate {
  id: string;
  coordinate: string;
  version: string;
  path: string;
  bytes: number;
}

export interface MavenUnusedScan {
  scanId: string;
  scannedAt: number;
  repository: string;
  roots: string[];
  projects: number;
  versions: number;
  protectedVersions: number;
  excludedVersions: number;
  referenceMode: "complete" | "available";
  missingModels: string[];
  blockers: string[];
  candidates: MavenUnusedCandidate[];
}

export interface MavenUnusedOutcome {
  historyId?: string | null;
  historyWarning?: string | null;
  moved: number;
  skipped: number;
  failed: number;
  items: { id: string; status: "Moved" | "Skipped" | "Failed"; message: string | null }[];
}
