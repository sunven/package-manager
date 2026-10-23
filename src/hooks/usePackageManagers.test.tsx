// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { usePackageManagers } from "./usePackageManagers";
import { managerFixture } from "../test/fixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/home/test" }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("package-manager.enabledManagers", JSON.stringify(["Npm", "Pip", "Homebrew"]));
  localStorage.setItem("package-manager.migratedFvm", "1");
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("manager scan lifecycle", () => {
  it("shows a qualification message when cleanup is requested before a manager scan", () => {
    const { result } = renderHook(usePackageManagers);

    act(() => result.current.actions.requestCacheCleanup());

    expect(result.current.uiMessage).toMatchObject({
      tone: "warn",
      title: "暂时无法准备清理",
      message: "尚未读取 npm 清单；请刷新后重试。",
    });
  });

  it("explains when a package disappears before an uninstall request", async () => {
    const packageRow = { name: "@scope/tool", version: "1", source: "global", kind: "Generic" as const, path: null, actions: [], signals: [] };
    let scans = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "scan_manager") {
        const packages = scans++ === 0 ? [packageRow] : [];
        return { manager: managerFixture("Npm", { packages }), scanDurationMs: 1 };
      }
      return { id: "snapshot-1" };
    });
    const { result } = renderHook(usePackageManagers);

    await act(async () => { await result.current.actions.refresh("Npm"); });
    await act(async () => { await result.current.actions.refresh("Npm"); });
    act(() => result.current.actions.requestPackageUninstall(0));

    expect(result.current.uiMessage).toMatchObject({
      tone: "warn",
      title: "暂时无法卸载全局包",
      message: "清单中的软件包已不存在；请刷新后重新选择。",
    });
  });

  it("retains pip supplement failure details and clears them on a targeted retry", async () => {
    const command = { program: "python3", args: ["-m", "pip", "list", "--outdated", "--format=json"], preview: "python3 -m pip list --outdated --format=json", timeoutMs: 30000 };
    const failure = { kind: "Timeout", message: "index timed out", command, stdout: "", stderr: "network unavailable" };
    const manager = managerFixture("Pip", { pip: {
      pythonVersion: "3", pythonExecutable: "python3", pipVersion: "24", environmentKind: "System", sitePackages: null, userSite: null,
      installedCount: 0, outdatedCount: 0, editableCount: 0, directUrlCount: 0, cache: { dir: null, rawInfo: "" }, inspectStatus: "Ready", outdatedStatus: "Pending", outdatedMessage: null,
    } });
    vi.mocked(invoke).mockResolvedValueOnce({ manager, scanDurationMs: 1 }).mockResolvedValueOnce({ status: "Failed", command, outdated: [], message: failure.message, failure });
    const { result } = renderHook(usePackageManagers);
    await act(async () => { await result.current.actions.refresh("Pip"); });
    expect(result.current.managerSnapshots.Pip?.pip?.outdatedFailure).toEqual(failure);
    act(() => result.current.actions.selectManager("Pip"));
    vi.mocked(invoke).mockResolvedValueOnce({ status: "Ready", command, outdated: [], message: null, failure: null });
    await act(async () => { await result.current.actions.retrySupplement("pip"); });
    expect(result.current.managerSnapshots.Pip?.pip?.outdatedFailure).toBeNull();
    expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toEqual(["scan_manager", "hydrate_pip_outdated", "save_manager_snapshot", "hydrate_pip_outdated"]);
  });
  it("blocks refresh and retries during maintenance confirmation, then allows scanning after cancellation", async () => {
    vi.mocked(invoke).mockResolvedValue({ manager: managerFixture(), scanDurationMs: 1 });
    const { result } = renderHook(usePackageManagers);
    await act(async () => { await result.current.actions.refresh(); });
    await act(async () => {
      result.current.actions.requestCacheCleanup();
      await result.current.actions.refresh();
      await result.current.actions.refreshEnabled();
      await result.current.actions.retrySupplement("paths");
    });
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name !== "save_manager_snapshot")).toHaveLength(1);
    await act(async () => {
      result.current.actions.cancelMaintenance();
      await result.current.actions.refresh();
    });
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name !== "save_manager_snapshot")).toHaveLength(2);
  });
  it("keeps previous data on both command failure and transport failure", async () => {
    const previous = managerFixture("Npm", { version: "old" });
    vi.mocked(invoke).mockResolvedValueOnce({ manager: previous, scanDurationMs: 1 });
    const { result } = renderHook(usePackageManagers);
    await act(async () => { await result.current.actions.refresh("Npm"); });
    vi.mocked(invoke).mockResolvedValueOnce({ manager: managerFixture("Npm", { status: "Failed" }), scanDurationMs: 1 });
    await act(async () => { await result.current.actions.refresh("Npm"); });
    expect(result.current.currentManager?.version).toBe("old");
    expect(result.current.scanStates.Npm?.error).toBeTruthy();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("bridge disconnected"));
    await act(async () => { await result.current.actions.refresh("Npm"); });
    expect(result.current.currentManager?.version).toBe("old");
    expect(result.current.scanStates.Npm?.error).toBe("bridge disconnected");
    expect(result.current.scanningManagers.size).toBe(0);
  });

  it("does not start a queued manager that the user disables", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(invoke).mockImplementation(async (_command, args) => {
      const id = (args as { manager: "Npm" | "Pip" | "Homebrew" }).manager;
      await gate;
      return { manager: managerFixture(id), scanDurationMs: 1 };
    });
    const { result } = renderHook(usePackageManagers);
    let all!: Promise<void>;
    await act(async () => { all = result.current.actions.refreshEnabled(); await Promise.resolve(); });
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name !== "save_manager_snapshot")).toHaveLength(2);
    act(() => result.current.actions.setManagerEnabled("Pip", false));
    await act(async () => { finish(); await all; });
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name !== "save_manager_snapshot")).toHaveLength(2);
    expect(result.current.scanningAll).toBe(false);
  });

  it("publishes the package list before a failed size measurement, and retries only that measurement", async () => {
    const manager = managerFixture("Npm", { paths: [{ label: "cache", kind: "Cache", path: "/cache", size: { status: "Pending", bytes: null, human: null, files: 0, directories: 0, skipped: 0, message: null } }] });
    vi.mocked(invoke).mockResolvedValueOnce({ manager, scanDurationMs: 1 }).mockRejectedValueOnce(new Error("permission denied"));
    const { result } = renderHook(usePackageManagers);
    await act(async () => { await result.current.actions.refresh(); });
    expect(result.current.currentManager).not.toBeNull();
    expect(result.current.currentManager?.paths[0].size.status).toBe("Error");
    vi.mocked(invoke).mockResolvedValueOnce({ status: "Ready", bytes: 42, human: "42 B", files: 1, directories: 0, skipped: 0, message: null });
    await act(async () => { await result.current.actions.retrySupplement("paths"); });
    expect(result.current.currentManager?.paths[0].size.bytes).toBe(42);
    expect(result.current.scanStates.Npm?.error).toBeNull();
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["scan_manager", "measure_path_size", "save_manager_snapshot", "measure_path_size"]);
  });
});


