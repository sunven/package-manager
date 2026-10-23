import { describe, expect, it } from "vitest";
import {
  buildCommandLocationDescriptors,
  buildCommandLocationScope,
  buildCommandLocationSummary,
  buildCommandLocationTargets,
  deriveCommandLocationAssociations,
  type CandidateLocationAssociation,
  type CommandLocationDescriptor,
  type CommandLocationMatch,
} from "./commandLocationAssociation";
import type { EnvironmentInspection } from "./environmentInspection";
import type { ManagerScanState } from "./managerScanning";
import type { ObservationRecord } from "./observationLedger";
import type { ObservationItemId } from "./observationItems";
import { managerFixture } from "./test/fixtures";
import type {
  ManagerId,
  ManagerSnapshot,
  PackageKind,
  PackageRow,
  PathKind,
} from "./types";

const usage = {
  status: "Ready" as const,
  bytes: 0,
  human: "0 B",
  files: 0,
  directories: 0,
  skipped: 0,
  message: null,
};

function pathInfo(kind: PathKind, path: string, label = kind) {
  return { label, kind, path, size: usage };
}

function packageRow(
  name: string,
  version: string,
  path: string | null,
  kind: PackageKind = "Generic",
): PackageRow {
  return { name, version, path, source: "test", kind, signals: [], actions: [] };
}

function pipFixture(pythonExecutable = "/uv/python/bin/python3"): NonNullable<ManagerSnapshot["pip"]> {
  return {
    pythonVersion: "3.12.0",
    pythonExecutable,
    pipVersion: "26.0",
    environmentKind: "System",
    sitePackages: "/uv/python/lib/site-packages",
    userSite: null,
    installedCount: 1,
    outdatedCount: 0,
    editableCount: 0,
    directUrlCount: 0,
    cache: { dir: null, rawInfo: "" },
    inspectStatus: "Ready",
    outdatedStatus: "Ready",
    outdatedMessage: null,
  };
}

function descriptor(
  id: string,
  managerId: ManagerId,
  kind: CommandLocationDescriptor["kind"],
  path: string,
  label = id,
  pkg?: { name: string; version: string },
): CommandLocationDescriptor {
  return { id, managerId, kind, path, label, ...(pkg ? { package: pkg } : {}) };
}

function match(
  targetId: string,
  locationId: string,
  canonicalLocation: string,
  suppressedBy: string | null = null,
): CommandLocationMatch {
  return {
    targetId,
    locationId,
    relation: "contained",
    canonicalLocation,
    suppressedBy,
  };
}

function group(
  managerId: ManagerId,
  source: CommandLocationDescriptor | null = null,
): CandidateLocationAssociation["groups"][number] {
  return { managerId, source, packages: [], interpreters: [] };
}

describe("buildCommandLocationDescriptors", () => {
  it("includes only installation locations for enabled managers", () => {
    const snapshots: Partial<Record<ManagerId, ManagerSnapshot>> = {
      Npm: managerFixture("Npm", {
        paths: [
          pathInfo("GlobalModules", "/npm"),
          pathInfo("Cache", "/npm-cache"),
          pathInfo("GlobalModules", "/npm"),
        ],
        packages: [packageRow("npm", "11", "/npm/npm"), packageRow("none", "1", null)],
      }),
      Pip: managerFixture("Pip", {
        paths: [pathInfo("SitePackages", "/site"), pathInfo("UserSite", "/user")],
        packages: [packageRow("pip", "1", "/site/pip", "PythonDistribution")],
        pip: pipFixture(),
      }),
      Homebrew: managerFixture("Homebrew", {
        paths: [
          pathInfo("Prefix", "/brew"),
          pathInfo("Cellar", "/brew/Cellar"),
          pathInfo("Caskroom", "/brew/Caskroom"),
        ],
        packages: [packageRow("node", "1", "/brew/Cellar/node/1", "Formula")],
      }),
      Maven: managerFixture("Maven", {
        paths: [pathInfo("LocalRepository", "/m2")],
        packages: [packageRow("artifact", "1", "/m2/artifact", "MavenArtifact")],
      }),
      Docker: managerFixture("Docker", {
        paths: [pathInfo("DockerConfig", "/docker")],
        packages: [packageRow("image", "1", "sha256:abc", "DockerImage")],
      }),
    };

    const result = buildCommandLocationDescriptors(
      ["Npm", "Pip", "Homebrew", "Maven"],
      snapshots,
    );

    expect(result).toHaveLength(10);
    expect(result.filter((entry) => entry.path === "/npm")).toHaveLength(1);
    expect(result.some((entry) => entry.path === "/npm-cache")).toBe(false);
    expect(result.some((entry) => entry.managerId === "Maven")).toBe(false);
    expect(result.some((entry) => entry.managerId === "Docker")).toBe(false);
    expect(
      result.find((entry) => entry.kind === "interpreter")?.managerId,
    ).toBe("Pip");
    expect(result.find((entry) => entry.id === "Npm:package:0")?.label).toBe("npm@11");
  });
});

