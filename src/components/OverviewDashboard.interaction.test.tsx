// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverviewDashboard } from "./OverviewDashboard";
import { buildDevelopmentHealthSummary } from "../developmentHealth";
import { managerFixture } from "../test/fixtures";
import { buildObservationCoverage } from "../observationCoverage";
import { managerObservationFacts, type ObservationFactsMap } from "../observationFacts";
import { managerObservationId } from "../observationItems";
import type { ManagerId } from "../types";

afterEach(cleanup);

function coverageFixture(enabledManagers: ManagerId[], facts: ObservationFactsMap = {}) {
  return buildObservationCoverage({ records: {}, facts, scopes: {}, enabledManagers });
}

describe("overview entry points", () => {
  it("shows the coverage summary and keeps partial footprint as a lower bound", () => {
    const snapshots = {
      Pip: managerFixture("Pip", { status: "Missing" }),
      Npm: managerFixture("Npm", { paths: [{ kind: "Cache", label: "缓存", path: "/cache", size: { status: "Ready", bytes: 100, human: "100 B", files: 1, directories: 1, skipped: 1, message: "unreadable entry" } }] }),
    };
    const facts: ObservationFactsMap = {
      [managerObservationId("Pip")]: managerObservationFacts(snapshots.Pip, { phase: "idle", scannedAt: 1, error: "pip unavailable" }),
      [managerObservationId("Npm")]: managerObservationFacts(snapshots.Npm, { phase: "idle", scannedAt: 1, error: null }),
    };
    const openCoverage = vi.fn();
    render(
      <OverviewDashboard
        health={buildDevelopmentHealthSummary(["Pip", "Npm"], snapshots)}
        coverage={coverageFixture(["Pip", "Npm"], facts)}
        homeDirectory={null}
        scanningAll={false}
        maintenanceBusy={false}
        onRefreshAll={vi.fn()}
        onOpenManager={vi.fn()}
        onOpenView={vi.fn()}
        onOpenCoverage={openCoverage}
      />,
    );
    expect(screen.getByText("已测下限 ≥ 100 B")).toBeTruthy();
    expect(screen.getByText(/项需注意/)).toBeTruthy();
    expect(screen.queryByText("管理器状态")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看观察覆盖度" }));
    expect(openCoverage).toHaveBeenCalledOnce();
    expect(screen.queryByText("可回收总量")).toBeNull();
  });

  it("renders unscanned coverage and exposes navigation without maintenance execution", () => {
    const refresh = vi.fn();
    const view = vi.fn();
    const openCoverage = vi.fn();
    render(
      <OverviewDashboard
        health={buildDevelopmentHealthSummary(["Npm", "Pip"], {})}
        coverage={coverageFixture(["Npm", "Pip"])}
        homeDirectory={null}
        scanningAll={false}
        maintenanceBusy={false}
        onRefreshAll={refresh}
        onOpenManager={vi.fn()}
        onOpenView={view}
        onOpenCoverage={openCoverage}
      />,
    );
    expect(screen.getByRole("main", { name: "开发环境总览" })).toBeTruthy();
    expect(screen.getByText("0 / 2")).toBeTruthy();
    expect(screen.getByText("尚无目录占用测量，请扫描管理器后查看")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "扫描已启用管理器" }));
    expect(refresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "查看观察覆盖度" }));
    expect(openCoverage).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "会话记录" }));
    expect(view).toHaveBeenCalledWith("sessions");
    expect(screen.queryByRole("button", { name: "确认清理" })).toBeNull();
  });
});
