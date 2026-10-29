import { managerOrder } from "./constants";
import type { ManagerId } from "./types";

export const enabledManagersStorageKey = "package-manager.enabledManagers";
export const fvmMigrationStorageKey = "package-manager.migratedFvm";
export const androidSdkMigrationStorageKey = "package-manager.migratedAndroidSdk";

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
    if (!rawValue) return enabledManagers;

    // Managers added after a preference was saved are enabled once, then the
    // explicit choice is never touched again (including a later disable).
    let migrated = enabledManagers;
    let changed = false;
    if (!migrated.includes("Fvm") && !migrationDone(storage, fvmMigrationStorageKey)) {
      migrated = normalizeEnabledManagers([...migrated, "Fvm"]);
      changed = true;
    }
    if (!migrated.includes("AndroidSdk") && !migrationDone(storage, androidSdkMigrationStorageKey)) {
      migrated = normalizeEnabledManagers([...migrated, "AndroidSdk"]);
      changed = true;
    }
    markMigrated(storage, fvmMigrationStorageKey);
    markMigrated(storage, androidSdkMigrationStorageKey);
    if (changed) writeEnabledManagers(migrated, storage);
    return migrated;
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

function migrationDone(storage: ManagerStorage, key: string): boolean {
  try {
    return storage.getItem(key) !== null;
  } catch {
    return true;
  }
}

function markMigrated(storage: ManagerStorage, key: string) {
  try {
    storage.setItem(key, "1");
  } catch {
    // Best-effort local preference; scanning still works with defaults.
  }
}

function browserStorage(): ManagerStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}
