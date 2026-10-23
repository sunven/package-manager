export interface VscodeWorkspace {
  id: string;
  name: string;
  projectPath: string | null;
  storagePath: string;
  kind: "Folder" | "Workspace" | "Unknown";
  projectStatus: "Available" | "Missing" | "Remote" | "Unknown" | "Unavailable";
  removable: boolean;
  removalBlockReason: string | null;
  message: string | null;
  usage: {
    bytes: number | null;
    complete: boolean;
    message: string | null;
  };
}

export interface VscodeStorageScan {
  storagePath: string;
  status: "Ready" | "Partial" | "Missing";
  workspaces: VscodeWorkspace[];
  message: string | null;
}

export type VscodeEditorStatus = "Stopped" | "Running" | "Unknown";

export type VscodeStorageRemovalStatus = "Moved" | "Skipped" | "Failed";

export type VscodeStorageRemovalReason =
  | "NoLongerRecord"
  | "ProjectAvailable"
  | "ProjectRemote"
  | "ProjectUnavailable"
  | "NotRegularDirectory"
  | "TargetUnreadable"
  | "EditorStarted"
  | "TrashFailed";

export interface VscodeStorageRemovalItem {
  id: string;
  status: VscodeStorageRemovalStatus;
  reason: VscodeStorageRemovalReason | null;
  message: string | null;
}

export interface VscodeStorageRemovalResult {
  historyId?: string | null;
  historyWarning?: string | null;
  moved: number;
  failed: number;
  skipped: number;
  items: VscodeStorageRemovalItem[];
  operationError: string | null;
  message: string | null;
}

export type VscodeStorageRemovalProgress =
  | { phase: "preparing" }
  | { phase: "started"; total: number }
  | { phase: "advanced"; processed: number; total: number; moved: number; skipped: number; failed: number };

export interface VscodeRemovalTarget {
  workspaces: VscodeWorkspace[];
}

export function filterVscodeWorkspaces(workspaces: VscodeWorkspace[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return workspaces
    .filter((workspace) => [workspace.name, workspace.projectPath, workspace.storagePath]
      .some((value) => value?.toLocaleLowerCase().includes(needle)))
    .sort((left, right) =>
      (right.usage.bytes ?? -1) - (left.usage.bytes ?? -1)
      || left.name.localeCompare(right.name, "zh-CN")
      || left.id.localeCompare(right.id),
    );
}

export function summarizeVscodeStorage(scan: VscodeStorageScan) {
  const measured = scan.workspaces.filter((workspace) => workspace.usage.bytes !== null);
  return {
    bytes: measured.length || scan.status === "Ready"
      ? measured.reduce((total, workspace) => total + (workspace.usage.bytes ?? 0), 0)
      : null,
    complete: scan.status === "Ready" && scan.workspaces.every((workspace) => workspace.usage.complete),
    missingCount: scan.workspaces.filter((workspace) => workspace.projectStatus === "Missing").length,
    unknownCount: scan.workspaces.filter((workspace) => workspace.projectStatus === "Unknown").length,
  };
}
