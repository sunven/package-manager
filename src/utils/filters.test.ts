import { describe, expect, it } from "vitest";
import { indexedPackages, searchAndSortPackages } from "./filters";
import { managerFixture } from "../test/fixtures";

describe("package sorting", () => {
  it("uses natural version order without changing original indexes", () => {
    const rows = indexedPackages(managerFixture("Npm", { packages: ["10", "2", "1"].map((version) => ({ name: "tool", version, path: null, kind: "Generic", source: "global", signals: [], actions: [] })) }));
    expect(searchAndSortPackages(rows, "", "version", false).map((row) => row.index)).toEqual([2, 1, 0]);
    expect(searchAndSortPackages(rows, "TOOL", "version", true).map((row) => row.index)).toEqual([0, 1, 2]);
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2]);
  });
});
