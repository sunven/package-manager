import { describe, expect, it } from "vitest";
import { enabledManagersStorageKey, normalizeEnabledManagers, parseEnabledManagers, readEnabledManagers, writeEnabledManagers } from "./managerSettings";
import { managerOrder } from "./constants";

describe("manager settings", () => {
  it("keeps valid managers in the application order", () => {
    expect(normalizeEnabledManagers(["Pip", "Npm", "Pip", "Unknown"])).toEqual(["Npm", "Pip"]);
  });

  it("falls back to all managers when the saved value is empty or invalid", () => {
    expect(normalizeEnabledManagers([])).toEqual(managerOrder);
    expect(parseEnabledManagers("not-json")).toEqual(managerOrder);
    expect(parseEnabledManagers(JSON.stringify(["Unknown"]))).toEqual(managerOrder);
  });

  it("reads and writes the enabled manager list", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    writeEnabledManagers(["Uv", "Npm"], storage);

    expect(values.get(enabledManagersStorageKey)).toBe(JSON.stringify(["Npm", "Uv"]));
    expect(readEnabledManagers(storage)).toEqual(["Npm", "Uv"]);
  });
});
