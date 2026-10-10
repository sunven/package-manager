// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectCleanupPage } from "./ProjectCleanupPage";
import { createProjectCleanupWorkflow } from "../projectCleanupWorkflow";
import { createInMemoryProjectCleanupEffects } from "../projectCleanupInMemoryEffects";
import { presetSettings } from "../test/fixtures";
import type { DirectoryMeasurement, ProjectDataCandidate } from "../types";

afterEach(cleanup);

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
  expect((screen.getByRole("button", { name: "扫描" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "保存深度" }));
  await waitFor(() => expect(workflow.read().settings.maxDepth).toBe(12));
  expect(updateDepth).toHaveBeenCalledWith("preset-1", 12);
  expect((screen.getByRole("button", { name: "扫描" }) as HTMLButtonElement).disabled).toBe(false);
});

it("filters candidate types by keyboard while retaining the selected candidates", async () => {
  const user = userEvent.setup();
  const measurement: DirectoryMeasurement = { status: "Ready", bytes: 1024, human: "1 KiB", files: 1, directories: 1, skipped: 0, latestModifiedMs: null, message: null };
  const candidates: ProjectDataCandidate[] = [
    { candidateId: "rust", kind: "RustTarget", projectPath: "/code/rust-app", directoryPath: "/code/rust-app/target", status: "Ready", message: null, measurement },
    { candidateId: "node", kind: "NodeModules", projectPath: "/code/node-app", directoryPath: "/code/node-app/node_modules", status: "Ready", message: null, measurement },
  ];
  const workflow = createProjectCleanupWorkflow(createInMemoryProjectCleanupEffects({
    readSettings: async () => presetSettings(),
    scan: async () => ({ rootId: "root-1", scanId: "scan-1", rootPath: "/code", maxDepth: 8, status: "Ready", candidates, skipped: 0, errors: [], cargoAvailable: true, cargoMessage: null }),
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
  const node = within(filters).getByRole("radio", { name: /Node node_modules/ });
  expect(rust.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("tab")).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: "选择 rust-app" }));

  rust.focus();
  await user.keyboard("{ArrowRight} ");
  expect(document.activeElement).toBe(node);
  expect(node.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("checkbox", { name: "选择 rust-app" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "选择 node-app" })).toBeTruthy();
  expect(workflow.read().totals.selectedCount).toBe(1);

  await user.keyboard(" ");
  expect(node.getAttribute("aria-checked")).toBe("true");
  await user.keyboard("{ArrowLeft}{Enter}");
  expect(rust.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("checkbox", { name: "选择 rust-app" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("checkbox", { name: "选择 node-app" })).toBeNull();
});
