// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CodexHooksPage } from "./CodexHooksPage";
import { useCodexExtensions } from "../hooks/useCodexExtensions";
import { codexHookDefinitionScanFixture } from "../test/codexHookFixtures";
import type { CodexHookScan, HookDefinitionPreview, HookDefinitionRequest } from "../codexHooks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

function Harness() {
  const workflow = useCodexExtensions(true, "hooks");
  return <CodexHooksPage workflow={workflow} onShowPlugins={vi.fn()} />;
}

function preview(request: HookDefinitionRequest): HookDefinitionPreview {
  return { planId: "plan-1", action: request.action, sourcePath: "/Users/example/.codex/" + (request.source === "json" ? "hooks.json" : "config.toml"),
    before: request.id ? { event: "Stop", handler: { type: "command", command: "echo before" } } : null,
    after: request.action === "delete" ? null : { event: request.event, matcher: request.matcher, handler: request.fields },
    enabled: request.action === "delete" ? null : request.enabled ?? true,
    impacts: request.id ? [{ event: "Stop", operation: "echo before", enabled: true, target: true },
      { event: "Stop", operation: "echo sibling", enabled: false, target: false }] : [],
  };
}

function mock(scan = codexHookDefinitionScanFixture()) {
  let count = 0;
  mockedInvoke.mockImplementation(async (method, args) => {
    if (method === "scan_codex_hooks") {
      const copy = structuredClone(scan); copy.definitions!.snapshotId = "definitions-" + ++count; return copy;
    }
    if (method === "prepare_codex_hook_definition") return preview((args as { request: HookDefinitionRequest }).request);
    if (method === "commit_codex_hook_definition") return { status: "Saved", message: "定义已保存，请在 Codex 审查。" };
    throw new Error("Unexpected method " + method);
  });
}

async function create() {
  fireEvent.click(await screen.findByRole("button", { name: "新增 Hook" }));
  fireEvent.change(screen.getByLabelText("保存位置"), { target: { value: "json" } });
  fireEvent.change(screen.getByLabelText("命令"), { target: { value: "echo new hook" } });
}

