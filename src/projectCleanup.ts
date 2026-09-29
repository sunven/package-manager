import type {
  ProjectDataCandidate,
  ProjectDataKind,
} from "./types";

export type ProjectDataSort = "size" | "modified" | "path";
export type ProjectDataSortDir = "asc" | "desc";
export type ProjectDataFilter = "all" | ProjectDataKind;

export function defaultSortDir(sort: ProjectDataSort): ProjectDataSortDir {
  return sort === "path" ? "asc" : "desc";
}

export function projectName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function filterAndSortProjectData<T extends ProjectDataCandidate>(
  candidates: T[],
  query: string,
  sort: ProjectDataSort,
  kind: ProjectDataFilter = "all",
  dir: ProjectDataSortDir = defaultSortDir(sort),
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  const sign = dir === "asc" ? 1 : -1;
  return candidates
    .filter((candidate) => {
      if (kind !== "all" && candidate.kind !== kind) return false;
      if (!needle) return true;
      return `${candidate.projectPath}\n${candidate.directoryPath}`.toLocaleLowerCase().includes(needle);
    })
    .sort((left, right) => {
      if (sort === "path") return sign * left.projectPath.localeCompare(right.projectPath);
      if (sort === "modified") {
        // 未测量的条目始终沉底，不随方向翻转。
        const leftRank = left.measurement.latestModifiedMs === null ? 1 : 0;
        const rightRank = right.measurement.latestModifiedMs === null ? 1 : 0;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return sign * ((left.measurement.latestModifiedMs ?? 0) - (right.measurement.latestModifiedMs ?? 0));
      }
      const leftRank = left.measurement.bytes === null ? 1 : 0;
      const rightRank = right.measurement.bytes === null ? 1 : 0;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return sign * ((left.measurement.bytes ?? 0) - (right.measurement.bytes ?? 0));
    });
}
