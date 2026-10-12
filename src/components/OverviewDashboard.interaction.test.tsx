// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverviewDashboard } from "./OverviewDashboard";
import { buildDevelopmentHealthSummary } from "../developmentHealth";
import { managerFixture } from "../test/fixtures";
import { statusLabels } from "../constants";

afterEach(cleanup);

describe("overview entry points", () => {
  it("preserves missing-manager status and identifies partial footprint as a lower bound", () => {
    const snapshots = {
      Pip: managerFixture("Pip", { status: "Missing" }),
      Npm: managerFixture("Npm", { paths: [{ kind: "Cache", label: "缓存", path: "/cache", size: { status: "Ready", bytes: 100, human: "100 B", files: 1, directories: 1, skipped: 1, message: "unreadable entry" } }] }),
    };
    render(<OverviewDashboard health={buildDevelopmentHealthSummary(["Pip", "Npm"], snapshots)} homeDirectory={null} managerSnapshots={snapshots} scanStates={{ Pip: { phase: "idle", scannedAt: 1, error: "pip unavailable" } }} scanningAll={false} maintenanceBusy={false} onRefreshAll={vi.fn()} onOpenManager={vi.fn()} onOpenView={vi.fn()} />);
    expect(screen.getByText(statusLabels.Missing)).toBeTruthy();
    expect(screen.getByText("已测下限 ≥ 100 B")).toBeTruthy();
    expect(screen.queryByText("可回收总量")).toBeNull();
  });
  it("renders unscanned coverage and exposes navigation without maintenance execution", () => {
    const refresh = vi.fn();
    const manager = vi.fn();
    const view = vi.fn();
    render(<OverviewDashboard health={buildDevelopmentHealthSummary(["Npm", "Pip"], {})} homeDirectory={null} managerSnapshots={{}} scanStates={{}} scanningAll={false} maintenanceBusy={false} onRefreshAll={refresh} onOpenManager={manager} onOpenView={view} />);
    expect(screen.getByRole("main", { name: "开发环境总览" })).toBeTruthy();
    expect(screen.getByText("0 / 2")).toBeTruthy();
    expect(screen.getByText("尚无目录占用测量，请扫描管理器后查看")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "扫描已启用管理器" }));
    expect(refresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "查看 pip" }));
    expect(manager).toHaveBeenCalledWith("Pip");
    fireEvent.click(screen.getByRole("button", { name: "会话记录" }));
    expect(view).toHaveBeenCalledWith("sessions");
    expect(screen.queryByRole("button", { name: "确认清理" })).toBeNull();
  });
});
