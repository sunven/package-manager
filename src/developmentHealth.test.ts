import { describe, expect, it } from "vitest";
import { buildDevelopmentHealthSummary } from "./developmentHealth";
import type { ManagerId, ManagerSnapshot, PackageRow, PathInfo } from "./types";

function manager(id: ManagerId, overrides: Partial<ManagerSnapshot>): ManagerSnapshot {
  return {
    id,
    label: id,
    status: "Ready",
    version: "1.0.0",
    packages: [],
    paths: [],
    commands: [],
    failures: [],
    unsupportedReason: null,
    homebrew: null,
    maven: null,
    pip: null,
    docker: null,
    ...overrides,
  };
}

function packageRow(name: string, signals: PackageRow["signals"]): PackageRow {
  return {
    name,
    version: "1.0.0",
    path: null,
    source: "test",
    kind: "Generic",
    signals,
    actions: [],
  };
}

function pathInfo(label: string, kind: PathInfo["kind"], bytes: number): PathInfo {
  return {
    label,
    kind,
    path: `/tmp/${label}`,
    size: {
      status: "Ready",
      bytes,
      human: `${bytes} B`,
      files: 1,
      directories: 0,
      skipped: 0,
      message: null,
    },
  };
}

describe("development health summary", () => {
  it("aggregates scanned managers, space, signals, and recommendations", () => {
    const summary = buildDevelopmentHealthSummary(["Npm", "Pip", "Docker"], {
      Npm: manager("Npm", {
        packages: [packageRow("eslint", ["Outdated"])],
        paths: [
          pathInfo("Cache", "Cache", 1024),
          pathInfo("Global modules", "GlobalModules", 2048),
        ],
      }),
      Pip: manager("Pip", {
        packages: [
          packageRow("local-tool", ["Editable"]),
          packageRow("direct-tool", ["DirectUrl"]),
        ],
        pip: {
          pythonVersion: "Python 3.12.0",
          pythonExecutable: "/usr/bin/python3",
          pipVersion: "pip 24.0",
          environmentKind: "VirtualEnv",
          sitePackages: null,
          userSite: null,
          installedCount: 2,
          outdatedCount: 0,
          editableCount: 1,
          directUrlCount: 1,
          cache: { dir: null, rawInfo: "" },
          inspectStatus: "Ready",
          outdatedStatus: "Ready",
          outdatedMessage: null,
        },
      }),
      Docker: manager("Docker", {
        packages: [packageRow("dangling", ["Dangling", "Unused"])],
        paths: [pathInfo("Docker Desktop data", "DockerDesktopData", 4096)],
        docker: {
          imageCount: 1,
          containerCount: 0,
          runningContainerCount: 0,
          volumeCount: 0,
          danglingImageCount: 1,
          unusedImageCount: 1,
          diskUsage: [
            {
              resourceType: "Images",
              totalCount: "1",
              activeCount: "0",
              size: "2GB",
              reclaimable: "1.5GB (75%)",
            },
          ],
          diskUsageStatus: "Ready",
          diskUsageMessage: null,
        },
      }),
    });

    expect(summary.scannedManagerCount).toBe(3);
    expect(summary.readyManagerCount).toBe(3);
    expect(summary.totalPackages).toBe(4);
    expect(summary.totalBytes).toBe(5120);
    expect(summary.maintenanceBytes).toBeGreaterThan(1024);
    expect(summary.riskSignalCount).toBe(2);
    expect(summary.reviewSignalCount).toBe(3);
    expect(summary.recommendations[0]).toMatchObject({
      id: "pip-local-sources",
      tone: "risk",
      managerId: "Pip",
    });
  });

  it("sorts largest counted storage and reports unscanned managers", () => {
    const summary = buildDevelopmentHealthSummary(["Npm", "Maven"], {
      Npm: manager("Npm", {
        paths: [
          pathInfo("Global modules", "GlobalModules", 20_000),
          pathInfo("Cache", "Cache", 1_000),
        ],
      }),
    });

    expect(summary.scannedManagerCount).toBe(1);
    expect(summary.managerStatuses).toEqual([
      { managerId: "Npm", status: "Ready", packageCount: 0 },
      { managerId: "Maven", status: "Not scanned", packageCount: 0 },
    ]);
    expect(summary.topStorage).toEqual([
      expect.objectContaining({
        managerId: "Npm",
        label: "Cache",
        bytes: 1_000,
      }),
    ]);
  });
});
