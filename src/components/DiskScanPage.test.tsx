// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DiskScanPage } from "./DiskScanPage";
import { createDiskScanWorkflow, type DiskScanEffects } from "../diskScanWorkflow";
import { diskDirectory, diskEntry, diskSummary } from "../test/diskScanFixtures";
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function fixture(directory = diskDirectory()) {
  const effects: DiskScanEffects = {
    settings: vi.fn(async () => ({ lastPath: "/saved", warning: null })),
    choose: vi.fn(async () => "/test"),
    start: vi.fn(async () => diskSummary({ phase: "completed", finishedAt: 1795075201000, revision: 1, entries: 4, bytes: 4096 })),
    stop: vi.fn(async () => {}),
    directory: vi.fn(async (input) => input.directoryId === 0 ? directory : diskDirectory({ directory: diskEntry({ id: 1, name: "project", path: "/test/project", bytes: 0 }), ancestors: [diskEntry()], entries: [], total: 0 })),
    observe: vi.fn(),
  };
  const workflow = createDiskScanWorkflow(effects);
  function Harness() {
    const view = useSyncExternalStore(workflow.subscribe, workflow.read);
    return <DiskScanPage view={view} workflow={workflow} />;
  }
  return { effects, workflow, Harness };
}

describe("disk scan page", () => {
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
});
