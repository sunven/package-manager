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

  it("labels cargo paths", () => {
    expect(pathLabel("Cargo registry cache")).toBe("Cargo registry 缓存");
    expect(pathLabel("Cargo git checkouts")).toBe("Cargo git checkouts");
  });

  it("counts cargo cache paths without counting cargo bin twice", () => {
    expect(countedSizePath("CargoBin")).toBe(false);
    expect(countedSizePath("CargoRegistryCache")).toBe(true);
    expect(countedSizePath("CargoRegistrySource")).toBe(true);
    expect(countedSizePath("CargoGitCache")).toBe(true);
    expect(countedSizePath("CargoGitCheckouts")).toBe(true);
  });
});
