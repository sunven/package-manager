import { describe, expect, it } from "vitest";
import {
  buildObservationCoverage,
  type ObservationCoverageItem,
} from "./observationCoverage";
import {
  managerObservationFacts,
  vscodeObservationFacts,
  type ObservationFactsMap,
} from "./observationFacts";
import { managerObservationId } from "./observationItems";
import {
  coverageStatusLabels,
  coverageStatusPresentation,
  observationBadgeSummary,
  observationCompletenessText,
  observationDetailText,
  observationTimeText,
} from "./observationPresentation";
import { managerFixture } from "./test/fixtures";
import { NOW, OBSERVED_AT, observationCoverageItem } from "./test/observationFixtures";

function item(overrides: Partial<ObservationCoverageItem> = {}): ObservationCoverageItem {
  return observationCoverageItem("vscode-storage", {
    lastSuccessAt: OBSERVED_AT,
    lastSuccessScopeLabel: "VS Code 工作区存储",
    lastAttemptAt: OBSERVED_AT,
    currentScopeLabel: "VS Code 工作区存储",
    ...overrides,
  });
}

describe("observation presentation", () => {
  it("publishes the shared coverage vocabulary", () => {
    expect(Object.keys(coverageStatusLabels)).toHaveLength(10);
    expect(coverageStatusLabels.observed).toBe("已观察");
    expect(coverageStatusLabels.lastObserved).toBe("上次观察");
    expect(coverageStatusLabels.notObserved).toBe("未观察");
  });

  it("maps coverage statuses to existing badge visual tokens", () => {
    expect(coverageStatusPresentation.observed).toEqual({ badgeVariant: "default", visualStatus: "Ready" });
    expect(coverageStatusPresentation.partial).toEqual({ badgeVariant: "secondary", visualStatus: "Partial" });
    expect(coverageStatusPresentation.failed).toEqual({ badgeVariant: "destructive", visualStatus: "Failed" });
    expect(coverageStatusPresentation.inProgress).toEqual({ badgeVariant: "secondary", visualStatus: "Scanning" });
    expect(coverageStatusPresentation.lastObserved).toEqual({ badgeVariant: "outline", visualStatus: "neutral" });
  });

  it("labels a current success, a last observation and a failed attempt differently", () => {
    expect(observationTimeText(item(), NOW)).toContain("观察于");
    expect(observationTimeText(item({ status: "lastObserved" }), NOW)).toContain("上次观察于");
    expect(observationTimeText(item({ status: "lastObserved" }), NOW)).toContain("本次会话尚未读取");
    expect(observationTimeText(item({ status: "failed" }), NOW)).toContain("上次成功于");

    const failedAttempt = observationTimeText(item({
      status: "failed",
      lastAttemptAt: NOW - 60_000,
      lastAttemptOutcome: "failed",
    }), NOW);
    expect(failedAttempt).toContain("最近尝试于");
    expect(failedAttempt).toContain("1 分钟前");
  });

  it("never invents a time for a current success without a timestamp", () => {
    expect(observationTimeText(item({ lastSuccessAt: null, lastAttemptAt: null }), NOW)).toBe("观察时间未知");
    expect(observationTimeText(item({ status: "notObserved", lastSuccessAt: null, lastAttemptAt: null }), NOW)).toBe("尚未读取");
    expect(observationTimeText(item({ status: "inProgress", lastSuccessAt: null, lastAttemptAt: null }), NOW)).toBe("首次读取中");
  });

  it("distinguishes last observed from not observed in time text", () => {
    const lastObserved = observationTimeText(item({ status: "lastObserved" }), NOW);
    const notObserved = observationTimeText(item({ status: "notObserved", lastSuccessAt: null }), NOW);
    expect(lastObserved).not.toBe(notObserved);
    expect(lastObserved).toContain("上次观察于");
    expect(notObserved).toBe("尚未读取");
  });

  it("reports completeness only for a current or last observation", () => {
    expect(observationCompletenessText(item())).toBe("读取完整");
    expect(observationCompletenessText(item({ completeness: "partial" }))).toBe("读取不完整");
    expect(observationCompletenessText(item({ status: "failed" }))).toBeNull();
    expect(observationCompletenessText(item({ status: "notObserved" }))).toBeNull();
    expect(observationCompletenessText(item({ completeness: "unknown" }))).toBeNull();
  });

  it("keeps domain notes while the status stays observed or unavailable", () => {
    const vscodeCoverage = buildObservationCoverage({
      facts: {
        "vscode-storage": vscodeObservationFacts({
          storagePath: "/storage",
          status: "Missing",
          workspaces: [],
          message: null,
        }, false, null),
      },
      records: {},
      scopes: {},
      enabledManagers: [],
    });
    const vscode = vscodeCoverage.items.find((entry) => entry.id === "vscode-storage")!;
    expect(vscode.status).toBe("observed");
    expect(vscode.note).toBe("未找到目录");

    const facts: ObservationFactsMap = {
      [managerObservationId("Npm")]: managerObservationFacts(
        managerFixture("Npm", { status: "Missing" }),
        { phase: "idle", scannedAt: null, error: null },
      ),
    };
    const managerCoverage = buildObservationCoverage({
      facts,
      records: {},
      scopes: {},
      enabledManagers: ["Npm"],
    });
    const npm = managerCoverage.items.find((entry) => entry.id === managerObservationId("Npm"))!;
    expect(npm.status).toBe("unavailable");
    expect(npm.note).toBe("CLI 缺失");

    const projectCoverage = buildObservationCoverage({
      facts: {
        "project-scan": {
          phase: "idle",
          success: null,
          failure: null,
          invalidated: null,
          currentScope: null,
        },
      },
      records: {},
      scopes: {},
      enabledManagers: [],
    });
    const project = projectCoverage.items.find((entry) => entry.id === "project-scan")!;
    expect(project.status).toBe("notObserved");
    expect(project.note).toBe("未选择扫描根目录");
  });

  it("shows scope change and invalidation reasons only when present", () => {
    const changed = observationDetailText(item({
      status: "scopeChanged",
      scopeChanged: true,
      lastSuccessScopeLabel: "旧范围",
      currentScopeLabel: "新范围",
      note: null,
    }));
    expect(changed).toContain("范围已变化：上次 旧范围；当前 新范围");

    const invalidated = observationDetailText(item({
      status: "invalidated",
      invalidatedAt: OBSERVED_AT,
      invalidatedReason: "插件已变化",
      note: null,
    }));
    expect(invalidated).toContain("失效于");
    expect(invalidated).toContain("插件已变化");

    const plain = observationDetailText(item({ note: null }));
    expect(plain).not.toContain("范围已变化");
    expect(plain).not.toContain("失效于");
  });

  it("builds a complete badge summary", () => {
    const summary = observationBadgeSummary(item(), NOW);
    expect(summary).toContain("VS Code 工作区存储");
    expect(summary).toContain("已观察");
    expect(summary).toContain("观察于");
    expect(summary).toContain("读取完整");
  });
});
