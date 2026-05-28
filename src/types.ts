export type ManagerId = "Npm" | "Pnpm" | "Yarn" | "Homebrew" | "Maven" | "Pip";
export type ManagerStatus = "Ready" | "Missing" | "Unsupported" | "Partial" | "Failed";
export type DiskUsageStatus = "Pending" | "Ready" | "Missing" | "PermissionDenied" | "Error";
export type PathKind =
  | "Cache"
  | "Store"
  | "GlobalModules"
  | "GlobalDir"
  | "Prefix"
  | "Cellar"
  | "Caskroom"
  | "LocalRepository"
  | "SitePackages"
  | "UserSite";
export type PackageKind = "Generic" | "Formula" | "Cask" | "MavenArtifact" | "PythonDistribution";
export type PackageSignal = "Outdated" | "Leaf" | "DuplicateVersions" | "Snapshot" | "Editable" | "UserSite" | "DirectUrl";
export type AsyncStatus = "Pending" | "Ready" | "Failed";
export type HomebrewFilter = "All" | "Formulae" | "Casks" | "Outdated" | "Leaves";
export type MavenFilter = "All" | "Duplicates" | "Snapshots";
export type PipFilter = "All" | "Outdated" | "Editable" | "UserSite" | "DirectUrl";
export type FailureKind = "MissingBinary" | "CommandFailed" | "ParseFailure" | "PermissionDenied" | "Timeout";

export interface CommandEnvelope {
  program: string;
  args: string[];
  preview: string;
  timeoutMs: number;
}

export interface CommandFailure {
  kind: FailureKind;
  message: string;
  command?: CommandEnvelope;
  stdout: string;
  stderr: string;
}

export interface DiskUsage {
  status: DiskUsageStatus;
  bytes: number | null;
  human: string | null;
  files: number;
  directories: number;
  skipped: number;
  message: string | null;
}

export interface PackageRow {
  name: string;
  version: string;
  path: string | null;
  source: string;
  kind: PackageKind;
  signals: PackageSignal[];
  actions: CommandEnvelope[];
}

export interface PathInfo {
  label: string;
  kind: PathKind;
  path: string;
  size: DiskUsage;
}

export interface ManagerSnapshot {
  id: ManagerId;
  label: string;
  status: ManagerStatus;
  version: string | null;
  packages: PackageRow[];
  paths: PathInfo[];
  commands: CommandEnvelope[];
  failures: CommandFailure[];
  unsupportedReason: string | null;
  homebrew: HomebrewMaintenance | null;
  maven: MavenRepositoryHealth | null;
  pip: PipEnvironmentHealth | null;
}

export interface HomebrewMaintenance {
  formulaCount: number;
  caskCount: number;
  outdatedCount: number;
  leafCount: number;
  outdated: string[];
  leaves: string[];
  cleanup: HomebrewCleanupPreview;
}

export interface HomebrewCleanupPreview {
  status: AsyncStatus;
  command: CommandEnvelope;
  rawOutput: string;
  reclaimedBytes: number | null;
  reclaimedHuman: string | null;
  message: string | null;
  failure: CommandFailure | null;
}

export interface MavenRepositoryHealth {
  localRepository: string;
  artifactCount: number;
  versionCount: number;
  snapshotCount: number;
  duplicateArtifactCount: number;
  topDuplicateArtifacts: MavenDuplicateArtifact[];
  repositoryScanStatus: RepositoryScanStatus;
}

export interface MavenDuplicateArtifact {
  coordinate: string;
  versionCount: number;
  versions: string[];
}

export interface RepositoryScanStatus {
  partial: boolean;
  scannedVersionDirs: number;
  skipped: number;
  message: string | null;
}

export interface PipEnvironmentHealth {
  pythonVersion: string;
  pythonExecutable: string;
  pipVersion: string;
  environmentKind: "System" | "User" | "VirtualEnv" | "Unknown";
  sitePackages: string | null;
  userSite: string | null;
  installedCount: number;
  outdatedCount: number;
  editableCount: number;
  directUrlCount: number;
  cache: PipCacheInfo;
  inspectStatus: AsyncStatus;
  outdatedStatus: AsyncStatus;
  outdatedMessage: string | null;
}

export interface PipCacheInfo {
  dir: string | null;
  rawInfo: string;
}

export interface PipOutdatedPreview {
  status: AsyncStatus;
  command: CommandEnvelope;
  outdated: string[];
  message: string | null;
  failure: CommandFailure | null;
}

export interface ManagerScanSnapshot {
  scanDurationMs: number;
  manager: ManagerSnapshot;
}

export type MessageTone = "bad" | "ok" | "warn";
export type DisplayStatus = ManagerStatus | DiskUsageStatus | AsyncStatus | "Scanning" | "Not scanned" | "neutral";

export interface UiMessage {
  tone: MessageTone;
  title: string;
  message: string;
}
