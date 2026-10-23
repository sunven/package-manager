// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectScanHistoryDialog } from "./ProjectScanHistoryDialog";
import type { ProjectScanCandidateKey, ProjectScanRecord } from "../types";

afterEach(cleanup);

function key(kind: ProjectScanCandidateKey["kind"], directoryPath: string): ProjectScanCandidateKey {
  return { kind, directoryPath };
}

function record(overrides: Partial<ProjectScanRecord> = {}): ProjectScanRecord {
  return {
    id: "record-1",
    presetId: "preset-1",
    scanId: "scan-1",
    rootPath: "/code",
    maxDepth: 8,
    finishedAt: 100,
    discovery: { complete: true, skipped: 0 },
    measurement: "finished",
    projects: { total: 4, rust: 2, node: 1, maven: 1 },
    candidates: { total: 4, rustTarget: 2, mavenTarget: 1, nodeModules: 1 },
    baseline: {
      finishedAt: 50,
      projects: { total: 3, rust: 2, node: 1, maven: 0 },
      candidates: { total: 3, rustTarget: 2, mavenTarget: 0, nodeModules: 1 },
    },
    changes: {
      added: [key("NodeModules", "/code/b/node_modules")],
      removed: [key("RustTarget", "/code/a/target")],
    },
    ...overrides,
  };
}

function renderDialog(
  records: ProjectScanRecord[],
  options: { warning?: string | null; onCopyPath?: (path: string) => void } = {},
) {
  return render(
    <ProjectScanHistoryDialog
      homeDirectory={null}
      onCopyPath={options.onCopyPath ?? (() => {})}
      onOpenChange={() => {}}
      open
      presetDepth={8}
      presetPath="/code"
      records={records}
      warning={options.warning ?? null}
    />,
  );
}

it("renders read-only scan records with baseline changes and relative paths", async () => {
  const user = userEvent.setup();
  const onCopyPath = vi.fn();
  renderDialog([record()], { onCopyPath });

  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("扫描记录")).toBeTruthy();
  expect(screen.getAllByText(/深度 8/).length).toBeGreaterThan(0);
  expect(screen.getByText(/比较基线/)).toBeTruthy();
  expect(screen.getByText(/基线记录已不在列表中/)).toBeTruthy();
  expect(screen.getByText("新增 1")).toBeTruthy();
  expect(screen.getByText("消失 1")).toBeTruthy();
  expect(screen.getByText("b/node_modules")).toBeTruthy();
  expect(screen.getByText("a/target")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /打开/ })).toBeNull();

  await user.click(screen.getByRole("button", { name: "复制 b/node_modules 路径" }));
  expect(onCopyPath).toHaveBeenCalledWith("/code/b/node_modules");
});

it("does not mark a baseline that is still in the retained list", () => {
  const baseline = record({
    id: "baseline",
    finishedAt: 50,
    baseline: null,
    changes: null,
  });
  renderDialog([baseline, record()]);
  expect(screen.queryByText(/基线记录已不在列表中/)).toBeNull();
});

it("separates incomplete discovery from a stopped measurement", () => {
  renderDialog([
    record({
      discovery: { complete: false, skipped: 2 },
      measurement: "stopped",
      baseline: null,
      changes: null,
    }),
  ]);

  expect(screen.getByText("发现不完整")).toBeTruthy();
  expect(screen.getByText("测量已取消")).toBeTruthy();
  expect(screen.getByText(/发现阶段跳过 2 个目录/)).toBeTruthy();
  expect(screen.getByText("本次发现不完整，未比较变化。")).toBeTruthy();
});

it("shows the first-comparable and empty states without inventing changes", () => {
  renderDialog([
    record({
      baseline: null,
      changes: null,
    }),
  ]);
  expect(screen.getByText("首次可比较扫描，暂无比较基线。")).toBeTruthy();

  cleanup();
  renderDialog([]);
  expect(screen.getByText(/尚无扫描记录/)).toBeTruthy();
});

it("surfaces a history read warning alongside the available records", () => {
  renderDialog([record()], { warning: "history offline" });
  expect(screen.getByText("扫描记录不可用")).toBeTruthy();
  expect(screen.getByText(/history offline/)).toBeTruthy();
  expect(screen.getByText("新增 1")).toBeTruthy();
});
