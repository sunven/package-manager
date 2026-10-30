export const dismissedAppUpdateStorageKey = "package-manager.dismissedAppUpdate";

type AppUpdateStorage = Pick<Storage, "getItem" | "setItem">;

export function parseDismissedAppUpdateVersion(rawValue: string | null): string | null {
  if (!rawValue) return null;

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (typeof parsed === "string") return parsed || null;
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const version = (parsed as { version: unknown }).version;
      return typeof version === "string" && version ? version : null;
    }
  } catch {
    // A malformed preference never suppresses an update prompt.
  }

  return null;
}

export function readDismissedAppUpdateVersion(storage = browserStorage()): string | null {
  if (!storage) return null;

  try {
    return parseDismissedAppUpdateVersion(storage.getItem(dismissedAppUpdateStorageKey));
  } catch {
    return null;
  }
}

export function writeDismissedAppUpdateVersion(version: string | null, storage = browserStorage()) {
  if (!storage) return;

  try {
    storage.setItem(dismissedAppUpdateStorageKey, JSON.stringify({ version }));
  } catch {
    // Best-effort local preference; the prompt only returns on the next launch.
  }
}

function browserStorage(): AppUpdateStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}
