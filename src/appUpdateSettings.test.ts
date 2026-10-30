import { describe, expect, it } from "vitest";
import {
  dismissedAppUpdateStorageKey,
  parseDismissedAppUpdateVersion,
  readDismissedAppUpdateVersion,
  writeDismissedAppUpdateVersion,
} from "./appUpdateSettings";

function memoryStorage(values = new Map<string, string>()) {
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("app update settings", () => {
  it("reads and writes the dismissed version", () => {
    const storage = memoryStorage();

    writeDismissedAppUpdateVersion("0.1.2", storage);

    expect(storage.values.get(dismissedAppUpdateStorageKey)).toBe(JSON.stringify({ version: "0.1.2" }));
    expect(readDismissedAppUpdateVersion(storage)).toBe("0.1.2");
  });

  it("accepts a legacy bare string and ignores malformed values", () => {
    expect(parseDismissedAppUpdateVersion(JSON.stringify("0.1.2"))).toBe("0.1.2");
    expect(parseDismissedAppUpdateVersion("not-json")).toBeNull();
    expect(parseDismissedAppUpdateVersion(JSON.stringify({ version: 42 }))).toBeNull();
    expect(parseDismissedAppUpdateVersion(JSON.stringify({ version: null }))).toBeNull();
    expect(parseDismissedAppUpdateVersion(null)).toBeNull();
  });

  it("clears the dismissed version", () => {
    const storage = memoryStorage();
    writeDismissedAppUpdateVersion("0.1.2", storage);

    writeDismissedAppUpdateVersion(null, storage);

    expect(readDismissedAppUpdateVersion(storage)).toBeNull();
  });
});
