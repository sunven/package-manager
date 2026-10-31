// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeHookFixture, claudeMarketplacesFixture, claudePluginFixture } from "../test/claudeCodeFixtures";
import { useClaudeWorkflow } from "./useClaudeWorkflow";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "scan_claude_marketplaces") return claudeMarketplacesFixture();
    if (command === "scan_claude_plugins") return claudePluginFixture();
    if (command === "scan_claude_hooks") return claudeHookFixture();
    if (command === "prepare_claude_hook") return { previewId: "preview-1", source: "/settings.json", before: null, after: {}, message: "预览完成" };
    if (command === "commit_claude_hook") return { status: "Succeeded", message: "定义已保存", executed: true };
    throw new Error(`测试中未预期的命令：${command}`);
  });
});

afterEach(cleanup);

describe("Claude workflow coordination", () => {
  it("holds the tab lock through hook confirmation and releases it on cancel or commit", async () => {
    const workflow = renderHook(() => useClaudeWorkflow(true, "hooks"));
    await waitFor(() => expect(workflow.result.current.state.hooks?.snapshotId).toBe("claude-hooks-1"));
    expect(workflow.result.current.locked).toBe(false);

    const request = { snapshotId: "claude-hooks-1", action: "Create" as const, draft: { event: "Stop", matcher: null, handler: { type: "command", command: "echo check" } } };
    let preview!: Awaited<ReturnType<typeof workflow.result.current.state.prepareHook>>;
    await act(async () => { preview = await workflow.result.current.state.prepareHook(request); });
    expect(workflow.result.current.locked).toBe(true);
    act(() => workflow.result.current.state.cancelHookPreview("another-preview"));
    expect(workflow.result.current.locked).toBe(true);
    act(() => workflow.result.current.state.cancelHookPreview(preview.previewId));
    expect(workflow.result.current.locked).toBe(false);

    await act(async () => { preview = await workflow.result.current.state.prepareHook(request); });
    expect(workflow.result.current.locked).toBe(true);
    await act(async () => { await workflow.result.current.state.commitHook(preview.previewId); });
    expect(workflow.result.current.locked).toBe(false);
  });

  it("releases a prepared hook lock when leaving the Claude view", async () => {
    const workflow = renderHook(({ active }) => useClaudeWorkflow(active, "hooks"), { initialProps: { active: true } });
    await waitFor(() => expect(workflow.result.current.state.hooks?.snapshotId).toBe("claude-hooks-1"));
    await act(async () => {
      await workflow.result.current.state.prepareHook({ snapshotId: "claude-hooks-1", action: "Create", draft: { event: "Stop", matcher: null, handler: { type: "command", command: "echo check" } } });
    });
    expect(workflow.result.current.locked).toBe(true);
    workflow.rerender({ active: false });
    await waitFor(() => expect(workflow.result.current.locked).toBe(false));
  });
});
