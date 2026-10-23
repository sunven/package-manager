// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectCleanupPage } from "./ProjectCleanupPage";
import { createProjectCleanupWorkflow } from "../projectCleanupWorkflow";
import { createInMemoryProjectCleanupEffects } from "../projectCleanupInMemoryEffects";
import { presetSettings } from "../test/fixtures";
import type { DirectoryMeasurement, ProjectDataCandidate, ProjectScanRecord } from "../types";

afterEach(cleanup);

function scanRecord(overrides: Partial<ProjectScanRecord> = {}): ProjectScanRecord {
  return {
    id: "record-1",
    presetId: "preset-1",
    scanId: "scan-1",
    rootPath: "/code",
    maxDepth: 8,
    finishedAt: 100,
    discovery: { complete: true, skipped: 0 },
    measurement: "finished",
    projects: { total: 3, rust: 1, node: 2, maven: 0 },
    candidates: { total: 2, rustTarget: 1, mavenTarget: 0, nodeModules: 1 },
    baseline: null,
    changes: null,
    ...overrides,
  };
}

it("lets a user edit a multi-digit depth before saving it for the next scan", async () => {
  const user = userEvent.setup();
  const updateDepth = vi.fn(async (_id: string, maxDepth: number) => presetSettings({ maxDepth }));
  const workflow = createProjectCleanupWorkflow(createInMemoryProjectCleanupEffects({ readSettings: async () => presetSettings(), updateDepth }));
  await workflow.initialize();
  function Page() {
    const view = useSyncExternalStore(workflow.subscribe, workflow.read);
    return <ProjectCleanupPage homeDirectory={null} view={view} workflow={workflow} />;
  }
  render(<Page />);
  const depth = screen.getByRole("spinbutton", { name: /深度/ });
  await user.clear(depth);
  await user.type(depth, "12");
  expect(updateDepth).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "扫描项目目录" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "保存深度" }));
  await waitFor(() => expect(workflow.read().settings.maxDepth).toBe(12));
  expect(updateDepth).toHaveBeenCalledWith("preset-1", 12);
  expect((screen.getByRole("button", { name: "扫描项目目录" }) as HTMLButtonElement).disabled).toBe(false);
});

it("filters candidate types by keyboard while retaining the selected candidates", async () => {
  const user = userEvent.setup();
  const measurement: DirectoryMeasurement = { status: "Ready", bytes: 1024, human: "1 KiB", files: 1, directories: 1, skipped: 0, latestModifiedMs: null, message: null };
  const candidates: ProjectDataCandidate[] = [
    { candidateId: "rust", kind: "RustTarget", projectPath: "/code/rust-app", directoryPath: "/code/rust-app/target", status: "Ready", message: null, measurement },
    { candidateId: "maven", kind: "MavenTarget", projectPath: "/code/maven-app", directoryPath: "/code/maven-app/target", status: "Ready", message: null, measurement },
    { candidateId: "node", kind: "NodeModules", projectPath: "/code/node-app", directoryPath: "/code/node-app/node_modules", status: "Ready", message: null, measurement },
  ];
  const workflow = createProjectCleanupWorkflow(createInMemoryProjectCleanupEffects({
    readSettings: async () => presetSettings(),
    scan: async () => ({ rootId: "root-1", scanId: "scan-1", rootPath: "/code", maxDepth: 8, status: "Ready", projects: { total: 0, rust: 0, node: 0, maven: 0 }, candidates, skipped: 0, errors: [], cargoAvailable: true, cargoMessage: null, mavenAvailable: true, mavenMessage: null }),
    measure: async () => measurement,
  }));
  await workflow.initialize();
  await workflow.startScan();
  function Page() {
    const view = useSyncExternalStore(workflow.subscribe, workflow.read);
    return <ProjectCleanupPage homeDirectory={null} view={view} workflow={workflow} />;
  }
  render(<Page />);
  const filters = screen.getByRole("radiogroup", { name: "候选类型" });
  const rust = within(filters).getByRole("radio", { name: /Rust target/ });
  const maven = within(filters).getByRole("radio", { name: /Maven target/ });
  const node = within(filters).getByRole("radio", { name: /Node node_modules/ });
  expect(rust.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("tab")).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: "选择 rust-app" }));

  rust.focus();
  await user.keyboard("{ArrowRight} ");
  expect(document.activeElement).toBe(maven);
  expect(maven.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("checkbox", { name: "选择 rust-app" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "选择 maven-app" })).toBeTruthy();
  expect(workflow.read().totals.selectedCount).toBe(1);

  await user.keyboard("{ArrowRight} ");
  expect(node.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("checkbox", { name: "选择 maven-app" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "选择 node-app" })).toBeTruthy();

  await user.keyboard("{ArrowLeft}{Enter}");
  expect(maven.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("checkbox", { name: "选择 maven-app" }).getAttribute("aria-checked")).toBe("false");
  await user.keyboard("{ArrowLeft}{Enter}");
  expect(rust.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("checkbox", { name: "选择 rust-app" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("checkbox", { name: "选择 node-app" })).toBeNull();
});

