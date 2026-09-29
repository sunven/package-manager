import { describe, expect, it } from "vitest";
import { enabledManagersStorageKey, fvmMigrationStorageKey, normalizeEnabledManagers, parseEnabledManagers, readEnabledManagers, writeEnabledManagers } from "./managerSettings";
import { managerOrder } from "./constants";

function memoryStorage(values = new Map<string, string>()) {
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

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
    const storage = memoryStorage();
    storage.values.set(fvmMigrationStorageKey, "1");

    writeEnabledManagers(["Uv", "Npm"], storage);

    expect(storage.values.get(enabledManagersStorageKey)).toBe(JSON.stringify(["Npm", "Uv"]));
    expect(readEnabledManagers(storage)).toEqual(["Npm", "Uv"]);
  });

  it("adds Fvm once for prefs saved before FVM existed", () => {
    const storage = memoryStorage();
    storage.values.set(enabledManagersStorageKey, JSON.stringify(["Npm", "Uv"]));

    expect(readEnabledManagers(storage)).toEqual(["Npm", "Uv", "Fvm"]);
    expect(storage.values.get(fvmMigrationStorageKey)).toBe("1");

    // A later explicit disable persists: the migration never runs again.
    storage.values.set(enabledManagersStorageKey, JSON.stringify(["Npm", "Uv"]));
    expect(readEnabledManagers(storage)).toEqual(["Npm", "Uv"]);
  });

  it("leaves fresh installs and Fvm-aware prefs alone", () => {
    expect(readEnabledManagers(memoryStorage())).toEqual(managerOrder);

    const storage = memoryStorage();
    storage.values.set(enabledManagersStorageKey, JSON.stringify(["Npm", "Fvm"]));
    expect(readEnabledManagers(storage)).toEqual(["Npm", "Fvm"]);
  });
});
