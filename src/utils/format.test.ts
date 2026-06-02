import { describe, expect, it } from "vitest";
import { countedSizePath, pathLabel } from "./format";

describe("path formatting", () => {
  it("labels npx cache paths", () => {
    expect(pathLabel("npx cache")).toBe("npx 缓存");
  });

  it("does not count npx cache separately from the parent npm cache", () => {
    expect(countedSizePath("Cache")).toBe(true);
    expect(countedSizePath("NpxCache")).toBe(false);
  });
});
