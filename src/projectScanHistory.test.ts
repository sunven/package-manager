import { describe, expect, it } from "vitest";
import {
  groupCandidateKeys,
  latestRecordForDepth,
  otherDepthRecordCount,
  projectDelta,
  relativeScanPath,
  scanChangeCounts,
} from "./projectScanHistory";
import type { ProjectScanCandidateKey, ProjectScanRecord } from "./types";

function key(kind: ProjectScanCandidateKey["kind"], directoryPath: string): ProjectScanCandidateKey {
  return { kind, directoryPath };
}

function record(overrides: Partial<ProjectScanRecord> = {}): ProjectScanRecord {
  return {
    id: "record-1",
    presetId: "preset-1",
    scanId: "scan-1",
    rootPath: "/code",
    maxDepth: 8,
    finishedAt: 100,
    discovery: { complete: true, skipped: 0 },
    measurement: "finished",
    projects: { total: 2, rust: 1, node: 1, maven: 0 },
    candidates: { total: 2, rustTarget: 1, mavenTarget: 0, nodeModules: 1 },
    baseline: null,
    changes: null,
    ...overrides,
  };
}

describe("project scan history presentation", () => {
  it("selects the latest record for the current depth", () => {
    const records = [
      record({ id: "newer-other-depth", finishedAt: 300, maxDepth: 6 }),
      record({ id: "newer-current-depth", finishedAt: 200, maxDepth: 8 }),
      record({ id: "older-current-depth", finishedAt: 100, maxDepth: 8 }),
    ];
    expect(latestRecordForDepth(records, 8)?.id).toBe("newer-current-depth");
    expect(latestRecordForDepth(records, 6)?.id).toBe("newer-other-depth");
    expect(latestRecordForDepth(records, 4)).toBeNull();
    expect(otherDepthRecordCount(records, 8)).toBe(1);
  });

  it("renders paths relative to the scan root", () => {
    expect(relativeScanPath("/code", "/code/app/target")).toBe("app/target");
    expect(relativeScanPath("/code/", "/code/app/target")).toBe("app/target");
    expect(relativeScanPath("/code", "/code")).toBe(".");
    expect(relativeScanPath("/", "/code/app")).toBe("code/app");
    expect(relativeScanPath("/code", "/other/app")).toBe("/other/app");
    expect(relativeScanPath("C:\\code", "C:\\code\\app")).toBe("app");
  });

  it("groups changed candidate keys by kind and sorts paths", () => {
    const groups = groupCandidateKeys([
      key("NodeModules", "/code/b/node_modules"),
      key("RustTarget", "/code/z/target"),
      key("NodeModules", "/code/a/node_modules"),
      key("MavenTarget", "/code/m/target"),
    ]);
    expect(groups.map((group) => group.kind)).toEqual([
      "RustTarget",
      "MavenTarget",
      "NodeModules",
    ]);
    expect(groups[2].keys.map((candidate) => candidate.directoryPath)).toEqual([
      "/code/a/node_modules",
      "/code/b/node_modules",
    ]);
  });

  it("reports project and candidate deltas only for comparable records", () => {
    expect(scanChangeCounts(record())).toEqual({ added: 0, removed: 0 });
    expect(projectDelta(record())).toBeNull();
    const comparable = record({
      projects: { total: 4, rust: 2, node: 2, maven: 0 },
      baseline: {
        finishedAt: 50,
        projects: { total: 2, rust: 1, node: 1, maven: 0 },
        candidates: { total: 2, rustTarget: 1, mavenTarget: 0, nodeModules: 1 },
      },
      changes: {
        added: [key("NodeModules", "/code/c/node_modules")],
        removed: [key("RustTarget", "/code/a/target")],
      },
    });
    expect(projectDelta(comparable)).toBe(2);
    expect(scanChangeCounts(comparable)).toEqual({ added: 1, removed: 1 });
  });
});
