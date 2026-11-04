// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useMavenUnused } from "../hooks/useMavenUnused";
import { MavenUnusedPanel } from "./MavenUnusedPanel";
import type { MavenUnusedScan } from "../mavenUnused";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.mocked(invoke).mockReset());

const scan: MavenUnusedScan = {
  scanId: "scan-1", scannedAt: 1793750400000, repository: "/home/.m2/repository", roots: ["/code"], projects: 2,
  versions: 4, protectedVersions: 2, excludedVersions: 0, referenceMode: "complete", missingModels: [], blockers: [],
  candidates: [
    { id: "a", coordinate: "org.example:library", version: "1.0", path: "/repository/a", bytes: 2048 },
    { id: "b", coordinate: "org.example:unused", version: "2.0", path: "/repository/b", bytes: 4096 },
  ],
};

function Harness({ onRemoved = vi.fn() }: { onRemoved?: () => void }) {
  const workflow = useMavenUnused();
  return <MavenUnusedPanel workflow={workflow} homeDirectory={null} presets={[{ id: "preset", path: "/code", maxDepth: 8 }]} disabled={false} onRemoved={onRemoved} />;
}

async function startScan(user: ReturnType<typeof userEvent.setup>, result = scan) {
  vi.mocked(invoke).mockResolvedValueOnce(result);
  await user.selectOptions(screen.getByRole("combobox"), "/code");
  await user.click(screen.getByRole("button", { name: "检查引用" }));
  await screen.findByText(`发现 ${result.projects} 个项目 · ${result.versions} 个构件版本 · 引用保护 ${result.protectedVersions} 个 · 来源保护 ${result.excludedVersions} 个`);
}

it("shows scope, preserves selection through search, and confirms only selected backend IDs", async () => {
  const user = userEvent.setup();
  const onRemoved = vi.fn();
  render(<Harness onRemoved={onRemoved} />);
  await startScan(user);
  expect(invoke).toHaveBeenCalledWith("scan_maven_unused_dependencies", { roots: ["/code"], referenceMode: "complete" });
  await user.click(screen.getByRole("checkbox", { name: "选择 org.example:library:1.0" }));
  await user.type(screen.getByRole("searchbox"), "unused");
  expect(screen.queryByText("org.example:library")).toBeNull();
  await user.click(screen.getByRole("button", { name: "清理所选 1 个" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText("org.example:library:1.0")).toBeTruthy();
  expect(within(dialog).queryByText("org.example:unused:2.0")).toBeNull();
  expect(within(dialog).getByText(/清空前可恢复/)).toBeTruthy();
  vi.mocked(invoke).mockResolvedValueOnce({ moved: 1, skipped: 0, failed: 0, items: [{ id: "a", status: "Moved", message: null }] });
  await user.click(within(dialog).getByRole("button", { name: "移入废纸篓" }));
  await screen.findByText("已移入废纸篓 1 个 · 跳过 0 个 · 失败 0 个");
  expect(invoke).toHaveBeenCalledWith("remove_maven_unused_dependencies", { scanId: "scan-1", ids: ["a"] });
  expect(onRemoved).toHaveBeenCalledOnce();
  expect(screen.queryByRole("checkbox", { name: /选择 org.example/ })).toBeNull();
});

it("blocks cleanup for incomplete analysis and discards authorization when roots change", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await startScan(user, { ...scan, blockers: ["父 POM 无法读取"], candidates: [] });
  expect(screen.getByText("引用分析不完整，暂不可清理")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /清理所选/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "移除扫描目录 /code" }));
  expect(screen.queryByText("父 POM 无法读取")).toBeNull();
  expect(screen.getByRole("button", { name: "检查引用" }).hasAttribute("disabled")).toBe(true);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("cancel performs no cleanup and a failed cleanup requires a fresh scan", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await startScan(user);
  await user.click(screen.getByRole("checkbox", { name: "选择 org.example:library:1.0" }));
  await user.click(screen.getByRole("button", { name: "清理所选 1 个" }));
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(invoke).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "清理所选 1 个" }));
  vi.mocked(invoke).mockRejectedValueOnce("扫描已失效");
  await user.click(screen.getByRole("button", { name: "移入废纸篓" }));
  await waitFor(() => expect(screen.getByText("扫描已失效")).toBeTruthy());
  expect(screen.queryByRole("checkbox", { name: /选择 org.example/ })).toBeNull();
});

it("requires a new scan when choosing available models and shows missing models in confirmation", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await startScan(user);
  await user.click(screen.getByRole("checkbox", { name: "选择 org.example:library:1.0" }));
  await user.click(screen.getByRole("checkbox", { name: /仅检查本地已有 POM/ }));
  expect(screen.queryByRole("button", { name: /清理所选/ })).toBeNull();
  vi.mocked(invoke).mockResolvedValueOnce({ ...scan, referenceMode: "available", missingModels: ["org.example:not-downloaded"] });
  await user.click(screen.getByRole("button", { name: "检查引用" }));
  await screen.findByText("检查范围：本地已有 POM");
  expect(invoke).toHaveBeenLastCalledWith("scan_maven_unused_dependencies", { roots: ["/code"], referenceMode: "available" });
  await user.click(screen.getByText("查看缺失模型"));
  expect(screen.getByText("org.example:not-downloaded")).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "选择 org.example:library:1.0" }));
  await user.click(screen.getByRole("button", { name: "清理所选 1 个" }));
  expect(within(screen.getByRole("alertdialog")).getByText(/本次仅检查本地已有 POM，有 1 个缺失模型/)).toBeTruthy();
});

it("selects all current results and preserves hidden selections when clearing a filtered result", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await startScan(user);
  await user.click(screen.getByRole("button", { name: "全选" }));
  expect(screen.getByRole("button", { name: "清理所选 2 个" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "取消全选" }));
  expect(screen.getByRole("button", { name: "清理所选 0 个" }).hasAttribute("disabled")).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "选择 org.example:library:1.0" }));
  await user.type(screen.getByRole("searchbox"), "unused");
  await user.click(screen.getByRole("button", { name: "全选当前结果" }));
  expect(screen.getByRole("button", { name: "清理所选 2 个" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "取消当前选择" }));
  expect(screen.getByRole("button", { name: "清理所选 1 个" })).toBeTruthy();
  await user.clear(screen.getByRole("searchbox"));
  expect(screen.getByRole("checkbox", { name: "选择 org.example:library:1.0" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("checkbox", { name: "选择 org.example:unused:2.0" }).getAttribute("aria-checked")).toBe("false");
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("limits bulk selection to 200 versions and allows clearing a capped selection", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await startScan(user, { ...scan, versions: 201, candidates: Array.from({ length: 201 }, (_, index) => ({
    id: String(index), coordinate: `org.example:library-${index}`, version: "1", path: `/repository/${index}`, bytes: 1024,
  })) });
  await user.click(screen.getByRole("button", { name: "全选" }));
  expect(screen.getByRole("button", { name: "清理所选 200 个" })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "选择 org.example:library-200:1" }).getAttribute("aria-checked")).toBe("false");
  await user.click(screen.getByRole("button", { name: "取消全选" }));
  expect(screen.getByRole("button", { name: "清理所选 0 个" }).hasAttribute("disabled")).toBe(true);
  expect(invoke).toHaveBeenCalledTimes(1);
});
