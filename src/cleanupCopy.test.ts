import { describe, expect, it } from "vitest";
import {
  cleanupCopy,
  cleanupCopyFor,
  cleanupCopyForPath,
  cleanupPreviewDetails,
  cleanupReady,
  cleanupReclaimable,
  hasCleanupPlan,
} from "./cleanupCopy";
import { managerOrder } from "./constants";
import type { DiskUsageStatus, ManagerId, ManagerSnapshot, PathKind } from "./types";

function dockerSnapshot(
  diskUsageStatus: "Pending" | "Ready" | "Failed",
  rows: { resourceType: string; reclaimable: string; size: string }[],
): ManagerSnapshot {
  return {
    ...snapshotWithPath("Docker", "DockerBuildx", "2 GB"),
    docker: {
      imageCount: 12,
      containerCount: 3,
      runningContainerCount: 1,
      volumeCount: 4,
      danglingImageCount: 5,
      unusedImageCount: 2,
      diskUsage: rows.map((row) => ({
        resourceType: row.resourceType,
        totalCount: "12",
        activeCount: "1",
        size: row.size,
        reclaimable: row.reclaimable,
      })),
      diskUsageStatus,
      diskUsageMessage: null,
    },
  };
}

function homebrewSnapshot(
  cleanupStatus: "Pending" | "Ready" | "Failed",
  reclaimedHuman: string | null,
  rawOutput: string,
): ManagerSnapshot {
  return {
    ...snapshotWithPath("Homebrew", "Cache", "500 MB"),
    homebrew: {
      formulaCount: 2,
      caskCount: 1,
      outdatedCount: 0,
      leafCount: 0,
      outdated: [],
      leaves: [],
      cleanup: {
        status: cleanupStatus,
        command: { program: "brew", args: ["cleanup", "--dry-run"], preview: "brew cleanup --dry-run", timeoutMs: 30000 },
        rawOutput,
        reclaimedBytes: reclaimedHuman ? 1 : null,
        reclaimedHuman,
        message: null,
        failure: null,
      },
    },
  };
}

function snapshotWithPath(
  id: ManagerId,
  kind: PathKind,
  human: string | null,
  status: DiskUsageStatus = "Ready",
): ManagerSnapshot {
  return {
    id,
    label: id,
    status: "Ready",
    version: null,
    packages: [],
    paths: [
      {
        label: kind,
        kind,
        path: `/tmp/${id}`,
        size: { status, bytes: 1, human, files: 1, directories: 0, skipped: 0, message: null },
      },
    ],
    commands: [],
    failures: [],
    unsupportedReason: null,
    homebrew: null,
    maven: null,
    pip: null,
    docker: null,
  };
}

describe("cleanup copy table", () => {
  it("offers no cleanup for managers that have no plan", () => {
    // nvm, Maven and Cargo ship no command that cleans their own cache, so the
    // app must not offer to clean them at all. See ADR-0001.
    for (const managerId of ["Nvm", "Maven", "Cargo"] as const) {
      expect(cleanupCopyFor(managerId)).toBeNull();
      expect(hasCleanupPlan(managerId)).toBe(false);
    }
  });

  it("keys every entry to a manager the app knows about", () => {
    for (const managerId of Object.keys(cleanupCopy)) {
      expect(managerOrder).toContain(managerId);
    }
  });

  it("shows the cleanup affordance only on the path card that owns it", () => {
    expect(cleanupCopyForPath("Npm", "Cache")?.action).toBe("清理 npm 缓存");
    expect(cleanupCopyForPath("Npm", "NpxCache")).toBeNull();
    expect(cleanupCopyForPath("Pnpm", "Store")?.action).toBe("清理 pnpm store");
    expect(cleanupCopyForPath("Pnpm", "Cache")).toBeNull();
    expect(cleanupCopyForPath("Nvm", "NvmDir")).toBeNull();
  });

  it("anchors uv cleanup to its cache, not its tools or Python installations", () => {
    // uv renders three inline path cards. Only the cache is derived data; the
    // tool and Python directories hold things the user installed.
    expect(cleanupCopyForPath("Uv", "UvCache")?.action).toBe("清理 uv 缓存");
    expect(cleanupCopyForPath("Uv", "UvTools")).toBeNull();
    expect(cleanupCopyForPath("Uv", "UvPythonInstallations")).toBeNull();
  });

  it("keeps uv on prune semantics and never mentions force", () => {
    const uv = cleanupCopyFor("Uv");

    expect(uv?.description).toContain("uv cache prune");
    expect(uv?.description).not.toContain("uv cache clean");
    expect(uv?.reclaimNote).toContain("实际回收量取决于当前引用情况");
    // Prune-type: no figure, because the cache size would badly over-promise.
    expect(uv?.reclaimSource).toBeUndefined();
  });

  it("explains prune semantics for pnpm instead of implying a reclaim figure", () => {
    const pnpm = cleanupCopyFor("Pnpm");

    expect(pnpm?.reclaimNote).toContain("不再被任何项目引用");
    expect(pnpm?.reclaimNote).toContain("实际回收量取决于当前引用情况");
  });

  it("does not attach a prune note to full-clear cleanups", () => {
    // npm empties its cache outright, so the measured path usage is honest and a
    // hedging note would only muddy it.
    expect(cleanupCopyFor("Npm")?.reclaimNote).toBeUndefined();
  });

  it("discloses that npm cleanup also removes the _npx directory", () => {
    expect(cleanupCopyFor("Npm")?.description).toContain("_npx");
  });
});

