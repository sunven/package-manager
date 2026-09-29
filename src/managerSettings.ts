import { managerOrder } from "./constants";
import type { ManagerId } from "./types";

export const enabledManagersStorageKey = "package-manager.enabledManagers";
export const fvmMigrationStorageKey = "package-manager.migratedFvm";

type ManagerStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizeEnabledManagers(value: unknown): ManagerId[] {
  if (!Array.isArray(value)) return [...managerOrder];

  const requested = new Set(value.filter(isManagerId));
  const enabledManagers = managerOrder.filter((managerId) => requested.has(managerId));

  return enabledManagers.length > 0 ? enabledManagers : [...managerOrder];
}

export function parseEnabledManagers(rawValue: string | null): ManagerId[] {
  if (!rawValue) return [...managerOrder];

  try {
    return normalizeEnabledManagers(JSON.parse(rawValue));
  } catch {
    return [...managerOrder];
  }
}

export function readEnabledManagers(storage = browserStorage()): ManagerId[] {
  if (!storage) return [...managerOrder];

  try {
    const rawValue = storage.getItem(enabledManagersStorageKey);
    const enabledManagers = parseEnabledManagers(rawValue);
    // One-time migration: prefs saved before FVM existed lack it. Add it as
    // enabled (read-only observation), then never touch the choice again so a
    // later explicit disable persists.
    if (rawValue && !enabledManagers.includes("Fvm") && !migrationDone(storage)) {
      markMigrated(storage);
      const migrated = normalizeEnabledManagers([...enabledManagers, "Fvm"]);
      writeEnabledManagers(migrated, storage);
      return migrated;
    }
    if (rawValue) markMigrated(storage);
    return enabledManagers;
  } catch {
    return [...managerOrder];
  }
}

export function writeEnabledManagers(enabledManagers: ManagerId[], storage = browserStorage()) {
  if (!storage) return;

  try {
    storage.setItem(enabledManagersStorageKey, JSON.stringify(normalizeEnabledManagers(enabledManagers)));
  } catch {
    // Best-effort local preference; scanning still works with defaults.
  }
}

function isManagerId(value: unknown): value is ManagerId {
  return typeof value === "string" && managerOrder.includes(value as ManagerId);
}

function migrationDone(storage: ManagerStorage): boolean {
  try {
    return storage.getItem(fvmMigrationStorageKey) !== null;
  } catch {
    return true;
  }
}

function markMigrated(storage: ManagerStorage) {
  try {
    storage.setItem(fvmMigrationStorageKey, "1");
  } catch {
    // Best-effort local preference; scanning still works with defaults.
  }
}

function browserStorage(): ManagerStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}
