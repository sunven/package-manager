import { describe, expect, it } from "vitest";
import {
  buildArtifactMetrics,
  buildArtifactSelectable,
  filterAndSortBuildArtifacts,
} from "./buildArtifacts";
import type { BuildArtifactCandidate, BuildArtifactScan } from "./types";

function candidate(
  candidateId: string,
  bytes: number,
  latestModifiedMs: number,
  status: BuildArtifactCandidate["status"] = "Ready",
): BuildArtifactCandidate {
  return {
    candidateId,
    projectPath: `/code/${candidateId}`,
    targetPath: `/code/${candidateId}/target`,
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

function scan(candidates: BuildArtifactCandidate[]): BuildArtifactScan {
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

describe("build artifact list policy", () => {
  it("sorts by reclaimable size and filters by path", () => {
    const rows = [candidate("small", 100, 20), candidate("large", 500, 10)];

    expect(filterAndSortBuildArtifacts(rows, "", "size").map((row) => row.candidateId)).toEqual([
      "large",
      "small",
    ]);
    expect(filterAndSortBuildArtifacts(rows, "SMALL", "path").map((row) => row.candidateId)).toEqual([
      "small",
    ]);
    expect(filterAndSortBuildArtifacts(rows, "", "modified").map((row) => row.candidateId)).toEqual([
      "small",
      "large",
    ]);
  });

  it("only selects verified, fully measured candidates while Cargo is available", () => {
    const ready = candidate("ready", 100, 10);
    const unknown = candidate("unknown", 100, 10, "Unrecognized");
    const partial = candidate("partial", 100, 10);
    partial.measurement.status = "Partial";
    partial.measurement.skipped = 1;

    expect(buildArtifactSelectable(ready, true)).toBe(true);
    expect(buildArtifactSelectable(ready, false)).toBe(false);
    expect(buildArtifactSelectable(unknown, true)).toBe(false);
    expect(buildArtifactSelectable(partial, true)).toBe(false);
  });

  it("keeps verified, review, selected, and released totals separate", () => {
    const ready = candidate("ready", 500, 20);
    const review = candidate("review", 200, 10, "Unrecognized");

    expect(buildArtifactMetrics(scan([ready, review]), new Set(["ready"]), new Map())).toEqual({
      verifiedBytes: 500,
      reviewBytes: 200,
      reviewCount: 1,
      selectedBytes: 500,
      releasedBytes: 0,
    });
  });
});