describe("buildCommandLocationTargets", () => {
  it("keeps only executable candidates with a canonical target", () => {
    const environment: EnvironmentInspection = {
      capturedAt: 1,
      pathEntries: [],
      commands: [
        {
          program: "node",
          managers: ["Nvm"],
          selectedPath: "/bin/node",
          status: "aliases",
          candidates: [
            { pathIndex: 0, path: "/bin/node", target: "/real/node", status: "executable", message: null },
            { pathIndex: 1, path: "/other/node", target: "/real/node", status: "executable", message: null },
            { pathIndex: 2, path: "/broken", target: null, status: "brokenLink", message: "x" },
          ],
        },
        {
          program: "missing",
          managers: ["Npm"],
          selectedPath: null,
          status: "missing",
          candidates: [],
        },
        {
          program: "odd",
          managers: ["Npm"],
          selectedPath: null,
          status: "unknown",
          candidates: [
            { pathIndex: 0, path: "/odd", target: null, status: "executable", message: null },
          ],
        },
      ],
    };

    expect(buildCommandLocationTargets(environment)).toEqual([
      { id: "node:0", target: "/real/node" },
      { id: "node:1", target: "/real/node" },
    ]);
  });
});

describe("deriveCommandLocationAssociations", () => {
  const descriptors = [
    descriptor("nvm-src", "Nvm", "source", "/nvm/versions/node/v24", "Node versions"),
    descriptor(
      "npm-src",
      "Npm",
      "source",
      "/nvm/versions/node/v24/lib/node_modules",
      "Global modules",
    ),
    descriptor(
      "corepack",
      "Npm",
      "package",
      "/nvm/versions/node/v24/lib/node_modules/corepack",
      "corepack@0.34.6",
      { name: "corepack", version: "0.34.6" },
    ),
    descriptor("uv-src", "Uv", "source", "/uv/python", "Python installations"),
    descriptor("pip-interp", "Pip", "interpreter", "/uv/python/bin/python3", "解释器"),
    descriptor("brew-prefix", "Homebrew", "source", "/opt/homebrew", "Prefix"),
    descriptor("brew-cellar", "Homebrew", "source", "/opt/homebrew/Cellar", "Cellar"),
  ];

  it("selects visible groups and folds completely suppressed managers", () => {
    const result = {
      matches: [
        match("pnpm:0", "nvm-src", "/nvm/versions/node/v24", "npm-src"),
        match("pnpm:0", "npm-src", "/nvm/versions/node/v24/lib/node_modules"),
        match(
          "pnpm:0",
          "corepack",
          "/nvm/versions/node/v24/lib/node_modules/corepack",
        ),
        match("python3:0", "uv-src", "/uv/python"),
        match("python3:0", "pip-interp", "/uv/python/bin/python3"),
        match("brew:0", "brew-prefix", "/opt/homebrew"),
        match("brew:0", "brew-cellar", "/opt/homebrew/Cellar"),
      ],
      unreadableLocationIds: [],
    };

    const { byTarget } = deriveCommandLocationAssociations(
      ["pnpm:0", "python3:0", "brew:0", "missing:0"],
      descriptors,
      result,
    );

    const pnpm = byTarget.get("pnpm:0")!;
    expect(pnpm.state).toBe("associated");
    expect(pnpm.groups).toHaveLength(1);
    expect(pnpm.groups[0].managerId).toBe("Npm");
    expect(pnpm.groups[0].source?.id).toBe("npm-src");
    expect(pnpm.groups[0].packages.map((item) => item.id)).toEqual(["corepack"]);
    expect(pnpm.suppressed).toEqual([
      { managerId: "Nvm", location: descriptors[0] },
    ]);

    const python = byTarget.get("python3:0")!;
    expect(python.groups.map((item) => item.managerId)).toEqual(["Pip", "Uv"]);
    expect(python.groups.find((item) => item.managerId === "Pip")?.interpreters).toHaveLength(1);
    expect(python.groups.find((item) => item.managerId === "Uv")?.source?.id).toBe("uv-src");
    expect(python.suppressed).toEqual([]);

    const brew = byTarget.get("brew:0")!;
    expect(brew.groups).toHaveLength(1);
    expect(brew.groups[0].source?.id).toBe("brew-cellar");

    expect(byTarget.get("missing:0")?.state).toBe("notFound");
  });

  it("reports indeterminate when no location is usable", () => {
    const { byTarget, hasUsableLocations } = deriveCommandLocationAssociations(
      ["tool:0"],
      descriptors,
      {
        matches: [],
        unreadableLocationIds: descriptors.map((entry) => entry.id),
      },
    );
    expect(hasUsableLocations).toBe(false);
    expect(byTarget.get("tool:0")?.state).toBe("indeterminate");
  });

  it("sorts packages by specificity", () => {
    const packages = [
      descriptor("pkg-wide", "Npm", "package", "/root/pkg", "wide@1"),
      descriptor("pkg-deep", "Npm", "package", "/root/pkg/nested/deep", "deep@1"),
    ];
    const { byTarget } = deriveCommandLocationAssociations(
      ["tool:0"],
      packages,
      {
        matches: [
          match("tool:0", "pkg-wide", "/root/pkg"),
          match("tool:0", "pkg-deep", "/root/pkg/nested/deep"),
        ],
        unreadableLocationIds: [],
      },
    );
    expect(byTarget.get("tool:0")?.groups[0].packages.map((item) => item.id)).toEqual([
      "pkg-deep",
      "pkg-wide",
    ]);
  });
});

