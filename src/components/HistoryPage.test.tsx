// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { managerFixture } from "../test/fixtures";
import { snapshotDraft } from "../managerHistory";
import type { MaintenanceRecord, MaintenanceRecordSummary } from "../maintenanceHistory";
import { HistoryPage } from "./HistoryPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

const startedAt = 1_760_000_000_000;
const managerSummary: MaintenanceRecordSummary = {
  id: "op-manager",
  domain: "manager",
  operation: "cleanupCache",
  startedAt,
  finishedAt: startedAt + 100,
  execution: "succeeded",
  interrupted: false,
  subject: { managerId: "Npm", targetCount: 1 },
  counts: { total: 1, succeeded: 1, failed: 0, skipped: 0, notAttempted: 0 },
  followUpReadStatus: null,
  verificationStatus: "failed",
};

const managerRecord: MaintenanceRecord = {
  id: "op-manager",
  domain: "manager",
  operation: "cleanupCache",
  startedAt,
  finishedAt: startedAt + 100,
  execution: "succeeded",
  interrupted: false,
  message: "缓存清理已完成",
  followUpRead: null,
  verification: {
    status: "failed",
    recordedAt: startedAt + 200,
    message: "目录无法测量",
    beforeSnapshotId: null,
    afterSnapshotId: null,
  },
  detail: {
    kind: "manager",
    managerId: "Npm",
    target: null,
    steps: [{ label: "清理缓存", state: "succeeded", failureMessage: null }],
  },
};

const projectSummary: MaintenanceRecordSummary = {
  id: "op-project",
  domain: "projectCleanup",
  operation: "cleanBatch",
  startedAt: startedAt + 500,
  finishedAt: startedAt + 600,
  execution: "partial",
  interrupted: false,
  subject: { rootPath: "/work", targetCount: 1 },
  counts: { total: 1, succeeded: 0, failed: 1, skipped: 0, notAttempted: 0 },
  followUpReadStatus: null,
  verificationStatus: null,
};

const projectRecord: MaintenanceRecord = {
  id: "op-project",
  domain: "projectCleanup",
  operation: "cleanBatch",
  startedAt: startedAt + 500,
  finishedAt: startedAt + 600,
  execution: "partial",
  interrupted: false,
  message: "项目清理批次已结束",
  followUpRead: null,
  verification: null,
  detail: {
    kind: "projectCleanup",
    scope: {
      scanId: "scan-1",
      scanRootId: "root-1",
      scanRootPath: "/work",
      batchId: "batch-1",
      candidates: [{
        candidateId: "candidate-1",
        kind: "RustTarget",
        projectPath: "/work/app",
        directoryPath: "/work/app/target",
        order: 0,
        confirmedBytes: 100,
        confirmedComplete: true,
      }],
    },
    finish: "completed",
    results: [{
      candidateId: "candidate-1",
      status: "Failed",
      command: "cargo clean",
      beforeBytes: 100,
      afterBytes: 100,
      cleanedBytes: 0,
      measurementStatus: "Ready",
      message: null,
      failureMessage: "cargo clean failed",
      effectFailureMessage: null,
    }],
  },
};

function records() {
  const first = snapshotDraft(managerFixture("Npm", { scopeKey: "root", packages: [] }), null);
  const second = snapshotDraft(managerFixture("Npm", { scopeKey: "root", packages: [] }), null);
  return [{ ...second, id: "snapshot-2", capturedAt: 2 }, { ...first, id: "snapshot-1", capturedAt: 1 }];
}

