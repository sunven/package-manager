// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useCodexSkills } from "../hooks/useCodexSkills";
import { codexSkillsFixture } from "../test/codexSkillFixtures";
import { observationCoverageItem } from "../test/observationFixtures";
import type { SkillIntent, SkillOutcome, SkillPreview } from "../codexSkills";
import { CodexSkillsPage } from "./CodexSkillsPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
let scan = codexSkillsFixture();
let scanError: string | null;
let outcome: SkillOutcome;
let deferCommit: Promise<SkillOutcome> | undefined;
const navigate = vi.fn();
const calls = (command: string) => mockedInvoke.mock.calls.filter(([name]) => name === command);

function Harness({ dependency = "initial", active = true }: { dependency?: string; active?: boolean }) {
  const workflow = useCodexSkills(active, dependency);
  return <CodexSkillsPage coverageItem={observationCoverageItem("codex:skills")} workflow={workflow} onShowPlugins={navigate} />;
}
beforeEach(() => {
  vi.resetAllMocks(); scan = codexSkillsFixture(); scanError = null; deferCommit = undefined;
  outcome = { status: "Saved", message: "启用设置已保存，请在新会话中验证。" };
  mockedInvoke.mockImplementation(async (command, args) => {
    if (command === "scan_codex_skills") { if (scanError) throw new Error(scanError); return structuredClone(scan); }
    if (command === "read_codex_skill") return "---\nname: release-notes\n---\n<script>never execute</script>";
    if (command === "prepare_codex_skill") {
      const { request } = args as { request: SkillIntent };
      return { planId: "plan-1", operation: request.operation, name: "release-notes", path: request.path ?? scan.skills[0].path,
        sourceLabel: "已核对来源", revision: "abc123", enabled: request.operation !== "Disable", message: "只修改所选技能。" } satisfies SkillPreview;
    }
    if (command === "cancel_codex_skill") return;
    if (command === "commit_codex_skill") return deferCommit ?? outcome;
    if (command === "choose_codex_marketplace_directory") return "/Users/example/my-skill";
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(cleanup);
async function ready() {
  await waitFor(() => expect((screen.getByRole("button", { name: "安装技能" }) as HTMLButtonElement).disabled).toBe(false));
}
async function openConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: "禁用 release-notes" }));
  return screen.findByRole("alertdialog");
}

describe("Codex skills workflow", () => {
  it("reads once, filters sources/status, renders inert details, and scopes controls by ownership", async () => {
    render(<Harness />); await ready();
    expect(document.querySelector('[data-observation-item="codex:skills"]')).toBeTruthy();
    expect(calls("scan_codex_skills")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "卸载 research" })).toBeNull();
    expect(screen.queryByRole("button", { name: "禁用 writer:docs" })).toBeNull();
    expect(screen.getByText("插件技能只读")).toBeTruthy();
    expect(screen.getByText("内置技能只读")).toBeTruthy();
    expect(screen.queryByText("只读", { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "writer@team-tools" })); expect(navigate).toHaveBeenCalledWith("writer@team-tools");
    fireEvent.change(screen.getByLabelText("来源", { exact: true }), { target: { value: "managed" } });
    expect(screen.queryByRole("button", { name: /research.*查看技能说明/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /release-notes.*查看技能说明/ }));
    expect(await screen.findByText(/<script>never execute<\/script>/)).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索技能"), { target: { value: "does-not-exist" } });
    expect(screen.queryByRole("button", { name: "禁用 release-notes" })).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索技能"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("来源", { exact: true }), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("启用状态", { exact: true }), { target: { value: "false" } });
    expect(screen.getByRole("button", { name: "启用 research" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "禁用 release-notes" })).toBeNull();
  });

  it("cancels without writing and disables the dialog while executing", async () => {
    render(<Harness />); await ready();
    let dialog = await openConfirmation();
    expect(within(dialog).getByText(scan.skills[0].path)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(calls("commit_codex_skill")).toHaveLength(0); expect(calls("cancel_codex_skill")).toHaveLength(1);
    dialog = await openConfirmation();
    let resolve!: (value: SkillOutcome) => void;
    deferCommit = new Promise((done) => { resolve = done; });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认禁用" }));
    expect(calls("commit_codex_skill")).toHaveLength(1);
    expect((within(dialog).getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    resolve(outcome);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls("scan_codex_skills")).toHaveLength(2);
  });

  it("retains saved outcome and stale rows when post-operation refresh fails", async () => {
    render(<Harness />); await ready(); const dialog = await openConfirmation(); scanError = "重新读取超时";
    fireEvent.click(within(dialog).getByRole("button", { name: "确认禁用" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("启用设置已保存")).toBeTruthy();
    expect(screen.getByText("操作已完成，但清单刷新失败")).toBeTruthy();
    expect((screen.getByRole("button", { name: "禁用 release-notes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls("commit_codex_skill")).toHaveLength(1);
    scanError = null; fireEvent.click(screen.getByRole("button", { name: "刷新" })); await ready();
    expect(calls("commit_codex_skill")).toHaveLength(1);
  });

  it("captures GitHub version selection and independently copies a chosen local source", async () => {
    render(<Harness />); await ready(); fireEvent.click(screen.getByRole("button", { name: "安装技能" }));
    fireEvent.change(screen.getByLabelText("GitHub 仓库"), { target: { value: "example/skills" } });
    fireEvent.change(screen.getByLabelText("技能子目录"), { target: { value: "skills/release-notes" } });
    fireEvent.change(screen.getByLabelText("版本类型"), { target: { value: "tag" } });
    fireEvent.change(screen.getByLabelText("标签名称"), { target: { value: "v1" } });
    fireEvent.click(screen.getByRole("button", { name: "检查并预览" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(calls("prepare_codex_skill")[0][1]).toEqual({ request: { snapshotId: "skills-1", operation: "Install", source: { kind: "github", repo: "example/skills", subdirectory: "skills/release-notes", reference: "v1", referenceKind: "tag" } } });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.change(screen.getByLabelText("来源类型"), { target: { value: "local" } });
    fireEvent.click(screen.getByRole("button", { name: "选择技能目录" }));
    await waitFor(() => expect((screen.getByLabelText("技能目录") as HTMLInputElement).value).toBe("/Users/example/my-skill"));
    fireEvent.click(screen.getByRole("button", { name: "检查并预览" })); dialog = await screen.findByRole("alertdialog");
    expect(calls("prepare_codex_skill")[1][1]).toEqual({ request: { snapshotId: "skills-1", operation: "Install", source: { kind: "local", path: "/Users/example/my-skill" } } });
  });

  it("retains the last rows and marks them stale when Codex reports an unavailable CLI", async () => {
    render(<Harness />); await ready();
    scan = { ...scan, status: "MissingCli", snapshotId: null, message: "未找到 Codex CLI" };
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByText("需要 Codex CLI")).toBeTruthy());
    expect((screen.getByRole("button", { name: "禁用 release-notes" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
