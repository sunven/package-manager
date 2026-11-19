import type { DiskScanDirectory, DiskScanEntry, DiskScanSummary } from "../diskScan";

export function diskSummary(overrides: Partial<DiskScanSummary> = {}): DiskScanSummary {
  return { scanId: "scan-1", revision: 0, rootPath: "/test", phase: "running", startedAt: 1795075200000,
    finishedAt: null, elapsedMs: 0, entries: 0, bytes: 0, errors: 0, excluded: 0, message: null, warning: null, ...overrides };
}

export function diskEntry(overrides: Partial<DiskScanEntry> = {}): DiskScanEntry {
  return { id: 0, name: "test", path: "/test", kind: "directory", bytes: 4096, status: "complete", message: null, ...overrides };
}

export function diskDirectory(overrides: Partial<DiskScanDirectory> = {}): DiskScanDirectory {
  return { scanId: "scan-1", directory: diskEntry(), ancestors: [], entries: [
    diskEntry({ id: 1, name: "project", path: "/test/project" }),
    diskEntry({ id: 2, name: "readme", path: "/test/readme", kind: "file", bytes: 0 }),
    diskEntry({ id: 3, name: "restricted", path: "/test/restricted", bytes: null, status: "partial", message: "无法读取目录：权限不足" }),
    diskEntry({ id: 4, name: "linked", path: "/test/linked", kind: "symlink", bytes: null, status: "excluded", message: "符号链接，未计入且不跟随目标。" }),
  ], total: 4, ...overrides };
}