describe("History page", () => {
  it("lists maintenance records and loads their details", async () => {
    mockedInvoke.mockImplementation(async (name, args) => {
      if (name === "list_maintenance_history") return { records: [managerSummary, projectSummary], warnings: [] };
      if (name === "list_manager_history") return { snapshots: records(), warnings: [] };
      if (name === "get_maintenance_record") {
        return (args as { id: string }).id === "op-manager" ? managerRecord : projectRecord;
      }
      throw new Error(`Unexpected command ${name}`);
    });
    render(<HistoryPage active managers={["Npm"]} historyRevision={0} homeDirectory={null} request={null} />);
    expect(await screen.findByText(/npm · 缓存清理/)).toBeTruthy();
    expect(screen.getByText(/项目清理 · \/work/)).toBeTruthy();
    await userEvent.click(screen.getByText(/npm · 缓存清理/));
    expect(await screen.findByText("恢复边界")).toBeTruthy();
    const detail = screen.getByLabelText("维护记录详情");
    expect(within(detail).getByText("缓存清理已完成")).toBeTruthy();
    expect(within(detail).getByText("清理缓存 · 已完成")).toBeTruthy();
    expect(within(detail).getByText("核对未完成")).toBeTruthy();
    expect(within(detail).getByText("目录无法测量")).toBeTruthy();
    expect(mockedInvoke).toHaveBeenCalledWith("get_maintenance_record", { id: "op-manager" });
  });

  it("filters by domain and opens a requested record", async () => {
    mockedInvoke.mockImplementation(async (name, args) => {
      if (name === "list_maintenance_history") return { records: [managerSummary, projectSummary], warnings: [] };
      if (name === "list_manager_history") return { snapshots: records(), warnings: [] };
      if (name === "get_maintenance_record") {
        return (args as { id: string }).id === "op-project" ? projectRecord : managerRecord;
      }
      throw new Error(`Unexpected command ${name}`);
    });
    render(<HistoryPage active managers={["Npm"]} historyRevision={0} homeDirectory={null} request={{ recordId: "op-project" }} />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("get_maintenance_record", { id: "op-project" }));
    expect(await screen.findByText("cargo clean failed")).toBeTruthy();
    expect(within(screen.getByLabelText("维护记录详情")).getByText(/项目清理 · \/work/)).toBeTruthy();
  });

  it("clears the detail when the selected record leaves the filter", async () => {
    mockedInvoke.mockImplementation(async (name, args) => {
      if (name === "list_maintenance_history") return { records: [managerSummary, projectSummary], warnings: [] };
      if (name === "list_manager_history") return { snapshots: records(), warnings: [] };
      if (name === "get_maintenance_record") return (args as { id: string }).id === "op-manager" ? managerRecord : projectRecord;
      throw new Error(`Unexpected command ${name}`);
    });
    render(<HistoryPage active managers={["Npm"]} historyRevision={0} homeDirectory={null} request={null} />);
    await userEvent.click(await screen.findByText(/npm · 缓存清理/));
    expect(await screen.findByText("恢复边界")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("领域"), "projectCleanup");
    expect(screen.getByText("选择一条记录查看确认范围、执行结果和后续读取或核对。")).toBeTruthy();
  });

  it("filters the record list by domain", async () => {
    mockedInvoke.mockImplementation(async (name) => {
      if (name === "list_maintenance_history") return { records: [managerSummary, projectSummary], warnings: [] };
      if (name === "list_manager_history") return { snapshots: records(), warnings: [] };
      throw new Error(`Unexpected command ${name}`);
    });
    render(<HistoryPage active managers={["Npm"]} historyRevision={0} homeDirectory={null} request={null} />);
    expect(await screen.findByText(/npm · 缓存清理/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("领域"), "projectCleanup");
    expect(screen.queryByText(/npm · 缓存清理/)).toBeNull();
    expect(screen.getByText(/项目清理 · \/work/)).toBeTruthy();
  });

  it("keeps snapshot comparison available in its own section", async () => {
    mockedInvoke.mockImplementation(async (name) => {
      if (name === "list_maintenance_history") return { records: [], warnings: [] };
      if (name === "list_manager_history") return { snapshots: records(), warnings: [] };
      throw new Error(`Unexpected command ${name}`);
    });
    render(<HistoryPage active managers={["Npm"]} historyRevision={0} homeDirectory={null} request={null} />);
    await userEvent.click(screen.getByRole("button", { name: "快照对比" }));
    expect(await screen.findByText("条目变化 · 0 项")).toBeTruthy();
    expect(screen.getByText("目录占用变化")).toBeTruthy();
  });
});
