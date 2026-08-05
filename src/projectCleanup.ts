import type {
  ProjectDataCandidate,
  ProjectDataKind,
} from "./types";

export type ProjectDataSort = "size" | "modified" | "path";
export type ProjectDataFilter = "all" | ProjectDataKind;

export function projectName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function filterAndSortProjectData<T extends ProjectDataCandidate>(
  candidates: T[],
  query: string,
  sort: ProjectDataSort,
  kind: ProjectDataFilter = "all",
): T[] {
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