describe("Codex Hook definition editing", () => {
  it("shows user definitions and allows creation while the persistent feature is off", async () => {
    const scan = codexHookDefinitionScanFixture(); scan.featureEnabled = false; scan.hooks = [];
    mock(scan); render(<Harness />);
    expect(await screen.findByText("Hooks 总开关已关闭")).toBeTruthy();
    await create();
    expect((screen.getByRole("checkbox", { name: /保存为启用/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "检查变更" }));
    await screen.findByRole("heading", { name: "确认保存 Hook" });
    expect(mockedInvoke).toHaveBeenCalledWith("prepare_codex_hook_definition", { request: expect.objectContaining({ snapshotId: "definitions-1", source: "json", enabled: true, fields: expect.objectContaining({ command: "echo new hook" }) }) });
    expect(mockedInvoke.mock.calls.some(([m]) => m === "commit_codex_hook_definition")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "返回编辑" }));
    expect((screen.getByLabelText("命令") as HTMLTextAreaElement).value).toBe("echo new hook");
    fireEvent.click(screen.getByRole("button", { name: "检查变更" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockedInvoke).toHaveBeenCalledWith("commit_codex_hook_definition", { request: { planId: "plan-1" } });
  });

  it("requires a source choice when both formats exist and rejects invalid MCP input locally", async () => {
    mock(); render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "新增 Hook" }));
    expect((screen.getByLabelText("保存位置") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("保存位置"), { target: { value: "toml" } });
    fireEvent.change(screen.getByLabelText("处理类型"), { target: { value: "mcp_tool" } });
    fireEvent.change(screen.getByLabelText("MCP 服务"), { target: { value: "workspace" } });
    fireEvent.change(screen.getByLabelText("MCP 工具"), { target: { value: "load" } });
    fireEvent.change(screen.getByLabelText(/MCP input/), { target: { value: "[]" } });
    fireEvent.click(screen.getByRole("button", { name: "检查变更" }));
    expect(await screen.findByText("MCP input 必须是 JSON 对象。")).toBeTruthy();
    expect(mockedInvoke.mock.calls).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/MCP input/), { target: { value: '{"project":"${cwd}","options":{"concise":true}}' } });
    fireEvent.click(screen.getByRole("button", { name: "检查变更" }));
    await screen.findByRole("heading", { name: "确认保存 Hook" });
    expect(mockedInvoke).toHaveBeenCalledWith("prepare_codex_hook_definition", { request: expect.objectContaining({ fields: expect.objectContaining({ kind: "mcp_tool", input: { project: "${cwd}", options: { concise: true } } }) }) });
  });

  it("edits an untrusted MCP definition with its full input without granting trust", async () => {
    mock(); render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^编辑 SessionStart/ }));
    expect((screen.getByLabelText(/MCP input/) as HTMLTextAreaElement).value).toContain('"concise": true');
    expect((screen.getByLabelText("保存位置") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("MCP 工具"), { target: { value: "load_more" } });
    fireEvent.click(screen.getByRole("button", { name: "检查变更" }));
    await screen.findByRole("heading", { name: "确认保存 Hook" });
    expect(screen.queryByRole("button", { name: "信任" })).toBeNull();
    const prepared = mockedInvoke.mock.calls.find(([m]) => m === "prepare_codex_hook_definition")![1] as { request: HookDefinitionRequest };
    expect(prepared.request.enabled).toBeUndefined();
    expect(prepared.request.fields?.input).toEqual({ project: "${cwd}", options: { concise: true } });
  });

  it("previews affected disabled siblings and cancels deletion without a commit", async () => {
    mock(); render(<Harness />);
    const button = await screen.findByRole("button", { name: /^删除 Stop/ });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "检查删除影响" }));
    expect(await screen.findByText("Stop · 保持禁用，需重新审查")).toBeTruthy();
    expect(screen.getByText("echo sibling")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(mockedInvoke.mock.calls.some(([m]) => m === "commit_codex_hook_definition")).toBe(false);
  });

  it("keeps the form after partial saving and requires explicit reconciliation with a new snapshot", async () => {
    const scan = codexHookDefinitionScanFixture(); let reads = 0;
    mockedInvoke.mockImplementation(async (method, args) => {
      if (method === "scan_codex_hooks") { const copy = structuredClone(scan); copy.definitions!.snapshotId = "definitions-" + ++reads; return copy; }
      if (method === "prepare_codex_hook_definition") return preview((args as { request: HookDefinitionRequest }).request);
      return { status: "Partial", message: "定义已保存，但受影响条目仍被禁用，请核对。" };
    });
    render(<Harness />); await create();
    fireEvent.click(screen.getByRole("button", { name: "检查变更" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));
    await screen.findByText("请核对刷新后的定义");
    expect((screen.getByLabelText("命令") as HTMLTextAreaElement).value).toBe("echo new hook");
    expect((screen.getByRole("button", { name: "检查变更" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "已核对，使用当前定义重新检查" }));
    fireEvent.click(screen.getByRole("button", { name: "检查变更" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("prepare_codex_hook_definition", { request: expect.objectContaining({ snapshotId: "definitions-2" }) }));
    expect(mockedInvoke.mock.calls.filter(([m]) => m === "commit_codex_hook_definition")).toHaveLength(1);
  });

  it("revokes definition write eligibility after saving succeeds but refreshing fails", async () => {
    let reads = 0;
    mockedInvoke.mockImplementation(async (method, args) => {
      if (method === "scan_codex_hooks") { if (++reads > 1) throw new Error("offline"); return codexHookDefinitionScanFixture(); }
      if (method === "prepare_codex_hook_definition") return preview((args as { request: HookDefinitionRequest }).request);
      return { status: "Saved", message: "定义已保存" };
    });
    render(<Harness />); await create();
    fireEvent.click(screen.getByRole("button", { name: "检查变更" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("配置已保存，但清单刷新失败")).toBeTruthy();
    expect((screen.getByRole("button", { name: "新增 Hook" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^编辑 Stop/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the refreshed enablement after explicitly reconciling a failed edit", async () => {
    let reads = 0;
    mockedInvoke.mockImplementation(async (method, args) => {
      if (method === "scan_codex_hooks") {
        const scan = codexHookDefinitionScanFixture(); scan.definitions!.snapshotId = "definitions-" + ++reads;
        if (reads > 1) { scan.definitions!.entries[0].enabled = false; scan.hooks[0].enabled = false; }
        return scan;
      }
      if (method === "prepare_codex_hook_definition") return preview((args as { request: HookDefinitionRequest }).request);
      return { status: "Partial", message: "变更已暂停，请核对当前定义。" };
    });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^编辑 Stop/ }));
    fireEvent.change(screen.getByLabelText("命令"), { target: { value: "echo edited" } });
    fireEvent.click(screen.getByRole("button", { name: "检查变更" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));
    fireEvent.click(await screen.findByRole("button", { name: "已核对，使用当前定义重新检查" }));
    expect(screen.getByText("保留原启用选择：禁用。定义变更后需重新审查信任。")).toBeTruthy();
    expect((screen.getByLabelText("命令") as HTMLTextAreaElement).value).toBe("echo edited");
  });

  it("shows readable definitions without editing when the CLI is missing", async () => {
    const scan: CodexHookScan = codexHookDefinitionScanFixture(); scan.status = "MissingCli"; scan.hooks = [];
    scan.message = "未找到 Codex CLI"; scan.definitions!.snapshotId = null; scan.definitions!.readOnlyReason = "需要兼容 CLI 才能维护定义。";
    mock(scan); render(<Harness />);
    expect(await screen.findByText("定义维护当前只读")).toBeTruthy();
    expect((screen.getByRole("button", { name: "新增 Hook" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("/Users/example/scripts/notify.sh")).toBeTruthy();
    expect(within(screen.getByRole("table")).getAllByRole("button", { name: /^编辑/ }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });
});
