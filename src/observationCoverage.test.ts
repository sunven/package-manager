import { describe, expect, it } from "vitest";
import {
  buildObservationCoverage,
  formatObservationTime,
  indexObservationCoverage,
  relativeObservationTime,
  requireCoverageItem,
  type ObservationCoverageItem,
} from "./observationCoverage";
import { managerOrder } from "./constants";
import { managerObservationId, OBSERVATION_ITEMS, type ObservationItemId } from "./observationItems";
import type { ObservationFacts, ObservationFactsMap } from "./observationFacts";
import type { ObservationRecord } from "./observationLedger";
import type { ManagerId } from "./types";

const allManagers = managerOrder;

function fact(overrides: Partial<ObservationFacts> = {}): ObservationFacts {
  return { phase: "idle", success: null, failure: null, invalidated: null, currentScope: null, ...overrides };
}

function success(overrides: Partial<NonNullable<ObservationFacts["success"]>> = {}): NonNullable<ObservationFacts["success"]> {
  return { at: 10, scope: "scope", scopeLabel: "范围", completeness: "complete", note: null, ...overrides };
}

function record(itemId: ObservationItemId, overrides: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    itemId,
    lastSuccess: { at: 10, scope: "old", scopeLabel: "旧范围", completeness: "complete", note: null },
    lastAttempt: { at: 10, outcome: "succeeded", scope: "old", reason: null },
    invalidated: null,
    ...overrides,
  };
}

function build({
  facts = {},
  records = {},
  scopes = {},
  enabled = allManagers,
}: {
  facts?: ObservationFactsMap;
  records?: Partial<Record<ObservationItemId, ObservationRecord>>;
  scopes?: Parameters<typeof buildObservationCoverage>[0]["scopes"];
  enabled?: ManagerId[];
} = {}) {
  return buildObservationCoverage({ facts, records, scopes, enabledManagers: enabled });
}

