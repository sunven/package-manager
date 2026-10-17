// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ClaudeMarketplacesPage } from "./ClaudeMarketplacesPage";
import { ClaudeHooksPage } from "./ClaudeHooksPage";
import { ClaudeHookEditor } from "./ClaudeHookEditor";
import { useClaudeCode } from "../hooks/useClaudeCode";
import type { ClaudeWorkflowState } from "../hooks/useClaudeWorkflow";
import { claudeExtensionFixture, claudeHookFixture } from "../test/claudeCodeFixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());
const mockedInvoke = vi.mocked(invoke);
const success = { status: "Succeeded" as const, message: "已完成", executed: true };
function state(): ClaudeWorkflowState {
  return { revision: 0, invalidate: vi.fn(), extensions: claudeExtensionFixture(), hooks: claudeHookFixture(), busy: false, error: null, result: null,
    refresh: vi.fn().mockResolvedValue(claudeHookFixture()), change: vi.fn().mockResolvedValue(success),
    prepareHook: vi.fn().mockResolvedValue({ previewId: "preview-1", source: "/settings.json", before: {}, after: {}, message: "预览完成" }), commitHook: vi.fn().mockResolvedValue(success), cancelHookPreview: vi.fn() };
}

describe("Claude market and plugin interface", () => {
  it("opens the owning plugin and explains a missing plugin destination", async () => {
    const value = state();
    const view = render(<ClaudeMarketplacesPage state={value} focusedPluginId="reviewer@team-tools" onShowHooks={vi.fn()} />);
    const target = await screen.findByRole("button", { name: /reviewer收起详情/ });
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(screen.getByText("技能声明")).toBeTruthy();
    view.rerender(<ClaudeMarketplacesPage state={value} focusedPluginId="external@skills-dir" onShowHooks={vi.fn()} />);
    expect(screen.getByText(/当前市场清单未找到插件 external@skills-dir/)).toBeTruthy();
  });

  it("blocks cross-scope market removal and shows the reason", () => {
    render(<ClaudeMarketplacesPage state={state()} onShowHooks={vi.fn()} />);
    const row = screen.getByText("project-shared").closest("tr")!;
    expect((within(row).getByRole("button", { name: "移除" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(row).getByText(/存在项目或其他作用域/)).toBeTruthy();
  });

  it("previews cascading market removal and cancels without executing", async () => {
    const value = state(); render(<ClaudeMarketplacesPage state={value} onShowHooks={vi.fn()} />);
    const trigger = within(screen.getByText("team-tools").closest("tr")!).getByRole("button", { name: "移除" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("reviewer@team-tools")).toBeTruthy();
    expect(within(dialog).getByText(/选项、秘密和数据/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(value.change).not.toHaveBeenCalled();
  });

  it("filters plugins, keeps remote details incomplete and confirms the selected identity", async () => {
    const value = state(); render(<ClaudeMarketplacesPage state={value} onShowHooks={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /team-tools/ }));
    fireEvent.change(screen.getByLabelText("搜索此市场"), { target: { value: "笔记" } });
    fireEvent.click(screen.getByRole("button", { name: /notes查看详情/ }));
    expect(screen.getByText(/未下载本地内容/)).toBeTruthy();
    expect(mockedInvoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "安装 notes@team-tools" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认执行" }));
    await waitFor(() => expect(value.change).toHaveBeenCalledWith({ snapshotId: "claude-1", operation: "Install", target: "notes@team-tools" }));
  });

  it("retains an add form on native failure and submits ref and sparse through confirmation", async () => {
    const value = state(); vi.mocked(value.change).mockResolvedValue({ status: "Failed", message: "无权限", executed: true });
    render(<ClaudeMarketplacesPage state={value} onShowHooks={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "添加市场" }));
    fireEvent.change(screen.getByLabelText("市场来源"), { target: { value: "org/plugins" } });
    fireEvent.change(screen.getByLabelText("分支或标签（可选）"), { target: { value: "v2" } });
    fireEvent.change(screen.getByLabelText("稀疏检出目录（每行一个）"), { target: { value: ".claude-plugin\nplugins" } });
    fireEvent.click(screen.getByRole("button", { name: "预览添加" }));
    expect(value.change).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认执行" }));
    await waitFor(() => expect(value.change).toHaveBeenCalledWith({ snapshotId: "claude-1", operation: "AddMarket", source: "org/plugins", sourceKind: "git", refName: "v2", sparsePaths: [".claude-plugin", "plugins"] }));
    expect((screen.getByLabelText("市场来源") as HTMLInputElement).value).toBe("org/plugins");
  });
});

describe("Claude Hook interface", () => {
  it("does not present the first failed read as an empty Hook inventory", () => {
    const value = state(); value.hooks = null; value.error = "offline";
    render(<ClaudeHooksPage state={value} />);
    expect(screen.getByText("定义读取未完成，请使用「重新读取」重试。")).toBeTruthy();
    expect(screen.queryByText(/尚未发现用户或已安装插件/)).toBeNull();
    expect((screen.getByRole("button", { name: "新增 Hook" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([null, "invalid", ["invalid"]])("renders malformed handler %j as read-only with its original JSON", (handler) => {
    const value = state();
    value.hooks!.hooks = [{ ...value.hooks!.hooks[0], handler, readOnlyReason: "未知处理程序，仅供查看。" }];
    render(<ClaudeHooksPage state={value} />);
    expect(screen.getByText("未知处理程序")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^编辑 / }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /PreToolUse\s*未知/ }));
    expect(document.querySelector("pre")?.textContent).toBe(JSON.stringify(handler, null, 2));
  });

  it("accepts the native match-all wildcard", async () => {
    const value = state();
    render(<ClaudeHookEditor selection={{ action: "Create" }} scan={value.hooks!} state={value} onClose={vi.fn()} onRestoreFocus={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/匹配条件（可选）/), { target: { value: "*" } });
    fireEvent.change(screen.getByLabelText("命令或可执行文件"), { target: { value: "echo check" } });
    fireEvent.click(screen.getByRole("button", { name: "预览变更" }));
    await screen.findByText("预览完成");
    expect(vi.mocked(value.prepareHook).mock.calls[0][0].draft?.matcher).toBe("*");
  });

  it("releases the prepared workflow lock when returning to edit", async () => {
    const value = state();
    render(<ClaudeHookEditor selection={{ action: "Create" }} scan={value.hooks!} state={value} onClose={vi.fn()} onRestoreFocus={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("命令或可执行文件"), { target: { value: "echo check" } });
    fireEvent.click(screen.getByRole("button", { name: "预览变更" }));
    await screen.findByText("预览完成");
    fireEvent.click(screen.getByRole("button", { name: "返回编辑" }));
    expect(value.cancelHookPreview).toHaveBeenCalledWith("preview-1");
  });

  it("shows disabled plugin definitions and permits editing with the user switch off", () => {
    render(<ClaudeHooksPage state={state()} />);
    expect(screen.getByText(/用户配置已关闭 Hooks/)).toBeTruthy();
    expect(screen.getByText(/插件当前配置禁用/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "新增 Hook" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getAllByRole("button", { name: /^编辑 / })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^启用|^禁用/ })).toBeNull();
  });

  it.each([
    ["command", "命令或可执行文件", "echo check"], ["http", "HTTP URL", "https://example.invalid/hook"],
    ["prompt", "提示词", "Check input"], ["agent", "代理提示词", "Verify changes"],
  ])("prepares %s fields and only commits after preview", async (kind, label, text) => {
    const value = state(); const close = vi.fn();
    render(<ClaudeHookEditor selection={{ action: "Create" }} scan={value.hooks!} state={value} onClose={close} onRestoreFocus={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Hook 类型"), { target: { value: kind } });
    fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "预览变更" }));
    await screen.findByText("预览完成");
    expect(vi.mocked(value.prepareHook).mock.calls[0][0].draft?.handler.type).toBe(kind);
    expect(value.commitHook).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(value.commitHook).toHaveBeenCalledWith("preview-1"));
    expect(close).toHaveBeenCalled();
  });

  it("validates MCP JSON before preparing and preserves unknown fields on edit", async () => {
    const value = state();
    render(<ClaudeHookEditor selection={{ action: "Edit", hook: value.hooks!.hooks[0] }} scan={value.hooks!} state={value} onClose={vi.fn()} onRestoreFocus={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Hook 类型"), { target: { value: "mcp_tool" } });
    fireEvent.change(screen.getByLabelText("MCP server"), { target: { value: "server" } });
    fireEvent.change(screen.getByLabelText("MCP tool"), { target: { value: "tool" } });
    fireEvent.change(screen.getByLabelText("MCP input（JSON 对象，可选）"), { target: { value: "bad-json" } });
    fireEvent.click(screen.getByRole("button", { name: "预览变更" }));
    expect(await screen.findByText(/不是有效 JSON/)).toBeTruthy(); expect(value.prepareHook).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("MCP input（JSON 对象，可选）"), { target: { value: '{"file":"${tool_input.file_path}"}' } });
    fireEvent.click(screen.getByRole("button", { name: "预览变更" }));
    await screen.findByText("预览完成");
    expect(vi.mocked(value.prepareHook).mock.calls[0][0].draft?.handler).toEqual({ type: "mcp_tool", server: "server", tool: "tool", input: { file: "${tool_input.file_path}" }, timeout: 30, future: { keep: true } });
  });

  it("retains the draft after a conflict and requires a new preview", async () => {
    const value = state(); vi.mocked(value.commitHook).mockResolvedValue({ status: "Conflict", message: "配置已变化", executed: false });
    render(<ClaudeHookEditor selection={{ action: "Edit", hook: value.hooks!.hooks[0] }} scan={value.hooks!} state={value} onClose={vi.fn()} onRestoreFocus={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("命令或可执行文件"), { target: { value: "my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "预览变更" })); await screen.findByText("预览完成");
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
    await screen.findByText("配置已变化");
    expect((screen.getByLabelText("命令或可执行文件") as HTMLTextAreaElement).value).toBe("my draft");
    expect(screen.queryByRole("button", { name: "确认保存" })).toBeNull();
  });
});

describe("Claude refresh and mutation state", () => {
  it("retains the last inventory but disables writes when a later read fails", async () => {
    mockedInvoke.mockResolvedValueOnce(claudeExtensionFixture()).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useClaudeCode(true, "marketplaces"));
    await waitFor(() => expect(result.current.extensions?.snapshotId).toBe("claude-1"));
    await act(() => result.current.refresh());
    expect(result.current.extensions?.plugins).toHaveLength(2); expect(result.current.extensions?.snapshotId).toBeNull();
    expect(result.current.error).toContain("offline");
  });

  it("does not replay a successful operation after refresh failure and invalidates Hooks", async () => {
    mockedInvoke.mockResolvedValueOnce(claudeExtensionFixture()).mockResolvedValueOnce(success).mockRejectedValueOnce(new Error("refresh failed"));
    const { result } = renderHook(() => useClaudeCode(true, "marketplaces"));
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(() => result.current.change({ snapshotId: "claude-1", operation: "Enable", target: "reviewer@team-tools" }));
    expect(result.current.result?.status).toBe("Succeeded"); expect(result.current.error).toContain("refresh failed");
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "change_claude_extension")).toHaveLength(1);
    expect(result.current.extensions?.snapshotId).toBeNull();
  });
});
