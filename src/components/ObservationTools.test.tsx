// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "./GlobalSearch";
import { EnvironmentPanel } from "./ObservationTools";
import { managerFixture } from "../test/fixtures";
import type { ObservationToolsState } from "../hooks/useObservationTools";

afterEach(cleanup);

describe("global search interaction", () => {
  const pkg = { name: "tool", version: "1", source: "fixture", kind: "Generic" as const, path: "/tools/bin/tool", signals: [], actions: [] };
  it("opens with the shortcut, navigates with arrows and chooses the correct manager", async () => {
    const onLocate = vi.fn();
    render(<GlobalSearch managers={["Npm", "Pnpm"]} snapshots={{ Npm: managerFixture("Npm", { packages: [pkg] }), Pnpm: managerFixture("Pnpm", { packages: [pkg] }) }} scanStates={{}} homeDirectory={null} busy={false} onRefresh={vi.fn()} onLocate={onLocate} />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox");
    await userEvent.type(input, "tool");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ managerId: "Pnpm", kind: "package" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("restores focus on Escape and makes scanning an explicit action", async () => {
    const onRefresh = vi.fn();
    render(<GlobalSearch managers={["Npm", "Pnpm"]} snapshots={{ Npm: managerFixture() }} scanStates={{}} homeDirectory={null} busy={false} onRefresh={onRefresh} onLocate={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "跨管理器搜索" });
    await userEvent.click(trigger);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("1/2");
    await userEvent.click(screen.getByRole("button", { name: "扫描全部已启用管理器" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it("loads results in groups of fifty", async () => {
    render(<GlobalSearch managers={["Npm"]} snapshots={{ Npm: managerFixture("Npm", { packages: Array.from({ length: 55 }, (_, i) => ({ ...pkg, name: `pkg-${i}` })) }) }} scanStates={{}} homeDirectory={null} busy={false} onRefresh={vi.fn()} onLocate={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "跨管理器搜索" }));
    await userEvent.type(screen.getByRole("combobox"), "pkg");
    expect(screen.getAllByRole("option")).toHaveLength(50);
    await userEvent.click(screen.getByRole("button", { name: /继续加载/ }));
    expect(screen.getAllByRole("option")).toHaveLength(55);
  });
});

function state(): ObservationToolsState {
  return { environment: null, environmentBusy: false, environmentError: null, refreshEnvironment: vi.fn(), history: null, historyBusy: false, historyError: null, refreshHistory: vi.fn(), historyManager: "Npm", setHistoryManager: vi.fn() };
}

describe("observation panels", () => {
  it("shows PATH aliases, unreadable candidates and the manager navigation", async () => {
    const onCopy = vi.fn(), onOpenManager = vi.fn();
    const current = state();
    current.environment = { capturedAt: 1, pathEntries: [], commands: [{ program: "node", managers: ["Npm"], selectedPath: "/a/node", status: "aliases", candidates: [{ pathIndex: 0, path: "/a/node", target: "/real/node", status: "executable", message: null }, { pathIndex: 1, path: "/b/node", target: null, status: "unreadable", message: "permission denied" }] }] };
    render(<EnvironmentPanel state={current} onCopy={onCopy} onOpenManager={onOpenManager} />);
    expect(screen.getByText("多个路径指向同一文件")).toBeTruthy();
    await userEvent.click(screen.getByText("node"));
    expect(screen.getByText("permission denied")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "查看 npm" }));
    expect(onOpenManager).toHaveBeenCalledWith("Npm");
  });
});
