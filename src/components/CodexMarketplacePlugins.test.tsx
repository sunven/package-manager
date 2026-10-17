// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { App } from "../App";
import { codexMarketplaceFixture } from "../test/codexMarketplaceFixtures";
import { codexPluginFixture } from "../test/codexPluginFixtures";
import { codexHookScanFixture } from "../test/codexHookFixtures";
import { codexSkillsFixture } from "../test/codexSkillFixtures";
import { managerFixture } from "../test/fixtures";
import type { CodexMarketplaceRequest, CodexMarketplaceResult } from "../codexMarketplaces";
import type { CodexPluginChangeRequest } from "../codexPlugins";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/Users/example" }));
const mockedInvoke = vi.mocked(invoke);
let markets = codexMarketplaceFixture();
let plugins = codexPluginFixture();
let marketError: string | null;
let pluginError: string | null;
let outcome: CodexMarketplaceResult;

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  markets = codexMarketplaceFixture();
  plugins = codexPluginFixture();
  plugins.plugins = plugins.plugins.map((plugin) => {
    const marketplaceName = plugin.marketplaceName === "personal" ? "team-tools" : "managed-tools";
    return { ...plugin, marketplaceName, pluginId: `${plugin.name}@${marketplaceName}` };
  });
  plugins.plugins.push({ ...plugins.plugins[0], name: "orphan", pluginId: "orphan@gone-tools", marketplaceName: "gone-tools" });
  marketError = pluginError = null;
  outcome = { status: "Succeeded", message: "市场操作已执行", executed: true };
  mockedInvoke.mockImplementation(async (command, args) => {
    if (command === "scan_codex_marketplaces") {
      if (marketError) throw new Error(marketError);
      return structuredClone(markets);
    }
    if (command === "scan_codex_plugins") {
      if (pluginError) throw new Error(pluginError);
      return structuredClone(plugins);
    }
    if (command === "scan_codex_skills") return codexSkillsFixture();
    if (command === "scan_codex_hooks") return codexHookScanFixture();
    if (command === "change_codex_marketplace") {
      const { request } = args as { request: CodexMarketplaceRequest };
      if (request.operation === "Remove") markets.marketplaces = markets.marketplaces.filter((market) => market.id !== request.marketplaceId);
      return outcome;
    }
    if (command === "set_codex_plugin_enabled") {
      const { request } = args as { request: CodexPluginChangeRequest };
      plugins.plugins.find((plugin) => plugin.pluginId === request.pluginId)!.defaultEnabled = request.enabled;
      return { status: "Saved", message: "配置已保存，请在新会话中验证。" };
    }
    if (command === "scan_manager") return { manager: managerFixture("Npm", { paths: [] }), scanDurationMs: 1, diagnostics: [] };
    if (command === "get_project_cleanup_settings") return { presets: [], activePresetId: null };
    throw new Error(`Unexpected test command: ${command}`);
  });
});
afterEach(cleanup);

const reads = (command: string) => mockedInvoke.mock.calls.filter(([name]) => name === command).length;

async function openPage() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Codex" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "重新读取" }) as HTMLButtonElement).disabled).toBe(false));
}

function expand(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `查看 ${name} 的插件与详情` }));
  return screen.getByRole("region", { name: `${name} 的插件` });
}

