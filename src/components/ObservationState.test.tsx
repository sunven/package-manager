// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObservationCoverageItem } from "../observationCoverage";
import { ObservationState } from "./ObservationState";

afterEach(cleanup);

function item(overrides: Partial<ObservationCoverageItem> = {}): ObservationCoverageItem {
  return {
    id: "vscode-storage",
    group: "vscode",
    label: "VS Code 工作区存储",
    status: "observed",
    completeness: "complete",
    note: null,
    lastSuccessAt: new Date("2026-10-24T10:00:00Z").getTime(),
    lastSuccessScopeLabel: "VS Code 工作区存储",
    lastAttemptAt: null,
    lastAttemptOutcome: "succeeded",
    lastAttemptReason: null,
    invalidatedAt: null,
    invalidatedReason: null,
    currentScopeLabel: "VS Code 工作区存储",
    scopeChanged: false,
    attention: false,
    actions: { view: true, refresh: true, adjustScope: false },
    ...overrides,
  };
}

describe("ObservationState", () => {
  it("renders the row form with label, badge, time and details", () => {
    const view = vi.fn();
    render(
      <ObservationState
        actions={{
          view: { onClick: view },
          refresh: { onClick: vi.fn() },
          adjustScope: { onClick: vi.fn(), variant: "ghost" },
        }}
        item={item({ status: "observed", completeness: "partial", actions: { view: true, refresh: true, adjustScope: true } })}
      />,
    );

    expect(screen.getByText("VS Code 工作区存储")).toBeTruthy();
    expect(screen.getByText("已观察")).toBeTruthy();
    expect(screen.getByText(/观察于/)).toBeTruthy();
    expect(screen.getByText(/读取不完整/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    expect(view).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "调整范围" })).toBeTruthy();
    expect(document.querySelector('[data-observation-item="vscode-storage"]')).toBeTruthy();
  });

  it("renders the strip form as a status region only when live is requested", () => {
    const { rerender } = render(<ObservationState item={item()} variant="strip" />);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<ObservationState item={item()} variant="strip" live />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-busy")).toBeNull();
    expect(status.getAttribute("data-observation-item")).toBe("vscode-storage");
    expect(status.querySelector('[data-observation-status="observed"]')).toBeTruthy();
    expect(status.querySelector('[data-status="Ready"]')).toBeTruthy();
    expect(screen.getByText(/读取完整/)).toBeTruthy();
  });

  it("renders a compact badge with an accessible summary", () => {
    render(<ObservationState item={item()} variant="badge" />);
    const badge = screen.getByText("已观察");
    expect(badge.getAttribute("title")).toContain("VS Code 工作区存储");
    expect(badge.getAttribute("title")).toContain("读取完整");
    expect(badge.getAttribute("data-observation-status")).toBe("observed");
    expect(badge.getAttribute("data-status")).toBe("Ready");
  });

  it("reserves the badge summary tooltip for the compact badge form", () => {
    const { rerender } = render(<ObservationState item={item()} />);
    expect(screen.getByText("已观察").hasAttribute("title")).toBe(false);

    rerender(<ObservationState item={item()} variant="strip" />);
    expect(screen.getByText("已观察").hasAttribute("title")).toBe(false);

    rerender(<ObservationState item={item()} variant="badge" />);
    expect(screen.getByText("已观察").getAttribute("title")).toContain("VS Code 工作区存储");
  });

  it("renders one primary action in strip form", () => {
    const refresh = vi.fn();
    render(
      <ObservationState
        actions={{ refresh: { onClick: refresh }, view: { onClick: vi.fn() } }}
        item={item()}
        primaryAction="refresh"
        variant="strip"
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
  });

  it("does not render actions that the coverage item or caller does not provide", () => {
    render(
      <ObservationState
        actions={{
          view: { onClick: vi.fn() },
          refresh: { onClick: vi.fn() },
          adjustScope: { onClick: vi.fn() },
        }}
        item={item({ actions: { view: false, refresh: true, adjustScope: false } })}
      />,
    );

    expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "调整范围" })).toBeNull();
  });

  it("keeps the caller's disabled state on refresh", () => {
    render(
      <ObservationState
        actions={{ refresh: { onClick: vi.fn(), disabled: true } }}
        item={item()}
      />,
    );

    expect((screen.getByRole("button", { name: "刷新" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides view for disabled observations", () => {
    render(
      <ObservationState
        actions={{
          view: { onClick: vi.fn() },
          refresh: { onClick: vi.fn() },
          adjustScope: { onClick: vi.fn() },
        }}
        item={item({
          status: "disabled",
          group: "managers",
          label: "npm",
          actions: { view: true, refresh: true, adjustScope: true },
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
  });

  it("uses the shared label and keeps the domain note for a missing directory", () => {
    const missing = item({ status: "observed", note: "未找到目录" });
    const { rerender } = render(<ObservationState item={missing} />);
    expect(screen.getByText(/未找到目录/)).toBeTruthy();

    rerender(<ObservationState item={missing} showNote={false} variant="strip" />);
    expect(screen.queryByText(/未找到目录/)).toBeNull();
  });

  it("does not add a page-wide busy flag", () => {
    render(<ObservationState item={item()} />);
    expect(document.querySelector("[aria-busy]")).toBeNull();
  });
});
