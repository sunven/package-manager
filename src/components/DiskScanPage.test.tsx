// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DiskScanPage } from "./DiskScanPage";
import { createDiskScanWorkflow, type DiskScanEffects } from "../diskScanWorkflow";
import { diskChart, diskDirectory, diskEntry, diskSummary } from "../test/diskScanFixtures";
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
const chartEngine = vi.hoisted(() => ({ setOption: vi.fn(), on: vi.fn(), resize: vi.fn(), dispose: vi.fn() }));
vi.mock("echarts/core", () => ({ use: vi.fn(), init: vi.fn(() => chartEngine) }));
vi.mock("echarts/charts", () => ({ TreemapChart: {} }));
vi.mock("echarts/components", () => ({ TooltipComponent: {} }));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); delete document.documentElement.dataset.theme; });

function fixture(directory = diskDirectory()) {
  const effects: DiskScanEffects = {
    settings: vi.fn(async () => ({ lastPath: "/saved", warning: null })),
    choose: vi.fn(async () => "/test"),
    start: vi.fn(async () => diskSummary({ phase: "completed", finishedAt: 1795075201000, revision: 1, entries: 4, bytes: 4096 })),
    stop: vi.fn(async () => {}),
    directory: vi.fn(async (input) => input.directoryId === 0 ? directory : diskDirectory({ directory: diskEntry({ id: 1, name: "project", path: "/test/project", bytes: 0 }), ancestors: [diskEntry()], entries: [], total: 0 })),
    chart: vi.fn(async ({ directoryId }) => directoryId === 0 ? diskChart({ revision: 1, phase: "completed" }) : diskChart({
      revision: 1, phase: "completed", directory: diskEntry({ id: directoryId, name: "project", path: "/test/project", bytes: 0 }),
      ancestors: [diskEntry()], entries: [], total: 0, counts: { unmeasured: 0, zero: 0, excluded: 0 },
    })),
    observe: vi.fn(),
    removal: {
      prepare: vi.fn(), cancel: vi.fn(async () => {}), run: vi.fn(), stop: vi.fn(async () => {}),
      locate: vi.fn(async () => 0), followup: vi.fn(async () => {}),
    },
  };
  const workflow = createDiskScanWorkflow(effects);
  function Harness() {
    const view = useSyncExternalStore(workflow.subscribe, workflow.read);
    return <DiskScanPage view={view} workflow={workflow} />;
  }
  return { effects, workflow, Harness };
}

