// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { EnvironmentPanel } from "./ObservationTools";
import { managerFixture } from "../test/fixtures";
import type { EnvironmentInspection } from "../environmentInspection";
import type { ObservationToolsState } from "../hooks/useObservationTools";
import type { ManagerScanState } from "../managerScanning";
import type { ObservationItemId } from "../observationItems";
import type { ObservationRecord } from "../observationLedger";
import type { ManagerId, ManagerSnapshot, PackageKind, PackageRow, PathKind } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const usage = {
  status: "Ready" as const,
  bytes: 0,
  human: "0 B",
  files: 0,
  directories: 0,
  skipped: 0,
  message: null,
};

function pathInfo(kind: PathKind, path: string, label: string = kind) {
  return { label, kind, path, size: usage };
}

function packageRow(
  name: string,
  version: string,
  path: string,
  kind: PackageKind = "Generic",
): PackageRow {
  return { name, version, path, source: "test", kind, signals: [], actions: [] };
}

function observationState(environment: EnvironmentInspection | null): ObservationToolsState {
  return {
    environment,
    environmentBusy: false,
    environmentError: null,
    refreshEnvironment: vi.fn(),
    history: null,
    historyBusy: false,
    historyError: null,
    refreshHistory: vi.fn(),
    historyManager: "Npm",
    setHistoryManager: vi.fn(),
  };
}

function environmentFor(program: string, target: string): EnvironmentInspection {
  return {
    capturedAt: 100,
    pathEntries: [],
    commands: [{
      program,
      managers: [],
      selectedPath: target,
      status: "single",
      candidates: [{ pathIndex: 0, path: target, target, status: "executable", message: null }],
    }],
  };
}

function scanned(): Partial<Record<ManagerId, ManagerScanState>> {
  return {
    Npm: { phase: "idle", scannedAt: 10, error: null },
    Nvm: { phase: "idle", scannedAt: 10, error: null },
    Pip: { phase: "idle", scannedAt: 10, error: null },
    Uv: { phase: "idle", scannedAt: 10, error: null },
    Maven: { phase: "idle", scannedAt: 10, error: null },
  };
}

it("renders visible groups, interpreter evidence, folded broader locations and scope notes", async () => {
  const onCopy = vi.fn();
  const onOpenManager = vi.fn();
  const pnpmTarget = "/nvm/versions/node/v24/lib/node_modules/corepack/dist/pnpm.js";
  const pythonTarget = "/uv/python/cpython-3.12/bin/python3";
  const environment: EnvironmentInspection = {
    capturedAt: 100,
    pathEntries: [],
    commands: [
      {
        program: "pnpm",
        managers: ["Pnpm"],
        selectedPath: pnpmTarget,
        status: "single",
        candidates: [{ pathIndex: 0, path: pnpmTarget, target: pnpmTarget, status: "executable", message: null }],
      },
      {
        program: "python3",
        managers: ["Pip", "Uv"],
        selectedPath: pythonTarget,
        status: "single",
        candidates: [{ pathIndex: 0, path: pythonTarget, target: pythonTarget, status: "executable", message: null }],
      },
    ],
  };
  const snapshots: Partial<Record<ManagerId, ManagerSnapshot>> = {
    Npm: managerFixture("Npm", {
      paths: [pathInfo("GlobalModules", "/nvm/versions/node/v24/lib/node_modules", "Global modules")],
      packages: [packageRow("corepack", "0.34.6", "/nvm/versions/node/v24/lib/node_modules/corepack")],
    }),
    Nvm: managerFixture("Nvm", {
      paths: [pathInfo("NvmNodeVersions", "/nvm/versions/node/v24", "Node versions")],
      packages: [packageRow("node", "24", "/nvm/versions/node/v24")],
    }),
    Pip: managerFixture("Pip", {
      paths: [pathInfo("SitePackages", "/uv/python/lib/site-packages")],
      pip: {
        pythonVersion: "3.12",
        pythonExecutable: "/uv/python/cpython-3.12/bin/python3",
        pipVersion: "26",
        environmentKind: "System",
        sitePackages: "/uv/python/lib/site-packages",
        userSite: null,
        installedCount: 0,
        outdatedCount: 0,
        editableCount: 0,
        directUrlCount: 0,
        cache: { dir: null, rawInfo: "" },
        inspectStatus: "Ready",
        outdatedStatus: "Ready",
        outdatedMessage: null,
      },
    }),
    Uv: managerFixture("Uv", {
      paths: [pathInfo("UvPythonInstallations", "/uv/python", "uv Python installations")],
      packages: [packageRow("cpython", "3.12", "/uv/python/cpython-3.12")],
    }),
  };
  const ledgerRecords: Partial<Record<ObservationItemId, ObservationRecord>> = {
    "manager:npm": {
      itemId: "manager:npm",
      lastSuccess: { at: 9, scope: null, scopeLabel: null, completeness: "complete", note: null },
      lastAttempt: null,
      invalidated: { at: 50, reason: "cleanup" },
    },
  };
  vi.mocked(invoke).mockResolvedValueOnce({
    matches: [
      {
        targetId: "pnpm:0",
        locationId: "Nvm:source:NvmNodeVersions:0",
        relation: "contained",
        canonicalLocation: "/nvm/versions/node/v24",
        suppressedBy: "Npm:source:GlobalModules:0",
      },
      {
        targetId: "pnpm:0",
        locationId: "Npm:source:GlobalModules:0",
        relation: "contained",
        canonicalLocation: "/nvm/versions/node/v24/lib/node_modules",
        suppressedBy: null,
      },
      {
        targetId: "pnpm:0",
        locationId: "Npm:package:0",
        relation: "contained",
        canonicalLocation: "/nvm/versions/node/v24/lib/node_modules/corepack",
        suppressedBy: null,
      },
      {
        targetId: "python3:0",
        locationId: "Uv:source:UvPythonInstallations:0",
        relation: "contained",
        canonicalLocation: "/uv/python",
        suppressedBy: null,
      },
      {
        targetId: "python3:0",
        locationId: "Uv:package:0",
        relation: "contained",
        canonicalLocation: "/uv/python/cpython-3.12",
        suppressedBy: null,
      },
      {
        targetId: "python3:0",
        locationId: "Pip:interpreter:0",
        relation: "equal",
        canonicalLocation: "/uv/python/cpython-3.12/bin/python3",
        suppressedBy: null,
      },
    ],
    unreadableLocationIds: [],
  });

  render(
    <EnvironmentPanel
      state={observationState(environment)}
      enabledManagers={["Npm", "Nvm", "Pip", "Uv"]}
      managerSnapshots={snapshots}
      scanStates={scanned()}
      ledgerRecords={ledgerRecords}
      onCopy={onCopy}
      onOpenManager={onOpenManager}
    />,
  );

  await waitFor(() => expect(screen.getByText("已关联 2 个管理器")).toBeTruthy());
  expect(screen.getByText("已关联 1 个管理器")).toBeTruthy();
  expect(screen.getByText("关联范围（4 个已观察管理器）")).toBeTruthy();
  expect(screen.getByText(/已停用，不参与关联：.*pnpm/)).toBeTruthy();

  await userEvent.click(screen.getByText("pnpm", { selector: "strong" }));
  const npmGroup = screen.getByRole("region", { name: "npm 已观察位置" });
  expect(within(npmGroup).getByText(/观察已失效/)).toBeTruthy();
  expect(within(npmGroup).getByText("corepack@0.34.6")).toBeTruthy();
  expect(within(npmGroup).getByText("全局模块")).toBeTruthy();
  expect(screen.getByText("其他更宽的包含位置（1）")).toBeTruthy();
  expect(screen.getByText(/Node 版本目录/)).toBeTruthy();
  await userEvent.click(within(npmGroup).getByRole("button", { name: "复制包路径" }));
  expect(onCopy).toHaveBeenCalledWith("/nvm/versions/node/v24/lib/node_modules/corepack");
  await userEvent.click(within(npmGroup).getByRole("button", { name: "查看 npm" }));
  expect(onOpenManager).toHaveBeenCalledWith("Npm");

  await userEvent.click(screen.getByText("python3", { selector: "strong" }));
  const pipGroup = screen.getByRole("region", { name: "pip 已观察位置" });
  const uvGroup = screen.getByRole("region", { name: "uv 已观察位置" });
  expect(within(pipGroup).getByText("Pip 观察使用的解释器")).toBeTruthy();
  expect(within(uvGroup).getByText("cpython@3.12")).toBeTruthy();
  expect(within(uvGroup).getByText("uv Python 目录")).toBeTruthy();
});

