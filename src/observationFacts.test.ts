import { describe, expect, it } from "vitest";
import {
  claudeObservationFacts,
  codexObservationFacts,
  environmentObservationFacts,
  managerObservationFacts,
  openCodeObservationFacts,
  projectObservationFacts,
  sessionObservationFacts,
  vscodeObservationFacts,
  type NativeObservationView,
} from "./observationFacts";
import type { EnvironmentInspection } from "./environmentInspection";
import type { ProjectCleanupScanSessionView, ProjectCleanupView } from "./projectCleanupWorkflow";
import type { ManagerScanState } from "./managerScanning";
import type { OpenCodeSessionScan, SessionSourceScan } from "./sessionRecords";
import type { VscodeStorageScan } from "./vscodeStorage";
import { managerFixture } from "./test/fixtures";

const state = (overrides: Partial<ManagerScanState> = {}): ManagerScanState => ({
  phase: "idle",
  scannedAt: 10,
  error: null,
  ...overrides,
});

const inspection = (overrides: Partial<EnvironmentInspection> = {}): EnvironmentInspection => ({
  capturedAt: 10,
  scopeKey: "environment:key",
  pathEntries: [],
  commands: [],
  ...overrides,
});

function projectSession(overrides: Partial<ProjectCleanupScanSessionView> = {}): ProjectCleanupScanSessionView {
  return {
    rootId: "root",
    scanId: "scan",
    rootPath: "/dev",
    maxDepth: 8,
    status: "Ready",
    projects: { total: 0, rust: 0, node: 0, maven: 0 },
    candidates: [],
    skipped: 0,
    errors: [],
    cargoAvailable: true,
    cargoMessage: null,
    mavenAvailable: true,
    mavenMessage: null,
    ...overrides,
  };
}

function projectView(overrides: {
  phase?: ProjectCleanupView["scan"]["phase"];
  session?: ProjectCleanupScanSessionView | null;
  failure?: ProjectCleanupView["scan"]["failure"];
  rootId?: string | null;
  rootPath?: string | null;
  maxDepth?: number;
} = {}): ProjectCleanupView {
  const rootId = overrides.rootId === undefined ? "root" : overrides.rootId;
  const rootPath = overrides.rootPath === undefined ? "/dev" : overrides.rootPath;
  const maxDepth = overrides.maxDepth ?? 8;
  return {
    settings: {
      phase: "ready",
      rootId,
      rootPath,
      maxDepth,
      presets: [],
      activePresetId: null,
      rootMessage: null,
      failure: null,
    },
    scan: {
      phase: overrides.phase ?? "idle",
      session: overrides.session ?? null,
      pendingMeasurements: 0,
      failure: overrides.failure ?? null,
    },
    totals: { verifiedBytes: 0, reviewBytes: 0, reviewCount: 0, selectedCount: 0, selectedBytes: 0, cleanedBytes: 0 },
    batch: null,
    history: { phase: "ready", byPreset: {}, warning: null, recordWarning: null },
  };
}

const vscode = (overrides: Partial<VscodeStorageScan> = {}): VscodeStorageScan => ({
  storagePath: "/storage",
  status: "Ready",
  workspaces: [],
  message: null,
  ...overrides,
});

const sessionScan = (overrides: Partial<SessionSourceScan> = {}): SessionSourceScan => ({
  directory: "/sessions",
  status: "Ready",
  records: [],
  message: null,
  ageEligible: { days7: 0, days30: 0 },
  ...overrides,
});

const openCode = (overrides: Partial<OpenCodeSessionScan> = {}): OpenCodeSessionScan => ({
  status: "ready",
  records: [],
  message: null,
  activeSessionIds: [],
  activityMessage: null,
  ageEligible: { days7: 0, days30: 0 },
  ...overrides,
});

const native = (overrides: Partial<NativeObservationView> = {}): NativeObservationView => ({
  scan: { directory: "/codex", configPath: "/codex/config.toml", status: "Ready", warnings: [], message: null },
  current: true,
  scanning: false,
  error: null,
  ...overrides,
});