it("shows candidate qualification reasons beside disabled checkboxes", async () => {
  const measurement: DirectoryMeasurement = { status: "Ready", bytes: 1024, human: "1 KiB", files: 1, directories: 1, skipped: 0, latestModifiedMs: null, message: null };
  const workflow = createProjectCleanupWorkflow(createInMemoryProjectCleanupEffects({
    readSettings: async () => presetSettings(),
    scan: async () => ({
      rootId: "root-1", scanId: "scan-1", rootPath: "/code", maxDepth: 8,
      status: "Ready", projects: { total: 1, rust: 1, node: 0, maven: 0 },
      candidates: [{ candidateId: "rust-link", kind: "RustTarget", projectPath: "/code/rust-app", directoryPath: "/code/rust-app/target", status: "Symlink", message: "链接目标未经扫描", measurement }],
      skipped: 0, errors: [], cargoAvailable: true, cargoMessage: null, mavenAvailable: true, mavenMessage: null,
    }),
    measure: async () => measurement,
  }));
  await workflow.initialize();
  await workflow.startScan();
  function Page() {
    const view = useSyncExternalStore(workflow.subscribe, workflow.read);
    return <ProjectCleanupPage homeDirectory={null} view={view} workflow={workflow} />;
  }
  render(<Page />);

  const checkbox = screen.getByRole("checkbox", { name: "选择 rust-app" });
  expect((checkbox as HTMLButtonElement).disabled).toBe(true);
  expect(checkbox.getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.getByText(/目标是符号链接，未验证实际目录身份/)).toBeTruthy();
  expect(screen.getByText(/链接目标未经扫描/)).toBeTruthy();
});

it("shows the current-depth scan summary and opens all retained records", async () => {
  const user = userEvent.setup();
  const current = scanRecord({
    id: "current",
    finishedAt: 300,
    projects: { total: 4, rust: 1, node: 3, maven: 0 },
    candidates: { total: 3, rustTarget: 1, mavenTarget: 0, nodeModules: 2 },
    baseline: {
      finishedAt: 200,
      projects: { total: 3, rust: 1, node: 2, maven: 0 },
      candidates: { total: 2, rustTarget: 1, mavenTarget: 0, nodeModules: 1 },
    },
    changes: {
      added: [{ kind: "NodeModules", directoryPath: "/code/b/node_modules" }],
      removed: [{ kind: "RustTarget", directoryPath: "/code/a/target" }],
    },
  });
  const otherDepth = scanRecord({ id: "other-depth", finishedAt: 200, maxDepth: 6 });
  const workflow = createProjectCleanupWorkflow(createInMemoryProjectCleanupEffects({
    readSettings: async () => presetSettings({ maxDepth: 8 }),
    readScanHistory: async () => ({
      histories: { "preset-1": { records: [current, otherDepth] } },
      warning: null,
    }),
  }));
  await workflow.initialize();
  function Page() {
    const view = useSyncExternalStore(workflow.subscribe, workflow.read);
    return <ProjectCleanupPage homeDirectory={null} view={view} workflow={workflow} />;
  }
  render(<Page />);

  expect(screen.getByText(/较基线 \+1\/−1 候选/)).toBeTruthy();
  expect(screen.getByText(/项目 \+1/)).toBeTruthy();
  expect(screen.queryByText(/深度 6/)).toBeNull();

  await user.click(screen.getByRole("button", { name: "查看扫描记录" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("扫描记录")).toBeTruthy();
  expect(within(dialog).getByText("b/node_modules")).toBeTruthy();
  expect(within(dialog).getByText("a/target")).toBeTruthy();
  expect(within(dialog).getAllByText(/深度 6/).length).toBeGreaterThan(0);
});

it("does not present another depth as the current-depth scan", async () => {
  const workflow = createProjectCleanupWorkflow(createInMemoryProjectCleanupEffects({
    readSettings: async () => presetSettings({ maxDepth: 8 }),
    readScanHistory: async () => ({
      histories: { "preset-1": { records: [scanRecord({ maxDepth: 6 })] } },
      warning: null,
    }),
  }));
  await workflow.initialize();
  function Page() {
    const view = useSyncExternalStore(workflow.subscribe, workflow.read);
    return <ProjectCleanupPage homeDirectory={null} view={view} workflow={workflow} />;
  }
  render(<Page />);

  expect(screen.getByText(/当前深度（8）尚未扫描/)).toBeTruthy();
  expect(screen.getByText(/该预设其他深度有 1 条记录/)).toBeTruthy();
  expect(screen.queryByText(/较基线/)).toBeNull();
});
