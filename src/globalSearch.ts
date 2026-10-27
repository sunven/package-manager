import { managerOrder } from "./constants";
import { packageObservationId } from "./managerHistory";
import type { ManagerId, ManagerSnapshot } from "./types";

export interface SearchTarget { managerId: ManagerId; kind: "package" | "path"; observationId: string }
export interface SearchResult extends SearchTarget { key: string; name: string; version: string; path: string | null; objectKind: string }

export const pathObservationId = (kind: string, path: string) => JSON.stringify([kind, path]);

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
  const rank = (row: SearchResult) => row.name.toLocaleLowerCase() === needle ? 0 : row.name.toLocaleLowerCase().startsWith(needle) ? 1 : 2;
  return results
    .sort((a, b) => rank(a) - rank(b) || managerOrder.indexOf(a.managerId) - managerOrder.indexOf(b.managerId) || a.name.localeCompare(b.name, "zh-CN", { numeric: true }) || a.version.localeCompare(b.version, undefined, { numeric: true }));
}

export function locateSearchTarget(target: SearchTarget, snapshot: ManagerSnapshot | undefined): number {
  if (!snapshot || snapshot.id !== target.managerId) return -1;
  const matches = target.kind === "package"
    ? snapshot.packages.map((row, index) => ({ id: packageObservationId(snapshot.id, row), index }))
    : snapshot.paths.map((row, index) => ({ id: pathObservationId(row.kind, row.path), index }));
  const found = matches.filter((row) => row.id === target.observationId);
  return found.length === 1 ? found[0].index : -1;
}
