// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectCleanupPage } from "./ProjectCleanupPage";
import {
  createProjectCleanupWorkflow,
  type CleanupBatchSummary,
  type ProjectCleanupEffects,
  type ProjectCleanupView,
} from "../projectCleanupWorkflow";
import { createInMemoryProjectCleanupEffects } from "../projectCleanupInMemoryEffects";
import { projectObservationFacts } from "../observationFacts";
import {
  buildObservationCoverage,
  indexObservationCoverage,
  requireCoverageItem,
  type ObservationCoverageItem,
} from "../observationCoverage";
import { resetObservationLedgerForTests, type ObservationRecord } from "../observationLedger";
import { presetSettings } from "../test/fixtures";
import type {
  DirectoryMeasurement,
  ProjectCleanupBatchProgress,
  ProjectCleanupResult,
  ProjectDataCandidate,
  ProjectScanRecord,
} from "../types";

afterEach(() => {
  cleanup();
  resetObservationLedgerForTests();
});

function projectCoverageItem(view: ProjectCleanupView, record?: ObservationRecord): ObservationCoverageItem {
  const index = indexObservationCoverage(buildObservationCoverage({
    facts: { "project-scan": projectObservationFacts(view) },
    records: record ? { "project-scan": record } : {},
    scopes: {},
    enabledManagers: [],
  }));
  return requireCoverageItem(index, "project-scan");
}

function observationRecord(at: number): ObservationRecord {
  return {
    itemId: "project-scan",
    lastSuccess: {
      at,
      scope: "/code\n8",
      scopeLabel: "/code · 深度 8",
      completeness: "complete",
      note: null,
    },
    lastAttempt: { at, outcome: "succeeded", scope: "/code\n8", reason: null },
    invalidated: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function cleanupResult(candidateId: string, cleanedBytes: number): ProjectCleanupResult {
  return {
    candidateId,
    status: "Succeeded",
    command: null,
    beforeBytes: cleanedBytes,
    afterBytes: 0,
    cleanedBytes,
    measurement: { status: "Ready", bytes: 0, human: "0 B", files: 0, directories: 0, skipped: 0, latestModifiedMs: null, message: null },
    stdout: "",
    stderr: "",
    message: null,
    failure: null,
  };
}

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
    return <ProjectCleanupPage coverageItem={projectCoverageItem(view)} homeDirectory={null} view={view} workflow={workflow} />;
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
    return <ProjectCleanupPage coverageItem={projectCoverageItem(view)} homeDirectory={null} view={view} workflow={workflow} />;
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
    return <ProjectCleanupPage coverageItem={projectCoverageItem(view)} homeDirectory={null} view={view} workflow={workflow} />;
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
    return <ProjectCleanupPage coverageItem={projectCoverageItem(view)} homeDirectory={null} view={view} workflow={workflow} />;
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

it("keeps scan-history time and observation time independent", async () => {
  const current = scanRecord({ id: "current", finishedAt: 300 });
  const measurement: DirectoryMeasurement = { status: "Ready", bytes: 0, human: "0 B", files: 0, directories: 0, skipped: 0, latestModifiedMs: null, message: null };
  const workflow = createProjectCleanupWorkflow(createInMemoryProjectCleanupEffects({
    readSettings: async () => presetSettings({ maxDepth: 8 }),
    readScanHistory: async () => ({ histories: { "preset-1": { records: [current] } }, warning: null }),
    scan: async () => ({
      rootId: "root-1", scanId: "scan-1", rootPath: "/code", maxDepth: 8,
      status: "Ready", projects: { total: 0, rust: 0, node: 0, maven: 0 },
      candidates: [], skipped: 0, errors: [], cargoAvailable: true, cargoMessage: null, mavenAvailable: true, mavenMessage: null,
    }),
    measure: async () => measurement,
  }));
  await workflow.initialize();
  await workflow.startScan();
  function Page() {
    const view = useSyncExternalStore(workflow.subscribe, workflow.read);
    return <ProjectCleanupPage coverageItem={projectCoverageItem(view, observationRecord(500))} homeDirectory={null} view={view} workflow={workflow} />;
  }
  render(<Page />);

  expect(screen.getByText(/上次扫描/)).toBeTruthy();
  expect(screen.getByText(/观察于/)).toBeTruthy();
  expect(screen.getByText(/读取完整/)).toBeTruthy();
  expect(screen.queryByText(/观察时间未知/)).toBeNull();
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
    return <ProjectCleanupPage coverageItem={projectCoverageItem(view)} homeDirectory={null} view={view} workflow={workflow} />;
  }
  render(<Page />);

  expect(screen.getByText(/当前深度（8）尚未扫描/)).toBeTruthy();
  expect(screen.getByText(/该预设其他深度有 1 条记录/)).toBeTruthy();
  expect(screen.queryByText(/较基线/)).toBeNull();
});

it("renders cleanup batch progress and the final summary", async () => {
  const user = userEvent.setup();
  const measurement: DirectoryMeasurement = { status: "Ready", bytes: 1024, human: "1 KiB", files: 1, directories: 1, skipped: 0, latestModifiedMs: null, message: null };
  const candidates: ProjectDataCandidate[] = ["one", "two"].map((id) => ({
    candidateId: id,
    kind: "NodeModules" as const,
    projectPath: `/code/${id}`,
    directoryPath: `/code/${id}/node_modules`,
    status: "Ready" as const,
    message: null,
    measurement,
  }));
  const completion = deferred<CleanupBatchSummary>();
  let onProgress!: (progress: ProjectCleanupBatchProgress) => void;
  const runBatch = vi.fn((input: Parameters<ProjectCleanupEffects["runBatch"]>[0]) => {
    onProgress = input.onProgress;
    return completion.promise;
  });
  const workflow = createProjectCleanupWorkflow(createInMemoryProjectCleanupEffects({
    readSettings: async () => presetSettings(),
    scan: async () => ({
      rootId: "root-1",
      scanId: "scan-1",
      rootPath: "/code",
      maxDepth: 8,
      status: "Ready",
      projects: { total: 2, rust: 0, node: 2, maven: 0 },
      candidates,
      skipped: 0,
      errors: [],
      cargoAvailable: true,
      cargoMessage: null,
      mavenAvailable: true,
      mavenMessage: null,
    }),
    measure: async () => measurement,
    runBatch,
  }));
  await workflow.initialize();
  await workflow.startScan();
  workflow.setSelected(["one", "two"], true);
  workflow.prepareCleanupBatch(["one", "two"]);
  function Page() {
    const view = useSyncExternalStore(workflow.subscribe, workflow.read);
    return <ProjectCleanupPage coverageItem={projectCoverageItem(view)} homeDirectory={null} view={view} workflow={workflow} />;
  }
  render(<Page />);

  expect(screen.getByText("确认项目清理")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "清理选中项" }));
  await waitFor(() => expect(screen.getByText("正在清理项目目录")).toBeTruthy());

  onProgress({
    phase: "advanced",
    candidateId: "one",
    outcome: { kind: "result", result: cleanupResult("one", 1024) },
    completedCount: 1,
    cleanedBytes: 1024,
  });
  await waitFor(() => expect(screen.getByText(/正在处理第 2\/2 项/)).toBeTruthy());

  completion.resolve({
    finish: "completed",
    totalCount: 2,
    completedCount: 2,
    failedCount: 0,
    cleanedBytes: 1024,
    historyId: null,
    historyWarning: null,
  });
  await waitFor(() => expect(screen.getByText("项目清理结果")).toBeTruthy());
  expect(screen.getByText(/已处理 2\/2 项/)).toBeTruthy();
});
