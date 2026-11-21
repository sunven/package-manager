import type { DirectoryMeasurement, ManagerId, ManagerSnapshot, ProjectCleanupSettings, ProjectDataCandidate, ProjectDataScan, ProjectScanSummary } from "../types";
import type { ProjectCleanupEffects } from "../projectCleanupWorkflow";
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

export function completedProjectScan(
  scan: ProjectDataScan,
  measurement: (candidate: ProjectDataCandidate) => DirectoryMeasurement,
  changes: Partial<ProjectScanSummary> = {},
): ProjectCleanupEffects["runScan"] {
  return async ({ onProgress }) => {
    onProgress({ phase: "started", scanId: scan.scanId });
    onProgress({ phase: "discovered", scan });
    for (const candidate of scan.candidates) {
      if (candidate.status === "Ready" || candidate.status === "Unrecognized") {
        onProgress({ phase: "measured", candidateId: candidate.candidateId, measurement: measurement(candidate) });
      }
    }
    return { scanId: scan.scanId, finish: "finished", finishedAt: Date.now(), record: null, historyWarning: null, ...changes };
  };
}
