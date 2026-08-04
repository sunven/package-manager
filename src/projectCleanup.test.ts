import { describe, expect, it } from "vitest";
import {
  projectDataMetrics,
  projectDataSelectable,
  filterAndSortProjectData,
} from "./projectCleanup";
import type { ProjectDataCandidate, ProjectDataScan } from "./types";

function candidate(
  candidateId: string,
  bytes: number,
  latestModifiedMs: number,
  status: ProjectDataCandidate["status"] = "Ready",
  kind: ProjectDataCandidate["kind"] = "RustTarget",
): ProjectDataCandidate {
  return {
    candidateId,
    kind,
    projectPath: `/code/${candidateId}`,
    directoryPath: `/code/${candidateId}/target`,
    status,
    message: null,
    measurement: {
      status: "Ready",
      bytes,
      human: `${bytes} B`,
      files: 1,
      directories: 1,
      skipped: 0,
      latestModifiedMs,
      message: null,
    },
  };
}

function scan(candidates: ProjectDataCandidate[]): ProjectDataScan {
  return {
    rootId: "root-1",
    scanId: "scan-1",
    rootPath: "/code",
    maxDepth: 8,
    status: "Ready",
    candidates,
    skipped: 0,
    errors: [],
    cargoAvailable: true,
    cargoMessage: null,
  };
}

describe("project data list policy", () => {
  it("sorts by directory footprint and filters by path or type", () => {
    const rows = [
      candidate("small", 100, 20),
      candidate("large", 500, 10, "Ready", "NodeModules"),
    ];

    expect(filterAndSortProjectData(rows, "", "size").map((row) => row.candidateId)).toEqual([
      "large",
      "small",
    ]);
    expect(filterAndSortProjectData(rows, "SMALL", "path").map((row) => row.candidateId)).toEqual([
      "small",
    ]);
    expect(filterAndSortProjectData(rows, "", "modified").map((row) => row.candidateId)).toEqual([
      "small",
      "large",
    ]);
    expect(
      filterAndSortProjectData(rows, "", "size", "NodeModules").map((row) => row.candidateId),
    ).toEqual(["large"]);
  });

  it("only requires Cargo for verified Rust targets", () => {
    const ready = candidate("ready", 100, 10);
    const nodeModules = candidate("node", 100, 10, "Ready", "NodeModules");
    const unknown = candidate("unknown", 100, 10, "Unrecognized");
    const partial = candidate("partial", 100, 10);
    partial.measurement.status = "Partial";
    partial.measurement.skipped = 1;

    expect(projectDataSelectable(ready, true)).toBe(true);
    expect(projectDataSelectable(ready, false)).toBe(false);
    expect(projectDataSelectable(nodeModules, false)).toBe(true);
    expect(projectDataSelectable(unknown, true)).toBe(false);
    expect(projectDataSelectable(partial, true)).toBe(false);
  });

  it("keeps verified, review, selected, and cleaned totals separate", () => {
    const ready = candidate("ready", 500, 20);
    const review = candidate("review", 200, 10, "Unrecognized");

    expect(projectDataMetrics(scan([ready, review]), new Set(["ready"]), new Map())).toEqual({
      verifiedBytes: 500,
      reviewBytes: 200,
      reviewCount: 1,
      selectedBytes: 500,
      cleanedBytes: 0,
    });
  });
});
