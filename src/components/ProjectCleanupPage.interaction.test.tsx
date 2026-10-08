// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectCleanupPage } from "./ProjectCleanupPage";
import { createProjectCleanupWorkflow } from "../projectCleanupWorkflow";
import { createInMemoryProjectCleanupEffects } from "../projectCleanupInMemoryEffects";
import { presetSettings } from "../test/fixtures";

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
