import { describe, expect, it } from "vitest";
import {
  filterAndSortProjectData,
} from "./projectCleanup";
import type { ProjectDataCandidate } from "./types";

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
});
