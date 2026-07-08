import { managerOrder } from "./constants";
import type { ManagerId } from "./types";

export const enabledManagersStorageKey = "package-manager.enabledManagers";

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
    return parseEnabledManagers(storage.getItem(enabledManagersStorageKey));
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

function browserStorage(): ManagerStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}