describe("observation facts", () => {
  it("maps manager success, partial, unsupported, missing and read failures", () => {
    expect(managerObservationFacts(managerFixture("Npm"), state()).success?.completeness).toBe("complete");
    const skipped = managerFixture("Npm", {
      paths: [{ kind: "Cache", label: "cache", path: "/cache", size: { status: "Ready", bytes: 1, human: "1 B", files: 1, directories: 0, skipped: 1, message: null } }],
    });
    expect(managerObservationFacts(skipped, state({ error: "cache：目录读取不完整" })).success?.completeness).toBe("partial");
    const unsupported = managerObservationFacts(managerFixture("Yarn", { status: "Unsupported" }), state());
    expect(unsupported.success?.completeness).toBe("complete");
    expect(unsupported.success?.note).toBe("清单不可用");
    expect(managerObservationFacts(managerFixture("Pip", { status: "Missing" }), state()).failure).toMatchObject({ outcome: "unavailable" });
    expect(managerObservationFacts(managerFixture("Npm"), state({ error: "offline", lastReadFailed: true })).failure).toMatchObject({ outcome: "failed" });
    const partial = managerObservationFacts(managerFixture("Npm"), state({ error: "path unreadable" }));
    expect(partial.success?.completeness).toBe("partial");
    expect(partial.success?.note).toContain("path unreadable");
  });

  it("maps environment completeness and scope", () => {
    const complete = environmentObservationFacts(inspection(), false, null);
    expect(complete.success).toMatchObject({ completeness: "complete", scope: "environment:key" });
    const partial = environmentObservationFacts(inspection({ pathEntries: [{ original: "/x", path: "/x", issue: "unreadable" }] }), false, null);
    expect(partial.success?.completeness).toBe("partial");
    expect(partial.success?.note).toBe("部分命令无法完整读取");
    expect(environmentObservationFacts(null, false, "offline").failure).toMatchObject({ outcome: "failed" });
  });

  it("maps project ready, stopped, failed and no-root scopes", () => {
    const ready = projectObservationFacts(projectView({ phase: "ready", session: projectSession() }));
    expect(ready.success).toMatchObject({ completeness: "complete", scope: "/dev\n8" });
    const stopped = projectObservationFacts(projectView({
      phase: "stopped",
      session: projectSession({ status: "Partial", errors: [{ path: "/dev/x", message: "no access" }] }),
    }));
    expect(stopped.success?.completeness).toBe("partial");
    expect(stopped.success?.note).toContain("扫描未完成");
    expect(projectObservationFacts(projectView({ phase: "failed", failure: { operation: "scan", message: "offline" } })).failure).toMatchObject({ reason: "offline" });
    expect(projectObservationFacts(projectView({ rootId: null, rootPath: null })).currentScope).toBeNull();
  });

  it("maps VS Code and session absence, partial reads and failures", () => {
    expect(vscodeObservationFacts(vscode(), false, null).success?.completeness).toBe("complete");
    const incomplete = vscode({
      status: "Partial",
      workspaces: [{
        id: "w", name: "w", projectPath: null, storagePath: "/w", kind: "Folder", projectStatus: "Unknown",
        removable: false, removalBlockReason: null, message: null, usage: { bytes: null, complete: false, message: null },
      }],
    });
    expect(vscodeObservationFacts(incomplete, false, null).success?.completeness).toBe("partial");
    expect(vscodeObservationFacts(vscode({ status: "Missing" }), false, null).success?.note).toBe("未找到目录");
    expect(vscodeObservationFacts(vscode(), false, "offline").failure).toMatchObject({ outcome: "failed" });

    expect(sessionObservationFacts("codex", sessionScan(), false, null).success?.completeness).toBe("complete");
    expect(sessionObservationFacts("codex", sessionScan({ status: "Missing" }), false, null).success?.note).toBe("未找到目录");
    expect(sessionObservationFacts("codex", sessionScan({ status: "Partial", message: "partial" }), false, null).success?.completeness).toBe("partial");
    expect(sessionObservationFacts("codex", sessionScan({ status: "Failed" }), false, null).failure).toMatchObject({ outcome: "failed" });
    expect(openCodeObservationFacts(openCode({ status: "unavailable" }), false, null).failure).toMatchObject({ outcome: "unavailable" });
    expect(openCodeObservationFacts(openCode({ status: "failed" }), false, null).failure).toMatchObject({ outcome: "failed" });
  });

  it("maps native inventories, warnings, missing CLIs and feature-off hooks", () => {
    const marketplaces = codexObservationFacts("marketplaces", native());
    expect(marketplaces.success).toMatchObject({
      completeness: "complete",
      scope: "codex:/codex\n/codex/config.toml",
    });
    const warnings = codexObservationFacts("plugins", native({
      scan: { directory: "/codex", configPath: "/codex/config.toml", status: "Ready", warnings: ["partial"], message: null },
    }));
    expect(warnings.success?.completeness).toBe("partial");
    const featureOff = codexObservationFacts("hooks", native({
      scan: { directory: "/codex", configPath: "/codex/config.toml", status: "Ready", warnings: [], message: null, featureEnabled: false },
    }));
    expect(featureOff.success?.note).toBe("总开关关闭，无法枚举");
    expect(codexObservationFacts("skills", native({
      current: false,
      error: "missing cli",
      scan: { directory: "/codex", status: "MissingCli", warnings: [], message: "missing cli" },
    })).failure).toMatchObject({ outcome: "unavailable" });
    expect(codexObservationFacts("marketplaces", native({
      current: false,
      error: null,
      scan: { directory: "/codex", configPath: "/codex/config.toml", status: "Ready", warnings: [], message: null },
    })).success).toBeNull();

    const claudeMessage = claudeObservationFacts("marketplaces", native({
      scan: { directory: "/claude", status: "Ready", warnings: [], message: "limited" },
    }));
    expect(claudeMessage.success?.completeness).toBe("partial");
    const claudeHooks = claudeObservationFacts("hooks", native({
      scan: { directory: "/claude", configPath: "/claude/settings.json", status: "Ready", messages: ["limited"] },
    }));
    expect(claudeHooks.success).toMatchObject({
      completeness: "partial",
      scope: "claude:/claude\n/claude/settings.json",
    });
  });
});
