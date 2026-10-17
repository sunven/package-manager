// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codexSkillsFixture } from "../test/codexSkillFixtures";
import { codexMarketplaceFixture } from "../test/codexMarketplaceFixtures";
import { codexPluginFixture } from "../test/codexPluginFixtures";
import { useCodexWorkflow } from "./useCodexWorkflow";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "scan_codex_marketplaces") return codexMarketplaceFixture();
    if (command === "scan_codex_plugins") return codexPluginFixture();
    if (command === "scan_codex_skills") return codexSkillsFixture();
    if (command === "change_codex_plugin") return { status: "Succeeded", message: "插件已重新安装" };
    if (command === "prepare_codex_skill") return { planId: "skill-plan", operation: "Disable", name: "release-notes", path: "/Users/example/.codex/skills/release-notes/SKILL.md", sourceLabel: null, revision: null, enabled: false, message: "已核对" };
    if (command === "cancel_codex_skill") return;
    throw new Error(`测试中未预期的命令：${command}`);
  });
});

afterEach(cleanup);

describe("Codex workflow coordination", () => {
  it("shares the tab lock between extension operations and skill confirmation", async () => {
    const workflow = renderHook(({ tab }) => useCodexWorkflow(true, tab), { initialProps: { tab: "marketplaces" } });
    await waitFor(() => expect(workflow.result.current.extensions.plugins.current).toBe(true));
    await waitFor(() => expect(workflow.result.current.extensions.marketplaces.current).toBe(true));

    await act(async () => {
      expect(await workflow.result.current.extensions.request({ kind: "plugin", pluginId: "writer@personal", operation: "Reinstall" })).toBeNull();
    });
    expect(workflow.result.current.locked).toBe(true);
    act(() => { workflow.result.current.extensions.cancel(workflow.result.current.extensions.operation!.id); });
    expect(workflow.result.current.locked).toBe(false);

    workflow.rerender({ tab: "skills" });
    await waitFor(() => expect(workflow.result.current.skills.current).toBe(true));
    await act(async () => {
      expect(await workflow.result.current.skills.request({ operation: "Disable", path: codexSkillsFixture().skills[0].path })).toBeNull();
    });
    expect(workflow.result.current.locked).toBe(true);
    act(() => workflow.result.current.skills.cancel());
    expect(workflow.result.current.locked).toBe(false);
  });
});
