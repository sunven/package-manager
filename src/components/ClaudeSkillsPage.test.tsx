// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useClaudeSkills } from "../hooks/useClaudeSkills";
import { claudeSkillsFixture } from "../test/claudeSkillFixtures";
import type { SkillIntent, SkillOutcome, SkillPreview } from "../claudeSkills";
import { ClaudeSkillsPage } from "./ClaudeSkillsPage";
import { App } from "../App";
import { claudeExtensionFixture, claudeHookFixture } from "../test/claudeCodeFixtures";
import { managerFixture } from "../test/fixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/Users/example" }));
const mockedInvoke = vi.mocked(invoke);
let scan = claudeSkillsFixture();
let scanError: string | null;
let outcome: SkillOutcome;
let deferCommit: Promise<SkillOutcome> | undefined;
const navigate = vi.fn(); const invalidate = vi.fn();
const calls = (command: string) => mockedInvoke.mock.calls.filter(([name]) => name === command);
function Harness({ dependency = "initial", active = true }: { dependency?: string; active?: boolean }) {
  const workflow = useClaudeSkills(active, dependency, false, invalidate);
  return <ClaudeSkillsPage workflow={workflow} onShowPlugins={navigate} />;
}
beforeEach(() => {
  vi.resetAllMocks(); scan = claudeSkillsFixture(); scanError = null; deferCommit = undefined;
  outcome = { status: "Saved", message: "用户调用设置已保存，请在新会话中核对。" };
  mockedInvoke.mockImplementation(async (command, args) => {
    if (command === "scan_claude_extensions") return claudeExtensionFixture();
    if (command === "scan_claude_hooks") return claudeHookFixture();
    if (command === "change_claude_extension") return { status: "Succeeded", message: "插件设置已保存", executed: true };
    if (command === "scan_manager") return { manager: managerFixture("Npm", { paths: [] }), scanDurationMs: 1, diagnostics: [] };
    if (command === "get_project_cleanup_settings") return { presets: [], activePresetId: null };
    if (command === "scan_claude_skills") { if (scanError) throw new Error(scanError); return structuredClone(scan); }
    if (command === "read_claude_skill") return "---\nname: release-notes\n---\n<script>never execute</script>";
    if (command === "prepare_claude_skill") {
      const { request } = args as { request: SkillIntent };
      return { planId: "plan-1", operation: request.operation, name: "release-notes", path: request.path ?? scan.skills[0].path,
        settingKey: "release", previousMode: "on", mode: request.mode ?? null, sourceLabel: "已核对来源", revision: "abc123", message: "按名称影响当前用户的默认选择。" } satisfies SkillPreview;
    }
    if (command === "cancel_claude_skill") return;
    if (command === "commit_claude_skill") return deferCommit ?? outcome;
    if (command === "choose_codex_marketplace_directory") return "/Users/example/my-skill";
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(cleanup);
async function ready() { await screen.findByLabelText("调用设置 release-notes"); }
async function confirmation() {
  fireEvent.change(screen.getByLabelText("调用设置 release-notes"), { target: { value: "off" } });
  return screen.findByRole("alertdialog");
}

describe("Claude Skills", () => {
  it("connects the App tabs, owning-plugin navigation and mutation invalidation", async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Claude Code" }));
    await waitFor(() => expect((screen.getByRole("tab", { name: "Skills" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("tab", { name: "Skills" })); await ready();
    expect(calls("scan_claude_skills")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "reviewer@team-tools" }));
    expect(await screen.findByRole("button", { name: /reviewer收起详情/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "启用 reviewer@team-tools" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认执行" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    await waitFor(() => expect(calls("scan_claude_skills")).toHaveLength(2));
    const dialog = await confirmation();
    await user.click(within(dialog).getByRole("button", { name: "确认调整调用设置" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect((screen.getByRole("tab", { name: "插件市场" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("tab", { name: "插件市场" }));
    await waitFor(() => expect(calls("scan_claude_extensions")).toHaveLength(3));
    expect(calls("commit_claude_skill")).toHaveLength(1);
  });

  it("shows definition sources, preserves disabled plugins, filters and reads inert details", async () => {
    render(<Harness />); await ready();
    expect(calls("scan_claude_skills")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "卸载 research" })).toBeNull();
    expect(screen.queryByLabelText("调用设置 reviewer:review")).toBeNull();
    expect(screen.getByText("所属插件已禁用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "reviewer@team-tools" })); expect(navigate).toHaveBeenCalledWith("reviewer@team-tools");
    fireEvent.change(screen.getByLabelText("来源", { exact: true }), { target: { value: "managed" } });
    expect(screen.queryByLabelText("调用设置 research")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /release-notes.*查看技能说明/ }));
    expect(await screen.findByText(/<script>never execute<\/script>/)).toBeTruthy(); expect(document.querySelector("script")).toBeNull();
    fireEvent.change(screen.getByLabelText("来源", { exact: true }), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("用户调用设置", { exact: true }), { target: { value: "off" } });
    expect(screen.getByLabelText("调用设置 research")).toBeTruthy(); expect(screen.queryByLabelText("调用设置 release-notes")).toBeNull();
  });

  it("previews actual setting key, cancels with focus restoration and commits once", async () => {
    render(<Harness />); await ready(); let dialog = await confirmation();
    expect(within(dialog).getByRole("heading", { name: "确认调整技能调用设置" })).toBeTruthy();
    expect(within(dialog).getByText("release")).toBeTruthy(); expect(within(dialog).getByText("关闭")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("调用设置 release-notes")));
    expect(calls("commit_claude_skill")).toHaveLength(0);
    dialog = await confirmation(); let resolve!: (value: SkillOutcome) => void;
    deferCommit = new Promise((done) => { resolve = done; });
    const confirm = within(dialog).getByRole("button", { name: "确认调整调用设置" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(calls("commit_claude_skill")).toHaveLength(1);
    expect((within(dialog).getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    resolve(outcome); await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(invalidate).toHaveBeenCalledTimes(1); expect(calls("scan_claude_skills")).toHaveLength(2);
  });

  it("retains completed outcome and marks stale rows after failed refresh without replay", async () => {
    render(<Harness />); await ready(); const dialog = await confirmation(); scanError = "读取超时";
    fireEvent.click(within(dialog).getByRole("button", { name: "确认调整调用设置" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("操作已完成，但清单刷新失败")).toBeTruthy();
    expect((screen.getByLabelText("调用设置 release-notes") as HTMLSelectElement).disabled).toBe(true);
    expect(calls("commit_claude_skill")).toHaveLength(1);
    scanError = null; fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect((screen.getByLabelText("调用设置 release-notes") as HTMLSelectElement).disabled).toBe(false));
    expect(calls("commit_claude_skill")).toHaveLength(1);
  });

  it("keeps definitions readable when CLI is unavailable", async () => {
    scan.writeBlocked = "未找到 Claude CLI"; scan.installBlocked = scan.writeBlocked; scan.warnings = [scan.writeBlocked];
    scan.skills.forEach((skill) => { skill.settingBlocked = scan.writeBlocked; skill.updateBlocked = scan.writeBlocked; skill.uninstallBlocked = scan.writeBlocked; });
    render(<Harness />); await ready();
    expect((screen.getByRole("button", { name: "安装技能" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /release-notes.*查看技能说明/ }));
    expect(await screen.findByText(/never execute/)).toBeTruthy(); expect(calls("prepare_claude_skill")).toHaveLength(0);
  });

  it("separates unknown user settings from an absent user override", async () => {
    scan.skills[0].mode = null; scan.skills[0].modeUnknown = true;
    scan.skills[0].settingBlocked = "该名称的用户调用设置未知，仅供查看。";
    render(<Harness />); await ready();
    const select = screen.getByLabelText("调用设置 release-notes") as HTMLSelectElement;
    expect(select.value).toBe("unknown"); expect(select.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("用户调用设置", { exact: true }), { target: { value: "inherit" } });
    expect(screen.queryByLabelText("调用设置 release-notes")).toBeNull();
    expect(screen.getByLabelText("调用设置 front:build")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("用户调用设置", { exact: true }), { target: { value: "unknown" } });
    expect(screen.getByLabelText("调用设置 release-notes")).toBeTruthy();
    expect(screen.queryByLabelText("调用设置 front:build")).toBeNull();
  });

  it("captures GitHub tag or local-copy source without writing before confirmation", async () => {
    render(<Harness />); await ready(); fireEvent.click(screen.getByRole("button", { name: "安装技能" }));
    fireEvent.change(screen.getByLabelText("GitHub 仓库"), { target: { value: "example/skills" } });
    fireEvent.change(screen.getByLabelText("技能子目录"), { target: { value: "skills/release" } });
    fireEvent.change(screen.getByLabelText("版本类型"), { target: { value: "tag" } });
    fireEvent.change(screen.getByLabelText("标签名称"), { target: { value: "v1" } });
    fireEvent.click(screen.getByRole("button", { name: "检查并预览" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(calls("prepare_claude_skill")[0][1]).toEqual({ request: { snapshotId: scan.snapshotId, operation: "Install", source: { kind: "github", repo: "example/skills", subdirectory: "skills/release", reference: "v1", referenceKind: "tag" } } });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.change(screen.getByLabelText("来源类型"), { target: { value: "local" } });
    fireEvent.click(screen.getByRole("button", { name: "选择技能目录" }));
    await waitFor(() => expect((screen.getByLabelText("技能目录") as HTMLInputElement).value).toBe("/Users/example/my-skill"));
    fireEvent.click(screen.getByRole("button", { name: "检查并预览" })); dialog = await screen.findByRole("alertdialog");
    expect(calls("commit_claude_skill")).toHaveLength(0); expect(within(dialog).getByText("保留的用户调用设置")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "安装技能" })));
  });

  it("invalidates a pending preview after another Claude operation", async () => {
    const view = render(<Harness />); await ready(); await confirmation();
    view.rerender(<Harness dependency="changed" active={false} />);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls("cancel_claude_skill")).toHaveLength(1); expect(calls("commit_claude_skill")).toHaveLength(0);
    view.rerender(<Harness dependency="changed" />);
    await waitFor(() => expect(calls("scan_claude_skills")).toHaveLength(2));
  });
});
