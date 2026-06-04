import { describe, expect, it } from "vitest";
import { countedSizePath, formatHomePath, formatHomePathsInText, pathLabel } from "./format";

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

  it("labels and counts nvm root without double-counting versions", () => {
    expect(pathLabel("NVM dir")).toBe("nvm 目录");
    expect(pathLabel("Node versions")).toBe("Node 版本目录");
    expect(countedSizePath("NvmDir")).toBe(true);
    expect(countedSizePath("NvmNodeVersions")).toBe(false);
  });

  it("formats displayed paths under the home directory with tilde", () => {
    expect(formatHomePath("/Users/sunven/.npm", "/Users/sunven")).toBe("~/.npm");
    expect(formatHomePath("/Users/sunven", "/Users/sunven/")).toBe("~");
    expect(formatHomePath("/Users/sunven-other/.npm", "/Users/sunven")).toBe("/Users/sunven-other/.npm");
  });

  it("formats home paths inside displayed messages without changing partial prefix matches", () => {
    expect(formatHomePathsInText("Would remove: /Users/sunven/Library/Caches/Homebrew", "/Users/sunven")).toBe("Would remove: ~/Library/Caches/Homebrew");
    expect(formatHomePathsInText("/Users/sunven and /Users/sunven/.npm", "/Users/sunven")).toBe("~ and ~/.npm");
    expect(formatHomePathsInText("/Users/sunven-other/.npm", "/Users/sunven")).toBe("/Users/sunven-other/.npm");
    expect(formatHomePathsInText("/private/Users/sunven/.npm", "/Users/sunven")).toBe("/private/Users/sunven/.npm");
  });
});
