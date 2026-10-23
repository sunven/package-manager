import type {
  ProjectDataKind,
  ProjectScanCandidateKey,
  ProjectScanRecord,
} from "./types";

export function latestRecordForDepth(
  records: ProjectScanRecord[],
  maxDepth: number,
): ProjectScanRecord | null {
  return records.find((record) => record.maxDepth === maxDepth) ?? null;
}

export function otherDepthRecordCount(
  records: ProjectScanRecord[],
  maxDepth: number,
): number {
  return records.filter((record) => record.maxDepth !== maxDepth).length;
}

export function candidateKindLabel(kind: ProjectDataKind) {
  if (kind === "RustTarget") return "Rust target";
  if (kind === "MavenTarget") return "Maven target";
  return "Node node_modules";
}

export interface CandidateKeyGroup {
  kind: ProjectDataKind;
  keys: ProjectScanCandidateKey[];
}

export function groupCandidateKeys(keys: ProjectScanCandidateKey[]): CandidateKeyGroup[] {
  const grouped = new Map<ProjectDataKind, ProjectScanCandidateKey[]>();
  for (const key of keys) {
    const group = grouped.get(key.kind) ?? [];
    group.push(key);
    grouped.set(key.kind, group);
  }
  return (["RustTarget", "MavenTarget", "NodeModules"] as const)
    .filter((kind) => grouped.has(kind))
    .map((kind) => ({
      kind,
      keys: [...(grouped.get(kind) ?? [])].sort((left, right) =>
        left.directoryPath.localeCompare(right.directoryPath),
      ),
    }));
}

export function relativeScanPath(rootPath: string, path: string) {
  if (rootPath === "/") {
    return path.startsWith("/") ? path.slice(1) : path;
  }
  const root = rootPath.replace(/[/\\]+$/, "");
  if (!root) return path;
  if (path === root) return ".";
  if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) {
    return path.slice(root.length + 1);
  }
  return path;
}

export function projectDelta(record: ProjectScanRecord): number | null {
  if (!record.changes || !record.baseline) return null;
  return record.projects.total - record.baseline.projects.total;
}

export function scanChangeCounts(record: ProjectScanRecord) {
  return {
    added: record.changes?.added.length ?? 0,
    removed: record.changes?.removed.length ?? 0,
  };
}

export function formatScanTime(value: number) {
  return new Date(value).toLocaleString();
}
