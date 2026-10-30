import { managerOrder } from "./constants";
import { packageObservationId } from "./managerHistory";
import type { ManagerId, ManagerSnapshot } from "./types";

export interface SearchTarget { managerId: ManagerId; kind: "package" | "path"; observationId: string }
export interface SearchResult extends SearchTarget { key: string; name: string; version: string; path: string | null; objectKind: string }

export const pathObservationId = (kind: string, path: string) => JSON.stringify([kind, path]);

const managerRank = new Map(managerOrder.map((managerId, index) => [managerId, index]));
const nameCollator = new Intl.Collator("zh-CN", { numeric: true });
const versionCollator = new Intl.Collator(undefined, { numeric: true });

export function searchManagers(managers: ManagerId[], snapshots: Partial<Record<ManagerId, ManagerSnapshot>>, query: string): SearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const matches = (...values: (string | null)[]) =>
    values.join("\n").toLocaleLowerCase().includes(needle);
  const results: SearchResult[] = [];
  for (const managerId of managers) {
    const snapshot = snapshots[managerId];
    if (!snapshot) continue;
    for (const row of snapshot.packages) {
      if (!matches(row.name, row.version, row.path)) continue;
      const observationId = packageObservationId(managerId, row);
      results.push({ key: JSON.stringify([managerId, "package", observationId]), managerId, kind: "package", observationId,
        name: row.name, version: row.version, path: row.path, objectKind: row.kind });
    }
    for (const path of snapshot.paths) {
      if (!matches(path.label, "", path.path)) continue;
      const observationId = pathObservationId(path.kind, path.path);
      results.push({ key: JSON.stringify([managerId, "path", observationId]), managerId, kind: "path", observationId,
        name: path.label, version: "", path: path.path, objectKind: path.kind });
    }
  }
  return results
    .map((row) => {
      const name = row.name.toLocaleLowerCase();
      const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : 2;
      return { row, rank };
    })
    .sort((a, b) => a.rank - b.rank
      || (managerRank.get(a.row.managerId) ?? 0) - (managerRank.get(b.row.managerId) ?? 0)
      || nameCollator.compare(a.row.name, b.row.name)
      || versionCollator.compare(a.row.version, b.row.version))
    .map(({ row }) => row);
}

export function locateSearchTarget(target: SearchTarget, snapshot: ManagerSnapshot | undefined): number {
  if (!snapshot || snapshot.id !== target.managerId) return -1;
  const matches = target.kind === "package"
    ? snapshot.packages.map((row, index) => ({ id: packageObservationId(snapshot.id, row), index }))
    : snapshot.paths.map((row, index) => ({ id: pathObservationId(row.kind, row.path), index }));
  const found = matches.filter((row) => row.id === target.observationId);
  return found.length === 1 ? found[0].index : -1;
}