it("initializes once through StrictMode remount and keeps subscriptions and stale dialog callbacks safe", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  vi.mocked(invoke).mockResolvedValue({ manager: managerFixture(), scanDurationMs: 1 });
  const { result, unmount } = renderHook(usePackageManagers, { wrapper: StrictMode });
  expect(frames.size).toBe(1);
  await act(async () => {
    for (const callback of frames.values()) callback(0);
    frames.clear();
  });
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name !== "save_manager_snapshot")).toHaveLength(1);
  expect(result.current.currentManager?.id).toBe("Npm");
  act(() => result.current.actions.requestCacheCleanup());
  const oldActions = result.current.actions;
  act(() => result.current.actions.cancelMaintenance());
  act(() => result.current.actions.requestCacheCleanup());
  const newId = result.current.maintenance!.id;
  await act(async () => {
    await oldActions.confirmMaintenance();
    oldActions.cancelMaintenance();
  });
  expect(result.current.maintenance?.id).toBe(newId);
  expect(result.current.maintenance?.phase).toBe("confirming");
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name !== "save_manager_snapshot")).toHaveLength(1);
  unmount();
});

it("keeps the confirmed manager when selection changes and sends the existing native uninstall payload", async () => {
  vi.mocked(invoke).mockResolvedValue({ manager: managerFixture("Npm", { packages: [{ name: "@scope/tool", version: "1", source: "global", kind: "Generic", path: null, actions: [], signals: [] }] }), scanDurationMs: 1 });
  const { result } = renderHook(usePackageManagers);
  await act(async () => { await result.current.actions.refresh(); });
  act(() => result.current.actions.requestPackageUninstall(0));
  act(() => result.current.actions.selectManager("Pip"));
  vi.mocked(invoke).mockResolvedValueOnce({ status: "Ready", command: { preview: "npm uninstall -g @scope/tool" }, stdout: "", stderr: "", message: null, failure: null });
  await act(async () => { await result.current.actions.confirmMaintenance(); });
  expect(invoke).toHaveBeenCalledWith("run_npm_maintenance", { beforeSnapshotId: null, operation: { kind: "uninstallGlobalPackage", packageName: "@scope/tool" } });
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name !== "save_manager_snapshot")[2]).toEqual(["scan_manager", { manager: "Npm" }]);
  expect(result.current.selectedManager).toBe("Pip");
  expect(result.current.maintenance?.execution?.status).toBe("succeeded");
});
