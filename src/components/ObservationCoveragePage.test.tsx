// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObservationCoveragePage } from "./ObservationCoveragePage";
import { buildObservationCoverage } from "../observationCoverage";
import { managerObservationFacts, type ObservationFactsMap } from "../observationFacts";
import { managerObservationId } from "../observationItems";
import { managerFixture } from "../test/fixtures";
import type { ObservationRecord } from "../observationLedger";

afterEach(cleanup);

function coverageFixture() {
  const facts: ObservationFactsMap = {
    [managerObservationId("Npm")]: managerObservationFacts(managerFixture("Npm"), { phase: "idle", scannedAt: 10, error: null }),
    "project-scan": { phase: "idle", success: null, failure: null, invalidated: null, currentScope: null },
    "vscode-storage": {
      phase: "idle",
      success: { at: null, scope: "vscode:/storage", scopeLabel: "VS Code 工作区存储", completeness: "partial", note: "部分工作区无法完整读取" },
      failure: null,
      invalidated: null,
      currentScope: { key: "vscode:/storage", label: "VS Code 工作区存储" },
    },
    "codex:hooks": {
      phase: "idle",
      success: { at: null, scope: "codex:/codex\n/codex/config.toml", scopeLabel: "Codex home + 配置", completeness: "complete", note: "总开关关闭，无法枚举" },
      failure: null,
      invalidated: null,
      currentScope: { key: "codex:/codex\n/codex/config.toml", label: "Codex home + 配置" },
    },
  };
  const records: Partial<Record<ReturnType<typeof managerObservationId> | "environment", ObservationRecord>> = {
    environment: {
      itemId: "environment",
      lastSuccess: { at: 10, scope: "environment:key", scopeLabel: "应用 PATH 与已启用管理器", completeness: "complete", note: null },
      lastAttempt: { at: 10, outcome: "succeeded", scope: "environment:key", reason: null },
      invalidated: null,
    },
  };
  return buildObservationCoverage({
    facts,
    records,
    scopes: { environment: { key: "environment:key", label: "应用 PATH 与已启用管理器" } },
    enabledManagers: ["Npm"],
  });
}

function row(id: string) {
  const element = document.querySelector(`[data-observation-item="${id}"]`);
  if (!element) throw new Error(`missing row ${id}`);
  return within(element as HTMLElement);
}

describe("observation coverage page", () => {
  it("renders groups, disabled managers, persisted-only rows and source actions", () => {
    const view = vi.fn();
    const refresh = vi.fn();
    const adjust = vi.fn();
    const refreshManagers = vi.fn();
    render(
      <ObservationCoveragePage
        coverage={coverageFixture()}
        warnings={["观察台账未保存"]}
        busy={false}
        onView={view}
        onRefresh={refresh}
        onRefreshManagers={refreshManagers}
        onAdjustScope={adjust}
      />,
    );

    expect(screen.getByRole("main", { name: "观察覆盖度" })).toBeTruthy();
    expect(screen.getByText("观察台账提示")).toBeTruthy();
    expect(screen.getByText("观察台账未保存")).toBeTruthy();

    const npm = row("manager:npm");
    expect(npm.getByText("已观察")).toBeTruthy();
    fireEvent.click(npm.getByRole("button", { name: "查看" }));
    fireEvent.click(npm.getByRole("button", { name: "设置" }));
    expect(view).toHaveBeenCalledWith(expect.objectContaining({ id: "manager:npm" }));
    expect(adjust).toHaveBeenCalledWith(expect.objectContaining({ id: "manager:npm" }));

    const disabled = row("manager:pnpm");
    expect(disabled.getByText("已停用")).toBeTruthy();
    expect(disabled.queryByRole("button", { name: "查看" })).toBeNull();
    expect(disabled.getByRole("button", { name: "设置" })).toBeTruthy();

    const environment = row("environment");
    expect(environment.getByText("上次观察")).toBeTruthy();
    expect(environment.getByText(/本次会话尚未读取/)).toBeTruthy();
    fireEvent.click(environment.getByRole("button", { name: "刷新" }));
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ id: "environment" }));

    const project = row("project-scan");
    expect(project.getByText("未观察")).toBeTruthy();
    expect(project.getByText(/未选择扫描根目录/)).toBeTruthy();
    fireEvent.click(project.getByRole("button", { name: "调整范围" }));
    expect(adjust).toHaveBeenCalledWith(expect.objectContaining({ id: "project-scan" }));

    expect(screen.queryByText("Codex 市场")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开Codex" }));
    expect(screen.getByText("Codex 市场")).toBeTruthy();
    expect(row("codex:hooks").getByText(/总开关关闭/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "扫描已启用管理器" }));
    expect(refreshManagers).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "刷新全部" })).toBeNull();
  });
});
