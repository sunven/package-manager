import type { ManagerId, ManagerSnapshot, PackageKind, PackageRow, PackageSignal } from "./types";

export interface ArchivedPackage {
  observationId: string;
  name: string;
  version: string;
  observedVersions: string[] | null;
  path: string | null;
  kind: PackageKind;
  signals: PackageSignal[];
}

export interface ArchivedPath {
  kind: string;
  label: string;
  path: string;
  bytes: number | null;
  complete: boolean;
}

export interface SnapshotDraft {
  managerId: ManagerId;
  status: string;
  version: string | null;
  scopeKey: string | null;
  complete: boolean;
  packages: ArchivedPackage[];
  paths: ArchivedPath[];
  message: string | null;
}

export interface ArchivedSnapshot extends SnapshotDraft { id: string; capturedAt: number }

export interface ManagerHistory { snapshots: ArchivedSnapshot[]; warnings: string[] }

// Native scans supply identity; the fallback keeps older/test observations
// navigable without using a transient row index as an identity.
export function packageObservationId(manager: ManagerId, row: PackageRow): string {
  return row.observationId ?? JSON.stringify([row.kind, row.name,
    manager === "Nvm" || row.kind === "UvPython" || row.kind === "FlutterVersion" ? row.path ?? row.version : null,
  ]);
}

export function snapshotDraft(manager: ManagerSnapshot, message: string | null): SnapshotDraft {
  const packages = manager.packages.map((row) => ({
    observationId: packageObservationId(manager.id, row), name: row.name, version: row.version,
    observedVersions: row.observedVersions ?? null, path: row.path, kind: row.kind, signals: [...row.signals],
  }));
  return {
    managerId: manager.id, status: manager.status, version: manager.version, scopeKey: manager.scopeKey ?? null,
    complete: manager.status === "Ready" && !manager.maven?.repositoryScanStatus.partial
      && !(manager.maven?.repositoryScanStatus.skipped) && new Set(packages.map((p) => p.observationId)).size === packages.length,
    packages,
    paths: manager.paths.map((p) => ({ kind: p.kind, label: p.label, path: p.path, bytes: p.size.bytes,
      complete: p.size.status === "Ready" && p.size.skipped === 0 && p.size.bytes !== null })),
    message,
  };
}

export function failedSnapshotDraft(managerId: ManagerId, message: string): SnapshotDraft {
  return { managerId, message, status: "Failed", version: null, scopeKey: null, complete: false, packages: [], paths: [] };
}

export interface PackageChange { id: string; name: string; change: "added" | "removed" | "changed"; label: string; before: string | null; after: string | null }
export interface SnapshotDifference {
  issue: string | null;
  packages: PackageChange[];
  paths: { key: string; label: string; path: string; before: number | null; after: number | null; delta: number | null }[];
}

function comparisonValue(row: ArchivedPackage): string {
  if (row.kind === "DockerContainer") return row.signals.includes("Running") ? "运行中" : row.signals.includes("Stopped") ? "已停止" : "状态未知";
  if (row.kind === "MavenArtifact" && row.observedVersions) return [...row.observedVersions].sort().join("、");
  return row.version;
}

export function compareSnapshots(before: ArchivedSnapshot, after: ArchivedSnapshot): SnapshotDifference {
  const sameSource = before.managerId === after.managerId && Boolean(before.scopeKey) && before.scopeKey === after.scopeKey;
  const issue = !sameSource ? "两次观察来源不同或来源无法核实，不能判定条目增减。"
    : !before.complete || !after.complete ? "至少一轮清单不完整，不能判定条目增减或版本变化。" : null;
  const changes: PackageChange[] = [];
  if (!issue) {
    const old = new Map(before.packages.map((p) => [p.observationId, p]));
    const current = new Map(after.packages.map((p) => [p.observationId, p]));
    for (const [id, row] of old) {
      if (!current.has(id)) changes.push({ id, name: row.name, change: "removed", label: "清单中减少", before: comparisonValue(row), after: null });
    }
    for (const [id, row] of current) {
      const previous = old.get(id);
      if (!previous) changes.push({ id, name: row.name, change: "added", label: "清单中新增", before: null, after: comparisonValue(row) });
      else if (comparisonValue(previous) !== comparisonValue(row)) changes.push({ id, name: row.name, change: "changed",
        label: row.kind.startsWith("Docker") ? "资源信息变化" : "版本变化", before: comparisonValue(previous), after: comparisonValue(row) });
    }
  }
  const key = (path: ArchivedPath) => JSON.stringify([path.kind, path.path]);
  const oldPaths = new Map(before.paths.map((p) => [key(p), p]));
  const newPaths = new Map(after.paths.map((p) => [key(p), p]));
  const paths = [...new Set([...oldPaths.keys(), ...newPaths.keys()])].map((id) => {
    const old = oldPaths.get(id), current = newPaths.get(id), path = current ?? old!;
    return { key: id, label: path.label, path: path.path, before: old?.bytes ?? null, after: current?.bytes ?? null,
      delta: sameSource && old?.complete && current?.complete && old.bytes !== null && current.bytes !== null ? current.bytes - old.bytes : null };
  });
  return { issue, packages: changes, paths };
}
