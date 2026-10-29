import { describe, expect, it } from "vitest";
import { androidSdkMigrationStorageKey, enabledManagersStorageKey, fvmMigrationStorageKey, normalizeEnabledManagers, parseEnabledManagers, readEnabledManagers, writeEnabledManagers } from "./managerSettings";
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
    storage.values.set(androidSdkMigrationStorageKey, "1");

    writeEnabledManagers(["Uv", "Npm"], storage);

    expect(storage.values.get(enabledManagersStorageKey)).toBe(JSON.stringify(["Npm", "Uv"]));
    expect(readEnabledManagers(storage)).toEqual(["Npm", "Uv"]);
  });

  it("adds managers introduced later once, then preserves explicit choices", () => {
    const storage = memoryStorage();
    storage.values.set(enabledManagersStorageKey, JSON.stringify(["Npm", "Uv"]));

    expect(readEnabledManagers(storage)).toEqual(["Npm", "Uv", "Fvm", "AndroidSdk"]);
    expect(storage.values.get(fvmMigrationStorageKey)).toBe("1");
    expect(storage.values.get(androidSdkMigrationStorageKey)).toBe("1");

    // A later explicit disable persists: the migration never runs again.
    storage.values.set(enabledManagersStorageKey, JSON.stringify(["Npm", "Uv"]));
    expect(readEnabledManagers(storage)).toEqual(["Npm", "Uv"]);
  });

  it("leaves fresh installs and migrated prefs alone", () => {
    expect(readEnabledManagers(memoryStorage())).toEqual(managerOrder);

    const storage = memoryStorage();
    storage.values.set(enabledManagersStorageKey, JSON.stringify(["Npm", "Fvm", "AndroidSdk"]));
    storage.values.set(fvmMigrationStorageKey, "1");
    storage.values.set(androidSdkMigrationStorageKey, "1");
    expect(readEnabledManagers(storage)).toEqual(["Npm", "Fvm", "AndroidSdk"]);
  });
});