describe("cleanup reclaimable figure", () => {
  it("reports the measured path usage for cleanups that empty the directory", () => {
    expect(cleanupReclaimable(snapshotWithPath("Yarn", "Cache", "1.4 GB"))).toBe("1.4 GB");
    expect(cleanupReclaimable(snapshotWithPath("Bun", "BunCache", "220 MB"))).toBe("220 MB");
    expect(cleanupReclaimable(snapshotWithPath("Npm", "Cache", "3.2 GB"))).toBe("3.2 GB");
  });

  it("reports no figure for prune-type cleanups", () => {
    // pnpm store prune keeps everything still referenced, so the store size
    // would badly over-promise. Showing nothing beats showing a wrong number.
    expect(cleanupReclaimable(snapshotWithPath("Pnpm", "Store", "9.9 GB"))).toBeNull();
  });

  it("reports no figure before the size scan has finished", () => {
    expect(cleanupReclaimable(snapshotWithPath("Yarn", "Cache", null, "Pending"))).toBeNull();
  });

  it("reports no figure when the owning path is absent or the manager unknown", () => {
    expect(cleanupReclaimable(snapshotWithPath("Yarn", "GlobalDir", "1 GB"))).toBeNull();
    expect(cleanupReclaimable(undefined)).toBeNull();
  });
});

describe("Homebrew cleanup", () => {
  it("sources its figure from the dry-run, not the cache path size", () => {
    const html = homebrewSnapshot("Ready", "1.2 GB", "Removing: /opt/homebrew/Cellar/node/24.1.0");

    // The cache path measures 500 MB, but brew cleanup also removes old Cellar
    // versions, so only the dry-run knows the real total.
    expect(cleanupReclaimable(html)).toBe("1.2 GB");
  });

  it("shows the itemised list of what will be removed", () => {
    const details = cleanupPreviewDetails(
      homebrewSnapshot("Ready", "1.2 GB", "Removing: /opt/homebrew/Cellar/node/24.1.0"),
    );

    expect(details).toContain("/opt/homebrew/Cellar/node/24.1.0");
  });

  it("withholds cleanup until the dry-run has landed", () => {
    // Without the dry-run there is no itemised list, and the itemised list is the
    // entire reason Homebrew is allowed to exceed the cache-only scope (ADR-0002).
    expect(cleanupReady(homebrewSnapshot("Pending", null, ""))).toBe(false);
    expect(cleanupReady(homebrewSnapshot("Failed", null, ""))).toBe(false);
    expect(cleanupReady(homebrewSnapshot("Ready", "1.2 GB", "Removing: x"))).toBe(true);
  });

  it("shows no figure or details while the dry-run is pending", () => {
    const pending = homebrewSnapshot("Pending", null, "");

    expect(cleanupReclaimable(pending)).toBeNull();
    expect(cleanupPreviewDetails(pending)).toBeNull();
  });

  it("discloses that old installed versions are removed too", () => {
    const copy = cleanupCopyFor("Homebrew");

    expect(copy?.description).toContain("旧版本");
    expect(copy?.description).toContain("当前版本不受影响");
  });

  it("offers no itemised details for managers that cannot dry-run", () => {
    expect(cleanupPreviewDetails(snapshotWithPath("Yarn", "Cache", "1 GB"))).toBeNull();
  });

  it("keeps Homebrew off the path cards so the button sits with its dry-run", () => {
    expect(cleanupCopyForPath("Homebrew", "Cache")).toBeNull();
    expect(cleanupCopyFor("Homebrew")?.pathKind).toBeUndefined();
  });
});

describe("Docker cleanup", () => {
  const rows = [
    { resourceType: "Build Cache", reclaimable: "1.8GB", size: "1.8GB" },
    { resourceType: "Images", reclaimable: "600MB", size: "4GB" },
    { resourceType: "Local Volumes", reclaimable: "9GB", size: "9GB" },
  ];

  it("reports Docker's own reclaimable figures per resource type", () => {
    const details = cleanupPreviewDetails(dockerSnapshot("Ready", rows));

    expect(details).toContain("Build Cache");
    expect(details).toContain("1.8GB");
    expect(details).toContain("Images");
  });

  it("leaves volumes out of the reported figures, because the plan never touches them", () => {
    const details = cleanupPreviewDetails(dockerSnapshot("Ready", rows));

    // 9GB of reclaimable volume space must not appear next to a confirm button
    // that will not reclaim it — and must never be reclaimed at all.
    expect(details).not.toContain("Local Volumes");
    expect(details).not.toContain("9GB");
  });

  it("publishes no single aggregate figure", () => {
    // `docker system df` rows are pre-formatted strings covering resource types
    // the plan does not prune, so one total would read as a false promise.
    expect(cleanupReclaimable(dockerSnapshot("Ready", rows))).toBeNull();
    expect(cleanupCopyFor("Docker")?.reclaimSource).toBeUndefined();
  });

  it("shows nothing while docker system df is still loading", () => {
    expect(cleanupPreviewDetails(dockerSnapshot("Pending", []))).toBeNull();
    expect(cleanupPreviewDetails(dockerSnapshot("Failed", rows))).toBeNull();
  });

  it("states what survives the cleanup", () => {
    const copy = cleanupCopyFor("Docker");

    expect(copy?.description).toContain("dangling");
    expect(copy?.description).toContain("已打 tag 的镜像、容器和卷不会被删除");
    expect(copy?.reclaimNote).toContain("覆盖的资源类型比本次清理更广");
  });

  it("keeps Docker off the path cards", () => {
    // The plan spans build cache and dangling images, so no single path owns it.
    expect(cleanupCopyForPath("Docker", "DockerBuildx")).toBeNull();
    expect(cleanupCopyFor("Docker")?.pathKind).toBeUndefined();
  });
});