describe("buildCommandLocationSummary", () => {
  it("counts distinct visible managers and keeps null for no targets", () => {
    const associations = new Map<string, CandidateLocationAssociation>([
      ["a:0", { state: "associated", groups: [group("Npm")], suppressed: [] }],
      ["b:0", { state: "notFound", groups: [], suppressed: [] }],
    ]);
    expect(buildCommandLocationSummary(["a:0", "b:0"], associations)).toEqual({
      state: "associated",
      managerCount: 1,
    });
    expect(buildCommandLocationSummary([], associations)).toEqual({
      state: null,
      managerCount: 0,
    });
    expect(
      buildCommandLocationSummary(
        ["c:0"],
        new Map([
          ["c:0", { state: "indeterminate", groups: [], suppressed: [] }],
        ]),
      ),
    ).toEqual({ state: "indeterminate", managerCount: 0 });
  });
});

describe("buildCommandLocationScope", () => {
  it("describes observed, partial, unobserved, disabled, and invalidated managers", () => {
    const snapshots: Partial<Record<ManagerId, ManagerSnapshot>> = {
      Npm: managerFixture("Npm", { status: "Ready" }),
      Pip: managerFixture("Pip", { status: "Partial" }),
      Maven: managerFixture("Maven", { status: "Ready" }),
    };
    const scanStates: Partial<Record<ManagerId, ManagerScanState>> = {
      Npm: { phase: "idle", scannedAt: 10, error: null },
      Pip: { phase: "idle", scannedAt: 20, error: "partial read", lastReadFailed: false },
    };
    const records: Partial<Record<ObservationItemId, ObservationRecord>> = {
      "manager:npm": {
        itemId: "manager:npm",
        lastSuccess: {
          at: 9,
          scope: null,
          scopeLabel: null,
          completeness: "complete",
          note: null,
        },
        lastAttempt: null,
        invalidated: { at: 11, reason: "cleanup" },
      },
    };
    const descriptors = [
      descriptor("npm-src", "Npm", "source", "/npm"),
      descriptor("pip-src", "Pip", "source", "/site"),
      descriptor("pip-interp", "Pip", "interpreter", "/python"),
    ];

    const scope = buildCommandLocationScope(
      ["Npm", "Pip", "Maven", "Yarn"],
      snapshots,
      scanStates,
      records,
      descriptors,
      ["pip-interp"],
    );

    expect(scope.observedCount).toBe(3);
    expect(scope.disabled).toContain("Pnpm");
    const npm = scope.enabled.find((entry) => entry.managerId === "Npm");
    expect(npm?.invalidated).toBe(true);
    expect(npm?.notes).toContain("观察已失效");
    const pip = scope.enabled.find((entry) => entry.managerId === "Pip");
    expect(pip?.status).toBe("Partial");
    expect(pip?.notes).toContain("读取不完整");
    expect(pip?.notes).toContain("最近扫描有异常");
    expect(pip?.notes).toContain("1 个位置无法读取");
    const maven = scope.enabled.find((entry) => entry.managerId === "Maven");
    expect(maven?.notes).toContain("观察范围不含命令安装位置");
    const yarn = scope.enabled.find((entry) => entry.managerId === "Yarn");
    expect(yarn?.observed).toBe(false);
    expect(yarn?.notes).toEqual(["未扫描"]);
  });
});