describe("installed plugins organized by marketplace", () => {
  it("opens the merged tab, reads both inventories once, and scopes same-named plugins to their markets", async () => {
    await openPage();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["插件市场", "Hooks", "Skills"]);
    expect(screen.getByRole("tab", { name: "插件市场" }).getAttribute("aria-selected")).toBe("true");
    expect(reads("scan_codex_marketplaces")).toBe(1);
    expect(reads("scan_codex_plugins")).toBe(1);
    expect(screen.queryByRole("button", { name: "禁用 writer（team-tools）" })).toBeNull();
    const team = expand("team-tools");
    expect(within(team).getByRole("button", { name: "禁用 writer（team-tools）" })).toBeTruthy();
    expect(within(team).queryByRole("button", { name: "启用 writer（managed-tools）" })).toBeNull();
    const managed = expand("managed-tools");
    fireEvent.click(within(managed).getByRole("button", { name: "启用 writer（managed-tools）" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("set_codex_plugin_enabled", {
      request: { snapshotId: "scan-1", pluginId: "writer@managed-tools", enabled: true },
    }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("button", { name: "禁用 writer（managed-tools）" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "移除市场 managed-tools" })).toBeNull();
  });

  it("opens the owning plugin from a skill and refreshes skills after plugin maintenance", async () => {
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    await user.click(await screen.findByRole("button", { name: "writer@team-tools" }));
    expect(screen.getByRole("tab", { name: "插件市场" }).getAttribute("aria-selected")).toBe("true");
    const team = screen.getByRole("region", { name: "team-tools 的插件" });
    expect(within(team).getByRole("button", { name: /writer.*收起插件详情/ })).toBeTruthy();
    await user.click(within(team).getByRole("button", { name: "禁用 writer（team-tools）" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    await waitFor(() => expect(reads("scan_codex_skills")).toBe(2));
  });

  it("keeps empty markets and unmatched plugin groups without inventing source actions", async () => {
    await openPage();
    expect(within(expand("local-tools")).getByText("该市场暂无插件目录项或已安装插件。")).toBeTruthy();
    const orphan = expand("gone-tools");
    expect(within(orphan).getByRole("button", { name: "禁用 orphan（gone-tools）" })).toBeTruthy();
    expect(screen.getByText("未出现在市场清单中")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "移除市场 gone-tools" })).toBeNull();
    expect(screen.queryByRole("button", { name: "同步市场 gone-tools" })).toBeNull();
  });

  it("keeps plugin management available when the market inventory fails", async () => {
    marketError = "市场读取超时";
    await openPage();
    expect(screen.getByText("市场清单读取失败")).toBeTruthy();
    expect(screen.queryByText("未出现在市场清单中")).toBeNull();
    expect(screen.getAllByText("市场信息未能核实").length).toBeGreaterThan(0);
    const team = expand("team-tools");
    expect((within(team).getByRole("button", { name: "禁用 writer（team-tools）" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "添加市场源" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps market management available when plugins fail and does not report zero installed plugins", async () => {
    pluginError = "插件读取超时";
    await openPage();
    expect(screen.getByText("插件清单读取失败")).toBeTruthy();
    expect((screen.getByRole("button", { name: "移除市场 team-tools" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(expand("team-tools")).getByText(/插件清单暂不可用/)).toBeTruthy();
    expect(screen.queryByText("该市场暂无插件目录项或已安装插件。")).toBeNull();
  });

  it.each(["Succeeded", "Partial", "Failed"] as const)("regroups after an executed %s removal without leaving the page", async (status) => {
    await openPage();
    expand("team-tools");
    outcome = { status, message: "已执行移除，请核对清单", executed: true };
    fireEvent.click(screen.getByRole("button", { name: "移除市场 team-tools" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(reads("scan_codex_plugins")).toBe(2));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(reads("scan_codex_marketplaces")).toBe(2);
    expect(screen.queryByRole("button", { name: "移除市场 team-tools" })).toBeNull();
    expect(screen.getAllByText("未出现在市场清单中")).toHaveLength(2);
    expect((screen.getByRole("button", { name: "禁用 writer（team-tools）" }) as HTMLButtonElement).disabled).toBe(false);
    expect(reads("set_codex_plugin_enabled")).toBe(0);
  });

  it("keeps failed rereads marked stale and does not grant source errors control over plugin writes", async () => {
    await openPage();
    expand("team-tools");
    marketError = "市场重读失败";
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "重新读取" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/市场来源为上次结果，已过期/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "禁用 writer（team-tools）" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "移除市场 team-tools" }) as HTMLButtonElement).disabled).toBe(true);
    marketError = null;
    pluginError = "插件重读失败";
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "重新读取" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/插件为上次读取结果，已过期/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "禁用 writer（team-tools）" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "移除市场 team-tools" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses the merged Hooks destination, caches tab visits, and invalidates Hooks after plugin changes", async () => {
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByRole("tab", { name: "Hooks" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "前往插件市场" }) as HTMLButtonElement).disabled).toBe(false));
    expect(reads("scan_codex_hooks")).toBe(1);
    await user.click(screen.getByRole("button", { name: "前往插件市场" }));
    expect(screen.getByRole("tab", { name: "插件市场" }).getAttribute("aria-selected")).toBe("true");
    expect(reads("scan_codex_plugins")).toBe(1);
    expect(reads("scan_codex_marketplaces")).toBe(1);
    expand("team-tools");
    await user.click(screen.getByRole("button", { name: "禁用 writer（team-tools）" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await user.click(screen.getByRole("tab", { name: "Hooks" }));
    await waitFor(() => expect(reads("scan_codex_hooks")).toBe(2));
  });
});