describe("disk scan page", () => {
  it("confirms a single row independently of selection, explains partial directories and executes only after confirmation", async () => {
    const { workflow, effects, Harness } = fixture();
    vi.mocked(effects.removal.prepare).mockImplementation(async (scanId, ids) => ({ id: "plan-1", scanId, rootPath: "/test", targets: ids.map((id) => ({ id, name: "restricted", path: "/test/restricted", directory: true, partial: true, bytes: null })) }));
    vi.mocked(effects.removal.run).mockResolvedValue({ results: [{ id: 3, path: "/test/restricted", status: "moved", message: null }], stopped: false, historyId: null, historyWarning: null });
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" })); await screen.findByRole("table");
    fireEvent.click(screen.getByRole("checkbox", { name: "全选已显示" }));
    expect(screen.getByRole("checkbox", { name: "选择：linked" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "移到废纸篓：restricted" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(effects.removal.prepare).toHaveBeenCalledWith("scan-1", [3]);
    expect(within(dialog).getByText("/test/restricted")).toBeTruthy();
    expect(within(dialog).getByText(/操作包含未扫描到的内容/)).toBeTruthy();
    expect(effects.removal.run).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(effects.removal.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "移到废纸篓：restricted" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "移到废纸篓" }));
    await screen.findByText("移除结果");
    expect(effects.removal.run).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/已移入 1/)).toBeTruthy();
  });

  it("offers a context action for a chart directory without changing click-to-enter", async () => {
    const { workflow, effects, Harness } = fixture();
    vi.mocked(effects.removal.prepare).mockResolvedValue({ id: "plan-1", scanId: "scan-1", rootPath: "/test", targets: [{ id: 1, name: "project", path: "/test/project", directory: true, partial: false, bytes: 4096 }] });
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" })); await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "矩形树图" }));
    await screen.findByRole("img");
    const context = chartEngine.on.mock.calls.find(([event]) => event === "contextmenu")?.[1];
    expect(context).toBeDefined();
    fireEvent.contextMenu(screen.getByRole("img"));
    act(() => context({ data: { id: "1" } }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "移到废纸篓" }));
    await screen.findByRole("alertdialog");
    expect(effects.removal.prepare).toHaveBeenCalledWith("scan-1", [1]);
    expect(workflow.read().directoryId).toBe(0);
  });

  it("selects a draft, scans on submit, drills down and copies files without opening them", async () => {
    const { effects, workflow, Harness } = fixture();
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    await waitFor(() => expect((screen.getByLabelText("扫描目录") as HTMLInputElement).value).toBe("/test"));
    expect(effects.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }));
    await screen.findByRole("table", { name: "目录内容" });
    expect(screen.getByRole("button", { name: "上一级" }).hasAttribute("disabled")).toBe(true);
    const table = screen.getByRole("table");
    expect(within(table).getByText("0 B")).toBeTruthy();
    expect(within(table).getAllByText("—")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "linked" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "复制路径：readme" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/test/readme"));
    fireEvent.click(screen.getByRole("button", { name: "project" }));
    await screen.findByText("此目录为空。");
    fireEvent.click(screen.getByRole("button", { name: "上一级" }));
    await screen.findByRole("table");
    expect(effects.start).toHaveBeenCalledTimes(1);
  });

  it("keeps old rows after invalid input and shows an actionable error", async () => {
    const { effects, workflow, Harness } = fixture();
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" })); await screen.findByRole("table");
    vi.mocked(effects.start).mockRejectedValueOnce("扫描起点必须是目录。");
    fireEvent.change(screen.getByLabelText("扫描目录"), { target: { value: "/test/readme" } });
    fireEvent.click(screen.getByRole("button", { name: "重新扫描" }));
    await screen.findByText("扫描起点必须是目录。");
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("loads the next batch without starting a new scan", async () => {
    const { effects, workflow, Harness } = fixture();
    const entries = Array.from({ length: 250 }, (_, index) => diskEntry({ id: index + 1, name: `file-${index}`, kind: "file", path: `/test/file-${index}` }));
    vi.mocked(effects.directory).mockImplementation(async ({ limit }) => diskDirectory({ entries: entries.slice(0, limit), total: entries.length }));
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }));
    await screen.findByText("已显示 200 / 250 个已发现条目");
    expect(screen.queryByText("file-249")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "继续显示 200 条" }));
    await screen.findByText("file-249");
    expect(screen.getByText("已显示 250 / 250 个已发现条目")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "继续显示 200 条" })).toBeNull();
    expect(effects.start).toHaveBeenCalledTimes(1);
  });

  it("never calls a partial empty directory empty", async () => {
    const directory = diskDirectory({ directory: diskEntry({ status: "partial", bytes: null }), entries: [], total: 0 });
    const { workflow, Harness } = fixture(directory);
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }));
    await screen.findByText("此目录尚无可展示的条目，读取结果不完整。");
    expect(screen.queryByText("此目录为空。")).toBeNull();
  });

  it("selects a chart file, safely displays its name, copies its path and drills into directories", async () => {
    const { effects, workflow, Harness } = fixture();
    const file = diskEntry({ id: 5, name: '<img src=x onerror="alert(1)">', kind: "file", path: '/test/<img src=x onerror="alert(1)">', bytes: 512 });
    vi.mocked(effects.chart).mockResolvedValueOnce(diskChart({ revision: 1, phase: "completed", entries: [diskEntry({ id: 1, name: "project" }), file] }));
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" })); await screen.findByRole("table");
    expect(effects.chart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "矩形树图" }));
    await screen.findByRole("img");
    await waitFor(() => expect(chartEngine.setOption).toHaveBeenCalled());
    const option = chartEngine.setOption.mock.calls[chartEngine.setOption.mock.calls.length - 1][0];
    const tooltip = option.tooltip.formatter({ data: { id: "5" } }) as HTMLElement;
    expect(tooltip.textContent).toContain(file.path);
    expect(tooltip.querySelector("img")).toBeNull();
    const activate = chartEngine.on.mock.calls.find(([name]) => name === "click")![1];
    act(() => activate({ data: { id: "5" } }));
    const details = screen.getByLabelText("选中文件详情");
    expect(within(details).getByText(file.path)).toBeTruthy();
    fireEvent.click(within(details).getByRole("button", { name: `复制路径：${file.name}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(file.path));
    act(() => activate({ data: { id: "1" } }));
    await screen.findByText("此目录为空。");
    expect(screen.queryByLabelText("选中文件详情")).toBeNull();
    expect(screen.getByRole("button", { name: "矩形树图" }).getAttribute("aria-pressed")).toBe("true");
    expect(effects.start).toHaveBeenCalledTimes(1);
  });

  it("opens grouped lists from chart counts and lets the user restore all entries", async () => {
    const { effects, workflow, Harness } = fixture();
    vi.mocked(effects.directory).mockImplementation(async ({ group }) => group === "unmeasured"
      ? diskDirectory({ entries: [diskEntry({ id: 3, name: "restricted", bytes: null, status: "partial" })], total: 1 }) : diskDirectory());
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" })); await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "矩形树图" })); await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "尚未统计出占用 1" }));
    await screen.findByText("正在查看：尚未统计出占用 · 1 项");
    expect(within(screen.getByRole("table")).queryByText("readme")).toBeNull();
    expect(effects.directory).toHaveBeenLastCalledWith(expect.objectContaining({ group: "unmeasured", limit: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "查看全部" }));
    await screen.findByText("readme");
    expect(screen.queryByText(/正在查看/)).toBeNull();
    expect(effects.start).toHaveBeenCalledTimes(1);
  });

  it("keeps unknown and zero counts accessible when there is no drawable area", async () => {
    const { effects, workflow, Harness } = fixture();
    vi.mocked(effects.chart).mockResolvedValue(diskChart({ revision: 1, phase: "partial", entries: [], total: 3,
      directory: diskEntry({ bytes: null, status: "partial" }) }));
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" })); await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "矩形树图" }));
    await screen.findByText(/当前没有可绘制的正占用/);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("此目录为空。")).toBeNull();
    for (const label of ["尚未统计出占用 1", "已确认零占用 1", "未计入 1"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
    expect(screen.getByText("部分读取")).toBeTruthy();
  });

  it("repaints the existing canvas on a theme change and disposes it when leaving the chart", async () => {
    const { workflow, Harness } = fixture();
    await workflow.initialize(); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" })); await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "矩形树图" })); await screen.findByRole("img");
    await waitFor(() => expect(chartEngine.setOption).toHaveBeenCalled());
    const previous = chartEngine.setOption.mock.calls[chartEngine.setOption.mock.calls.length - 1][0].series[0].data[0].itemStyle.color;
    document.documentElement.dataset.theme = "dark";
    await waitFor(() => expect(chartEngine.setOption.mock.calls[chartEngine.setOption.mock.calls.length - 1][0].series[0].data[0].itemStyle.color).not.toBe(previous));
    expect(chartEngine.dispose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "列表" }));
    await screen.findByRole("table");
    expect(chartEngine.dispose).toHaveBeenCalledTimes(1);
  });
});