it("shows not found only when a usable location exists", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ matches: [], unreadableLocationIds: [] });
  const environment = environmentFor("node", "/usr/bin/node");
  const snapshots = {
    Npm: managerFixture("Npm", {
      paths: [pathInfo("GlobalModules", "/npm")],
    }),
  };

  render(
    <EnvironmentPanel
      state={observationState(environment)}
      enabledManagers={["Npm"]}
      managerSnapshots={snapshots}
      scanStates={scanned()}
      ledgerRecords={{}}
      onCopy={vi.fn()}
      onOpenManager={vi.fn()}
    />,
  );

  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(screen.getAllByText("当前已观察位置中未找到").length).toBeGreaterThan(0);
  expect(screen.queryByText("无法判断命令位置关联")).toBeNull();
});

it("shows the indeterminate alert when no location is usable", async () => {
  const environment = environmentFor("mvn", "/sdkman/mvn");
  render(
    <EnvironmentPanel
      state={observationState(environment)}
      enabledManagers={["Maven"]}
      managerSnapshots={{
        Maven: managerFixture("Maven", {
          paths: [pathInfo("LocalRepository", "/m2")],
        }),
      }}
      scanStates={scanned()}
      ledgerRecords={{}}
      onCopy={vi.fn()}
      onOpenManager={vi.fn()}
    />,
  );

  expect(screen.getByText("无法判断命令位置关联")).toBeTruthy();
  expect(screen.queryByText("当前已观察位置中未找到")).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("surfaces association failures without rendering not-found", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
  const environment = environmentFor("node", "/nvm/versions/node/v24/bin/node");
  render(
    <EnvironmentPanel
      state={observationState(environment)}
      enabledManagers={["Nvm"]}
      managerSnapshots={{
        Nvm: managerFixture("Nvm", {
          paths: [pathInfo("NvmNodeVersions", "/nvm/versions/node/v24")],
        }),
      }}
      scanStates={scanned()}
      ledgerRecords={{}}
      onCopy={vi.fn()}
      onOpenManager={vi.fn()}
    />,
  );

  await waitFor(() => expect(screen.getByText("命令位置关联计算失败")).toBeTruthy());
  expect(screen.getByText("boom")).toBeTruthy();
  expect(screen.queryByText("当前已观察位置中未找到")).toBeNull();
});
