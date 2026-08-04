import type {
  ProjectDataCandidate,
  ProjectDataKind,
  ProjectCleanupResult,
  ProjectDataScan,
} from "./types";

export type ProjectDataSort = "size" | "modified" | "path";
export type ProjectDataFilter = "all" | ProjectDataKind;

export function projectName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function projectDataSelectable(
  candidate: ProjectDataCandidate,
  cargoAvailable: boolean,
  cleanupResult?: ProjectCleanupResult,
) {
  return (
    (candidate.kind === "NodeModules" || cargoAvailable) &&
    !cleanupResult &&
    candidate.status === "Ready" &&
    candidate.measurement.status === "Ready" &&
    candidate.measurement.skipped === 0
  );
}

export function filterAndSortProjectData(
  candidates: ProjectDataCandidate[],
  query: string,
  sort: ProjectDataSort,
  kind: ProjectDataFilter = "all",
) {
  const needle = query.trim().toLocaleLowerCase();
  return candidates
    .filter((candidate) => {
      if (kind !== "all" && candidate.kind !== kind) return false;
      if (!needle) return true;
      return `${candidate.projectPath}\n${candidate.directoryPath}`.toLocaleLowerCase().includes(needle);
    })
    .sort((left, right) => {
      if (sort === "path") return left.projectPath.localeCompare(right.projectPath);
      if (sort === "modified") {
        return (right.measurement.latestModifiedMs ?? 0) - (left.measurement.latestModifiedMs ?? 0);
      }
      return (right.measurement.bytes ?? -1) - (left.measurement.bytes ?? -1);
    });
}

export function projectDataMetrics(
  scan: ProjectDataScan | null,
  selectedIds: Set<string>,
  cleanupResults: ReadonlyMap<string, ProjectCleanupResult>,
) {
  if (!scan) {
    return { verifiedBytes: 0, reviewBytes: 0, reviewCount: 0, selectedBytes: 0, cleanedBytes: 0 };
  }
  let verifiedBytes = 0;
  let reviewBytes = 0;
  let reviewCount = 0;
  let selectedBytes = 0;
  for (const candidate of scan.candidates) {
    const bytes = candidate.measurement.bytes ?? 0;
    const cleanupResult = cleanupResults.get(candidate.candidateId);
    if (cleanupResult?.status === "Succeeded" || cleanupResult?.status === "Skipped") {
      continue;
    }
    if (candidate.status === "Ready" && candidate.measurement.status === "Ready") {
      verifiedBytes += bytes;
    } else if (candidate.status !== "Ready" || candidate.measurement.status !== "Pending") {
      reviewBytes += bytes;
      reviewCount += 1;
    }
    if (selectedIds.has(candidate.candidateId)) selectedBytes += bytes;
  }
  const cleanedBytes = Array.from(cleanupResults.values()).reduce(
    (sum, result) => sum + result.cleanedBytes,
    0,
  );
  return { verifiedBytes, reviewBytes, reviewCount, selectedBytes, cleanedBytes };
}