function item(coverage: ReturnType<typeof build>, id: ObservationItemId): ObservationCoverageItem {
  const found = coverage.items.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("observation coverage model", () => {
  it("contains the 25-item catalog in fixed groups", () => {
    expect(OBSERVATION_ITEMS).toHaveLength(25);
    expect(new Set(OBSERVATION_ITEMS.map((entry) => entry.id)).size).toBe(25);
    const coverage = build();
    expect(coverage.items).toHaveLength(25);
    expect(coverage.groups.map((group) => group.id)).toEqual([
      "managers", "environment", "project", "vscode", "sessions", "codex", "claude",
    ]);
  });

  it("marks disabled managers without making them attention", () => {
    const coverage = build({ enabled: allManagers.filter((manager) => manager !== "Npm") });
    const disabled = item(coverage, "manager:npm");
    expect(disabled.status).toBe("disabled");
    expect(disabled.attention).toBe(false);
    expect(disabled.actions.refresh).toBe(false);
    expect(disabled.actions.adjustScope).toBe(true);
    expect(coverage.groups[0].enabledCount).toBe(11);
    expect(coverage.summary.disabled).toBe(1);
  });

  it("maps current successes, partial results and failures with last-success support", () => {
    const observed = build({ facts: { environment: fact({ success: success() }) } });
    expect(item(observed, "environment").status).toBe("observed");
    expect(item(observed, "environment").attention).toBe(false);

    const partial = build({ facts: { environment: fact({ success: success({ completeness: "partial", note: "部分命令" }) }) } });
    expect(item(partial, "environment").status).toBe("partial");
    expect(item(partial, "environment").attention).toBe(true);

    const failed = build({
      facts: { environment: fact({ failure: { outcome: "failed", reason: "读取失败" } }) },
      records: { environment: record("environment") },
    });
    const failedItem = item(failed, "environment");
    expect(failedItem.status).toBe("failed");
    expect(failedItem.lastSuccessAt).toBe(10);
    expect(failedItem.note).toBe("读取失败");
    expect(failedItem.attention).toBe(true);
  });

  it("uses last-observed only when there is no current result, and flags persisted partial reads", () => {
    const persisted = build({ records: { environment: record("environment") } });
    expect(item(persisted, "environment").status).toBe("lastObserved");
    expect(item(persisted, "environment").attention).toBe(false);

    const partial = build({
      records: {
        environment: record("environment", {
          lastSuccess: { at: 10, scope: "old", scopeLabel: "旧范围", completeness: "partial", note: "不完整" },
        }),
      },
    });
    expect(item(partial, "environment").status).toBe("lastObserved");
    expect(item(partial, "environment").completeness).toBe("partial");
    expect(item(partial, "environment").attention).toBe(true);
  });

  it("prioritizes invalidation, scope change, failures and current reads over last-observed", () => {
    const invalidated = build({
      records: { environment: record("environment", { invalidated: { at: 20, reason: "来源变化" } }) },
    });
    expect(item(invalidated, "environment").status).toBe("invalidated");
    expect(item(invalidated, "environment").note).toBe("来源变化");
    expect(item(invalidated, "environment").attention).toBe(true);

    const scopeChanged = build({
      records: { "project-scan": record("project-scan") },
      facts: { "project-scan": fact({ currentScope: { key: "new", label: "新范围" } }) },
    });
    expect(item(scopeChanged, "project-scan").status).toBe("scopeChanged");
    expect(item(scopeChanged, "project-scan").scopeChanged).toBe(true);
    expect(item(scopeChanged, "project-scan").lastSuccessScopeLabel).toBe("旧范围");
    expect(item(scopeChanged, "project-scan").currentScopeLabel).toBe("新范围");
    expect(item(scopeChanged, "project-scan").attention).toBe(true);

    const current = build({
      facts: { environment: fact({ success: success({ scope: "new", scopeLabel: "新范围" }) }) },
      records: { environment: record("environment") },
    });
    expect(item(current, "environment").status).toBe("observed");
    expect(item(current, "environment").scopeChanged).toBe(false);
  });

  it("shows a persisted failed attempt over last-observed while keeping the last success", () => {
    const coverage = build({
      records: {
        environment: record("environment", {
          lastAttempt: { at: 20, outcome: "failed", scope: "new", reason: "offline" },
        }),
      },
    });
    const environment = item(coverage, "environment");
    expect(environment.status).toBe("failed");
    expect(environment.lastSuccessAt).toBe(10);
    expect(environment.lastAttemptAt).toBe(20);
    expect(environment.note).toBe("offline");
  });

  it("treats a project scan without a current root as unobserved even with an old success", () => {
    const coverage = build({
      records: { "project-scan": record("project-scan") },
      facts: { "project-scan": fact() },
    });
    expect(item(coverage, "project-scan").status).toBe("notObserved");
    expect(item(coverage, "project-scan").note).toBe("未选择扫描根目录");
  });

  it("shows reading with the previous success and does not count it as attention", () => {
    const coverage = build({
      facts: { environment: fact({ phase: "reading", success: success({ at: 30 }) }) },
      records: { environment: record("environment") },
    });
    const reading = item(coverage, "environment");
    expect(reading.status).toBe("inProgress");
    expect(reading.lastSuccessAt).toBe(30);
    expect(reading.attention).toBe(false);
  });

  it("explains a project scan without a root and exposes scope adjustment", () => {
    const coverage = build({ facts: { "project-scan": fact() } });
    const project = item(coverage, "project-scan");
    expect(project.status).toBe("notObserved");
    expect(project.note).toBe("未选择扫描根目录");
    expect(project.actions.adjustScope).toBe(true);
    expect(project.actions.refresh).toBe(false);
  });

  it("counts observed, partial, unobserved and attention without percentages", () => {
    const empty = build();
    expect(empty.summary).toMatchObject({ observed: 0, notObserved: 25, attention: 25, disabled: 0 });
    const observed = build({ facts: { environment: fact({ success: success() }) } });
    expect(observed.summary).toMatchObject({ observed: 1, partial: 0, notObserved: 24, attention: 24 });
    const partial = build({ facts: { environment: fact({ success: success({ completeness: "partial" }) }) } });
    expect(partial.summary).toMatchObject({ observed: 1, partial: 1, attention: 25 - 1 + 1 });
  });

  it("exposes source actions and formats observation times", () => {
    const coverage = build();
    expect(item(coverage, "manager:npm").actions.adjustScope).toBe(true);
    expect(item(coverage, "manager:npm").actions.refresh).toBe(false);
    expect(item(coverage, "environment").actions.refresh).toBe(true);
    expect(item(coverage, "codex:skills").actions.refresh).toBe(true);

    const now = 10 * 24 * 60 * 60 * 1000;
    expect(relativeObservationTime(now - 30_000, now)).toBe("刚刚");
    expect(relativeObservationTime(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(relativeObservationTime(now - 2 * 60 * 60_000, now)).toBe("2 小时前");
    expect(relativeObservationTime(now - 25 * 60 * 60_000, now)).toBe("昨天");
    expect(formatObservationTime(now, now)).toContain("刚刚");
    expect(managerObservationId("Npm")).toBe("manager:npm");
  });

  it("indexes coverage and requires every observation item", () => {
    const coverage = build();
    const index = indexObservationCoverage(coverage);
    expect(index.size).toBe(25);
    expect(requireCoverageItem(index, "manager:npm")).toBe(item(coverage, "manager:npm"));
    expect(() => requireCoverageItem(index, "unknown" as ObservationItemId)).toThrow("unknown");
  });
});
