import type { ManagerId, ManagerSnapshot, ProjectCleanupSettings } from "../types";
import type { SessionRemovalResult } from "../sessionRecords";

export function managerFixture(id: ManagerId = "Npm", changes: Partial<ManagerSnapshot> = {}): ManagerSnapshot {
  return { id, label: id, version: "1.0.0", status: "Ready", packages: [], paths: [], commands: [], failures: [], unsupportedReason: null, homebrew: null, maven: null, pip: null, docker: null, ...changes };
}

export function presetSettings(changes: Partial<ProjectCleanupSettings> = {}): ProjectCleanupSettings {
  return { rootId: "root-1", rootPath: "/code", maxDepth: 8, presets: [{ id: "preset-1", path: "/code", maxDepth: 8 }], activePresetId: "preset-1", rootMessage: null, ...changes };
}

export function removalResult(changes: Partial<SessionRemovalResult> = {}): SessionRemovalResult {
  return { moved: 0, failed: 0, skipped: 0, items: [], message: null, operationError: null, ...changes };
}
