// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionRecords } from "../hooks/useSessionRecords";
import { useOpenCodeSessions } from "../hooks/useOpenCodeSessions";
import { SessionRecordsPage } from "./SessionRecordsPage";
import { requireCoverageItem } from "../observationCoverage";
import { openCodeObservationFacts, sessionObservationFacts } from "../observationFacts";
import { coverageIndexFromFacts } from "../test/observationFixtures";
import type { SessionRecord, SessionRecordScan, SessionSourceScan } from "../sessionRecords";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class<T> {
    constructor(public onmessage: (message: T) => void = () => {}) {}
  },
}));
const mockedInvoke = vi.mocked(invoke);
const directory = "/Users/example/.grok/sessions";
const now = Date.parse("2026-10-27T00:00:00Z");

function record(id: string, title: string, time: number | null): SessionRecord {
  return {
    id: "project/" + id, title, lastActivityMs: time, workingDirectory: "/work/project",
    bytes: 2048, inUse: false,
    grok: { sessionId: id, bytesComplete: true, resumeError: null, parentSessionId: null, relatedSessionIds: [] },
  };
}

function source(overrides: Partial<SessionSourceScan> = {}): SessionSourceScan {
  return {
    directory, status: "Ready", message: null, removalBlockedReason: null,
    ageEligible: { days7: 1, days30: 1 },
    records: [
      record("old", "旧的设计记录", now - 40 * 86_400_000),
      record("recent", "今天的修复记录", now),
      record("unknown", "时间未知记录", null),
    ],
    ...overrides,
  };
}

function Harness() {
  const records = useSessionRecords(true);
  const openCode = useOpenCodeSessions(false);
  const index = coverageIndexFromFacts({
    "session:codex": sessionObservationFacts("codex", records.scan?.codex ?? null, records.scanningSources.codex, records.error),
    "session:claude": sessionObservationFacts("claude", records.scan?.claude ?? null, records.scanningSources.claude, records.error),
    "session:grok": sessionObservationFacts("grok", records.scan?.grok ?? null, records.scanningSources.grok, records.error),
    "session:opencode": openCodeObservationFacts(openCode.scan, openCode.scanning, openCode.error),
  });
  return <SessionRecordsPage
    coverageItems={{
      codex: requireCoverageItem(index, "session:codex"),
      claude: requireCoverageItem(index, "session:claude"),
      grok: requireCoverageItem(index, "session:grok"),
      opencode: requireCoverageItem(index, "session:opencode"),
    }}
    records={records} openCode={openCode} initialSource="grok" homeDirectory="/Users/example" nowMs={now}
  />;
}

function respond(scan: SessionSourceScan, removal?: unknown) {
  const empty: SessionSourceScan = { directory: "", status: "Missing", records: [], message: null, ageEligible: { days7: 0, days30: 0 } };
  const all: SessionRecordScan = { codex: empty, claude: empty, grok: scan };
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "scan_session_records") return all;
    if (command === "scan_session_source") return scan;
    if (command === "open_grok_session") return null;
    if (command.startsWith("remove_session_record")) return removal ?? {
      moved: 0, failed: 0, skipped: 0, operationError: null, message: null, items: [],
    };
    throw new Error("Unexpected command " + command);
  });
}

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(Date, "now").mockReturnValue(now); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Grok Build session records", () => {
  it("keeps browsing and continuing available while source-level runtime protection blocks removal", async () => {
    respond(source({ removalBlockedReason: "Grok Build 仍在运行，请退出后刷新。" }));
    render(<Harness />);
    await screen.findByText("旧的设计记录");
    expect(screen.getByText("Grok Build 仍在运行，请退出后刷新。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "将 旧的设计记录 移入废纸篓" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("checkbox", { name: "选择 旧的设计记录" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("使用中，暂不移除")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "在 Grok Build 中继续 旧的设计记录" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("open_grok_session", {
      id: "project/old", expectedDirectory: directory,
    }));
  });

  it("explains directory, index and relation boundaries and cancels without removing anything", async () => {
    const scan = source();
    scan.records[0].grok!.relatedSessionIds = ["recent"];
    respond(scan);
    render(<Harness />);
    await screen.findByText("旧的设计记录");
    fireEvent.click(screen.getByRole("button", { name: "将 旧的设计记录 移入废纸篓" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/搜索索引与远端副本保留/)).toBeTruthy();
    expect(within(dialog).getByText(/独立关联记录不会自动连带移除/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(mockedInvoke.mock.calls.some(([name]) => name.startsWith("remove_session_record"))).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("freezes the source and age threshold for all records despite a search hiding older records", async () => {
    respond(source());
    render(<Harness />);
    await screen.findByText("旧的设计记录");
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Grok Build 会话记录" }), { target: { value: "今天" } });
    expect(screen.queryByText("旧的设计记录")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "移除 7 天前的记录" }));
    vi.mocked(Date.now).mockReturnValue(now + 86_400_000);
    await act(async () => { fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "移入废纸篓" })); });
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("remove_session_records_older_than", {
      source: "grok", days: 7, confirmedCount: 1, expectedDirectory: directory,
      cutoffMs: now - 7 * 86_400_000, onProgress: expect.anything(),
    }));
  });

  it("retains selection and reports unattempted records after a partial batch", async () => {
    respond(source(), {
      moved: 1, failed: 0, skipped: 0, operationError: null, message: "Grok Build 已启动，剩余记录未执行。",
      items: [
        { id: "project/old", status: "Moved", reason: null, message: null },
        { id: "project/recent", status: "NotAttempted", reason: "RuntimeBlocked", message: "Grok Build 已启动" },
      ],
    });
    render(<Harness />);
    await screen.findByText("旧的设计记录");
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 旧的设计记录" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 今天的修复记录" }));
    fireEvent.click(screen.getByRole("button", { name: "移入废纸篓 2 条" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "移入废纸篓" })); });
    await screen.findByText(/移入废纸篓 1 条，跳过 0 条，失败 0 条，未执行 1 条/);
    expect(screen.getByRole("checkbox", { name: "选择 今天的修复记录" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "选择 旧的设计记录" }).getAttribute("aria-checked")).toBe("false");
    expect(mockedInvoke).toHaveBeenCalledWith("remove_session_records", expect.objectContaining({
      source: "grok", expectedDirectory: directory, ids: ["project/recent", "project/old"],
    }));
  });

  it("shows incomplete measurements and blocks only resume for records missing a working directory", async () => {
    const scan = source();
    scan.records[2].workingDirectory = null;
    scan.records[2].bytes = 0;
    scan.records[2].grok!.bytesComplete = false;
    scan.records[2].grok!.resumeError = "原工作目录未记录，无法继续会话。";
    respond(scan);
    render(<Harness />);
    await screen.findByText("时间未知记录");
    expect(screen.getByText("大小未知")).toBeTruthy();
    expect(screen.getByRole("button", { name: "在 Grok Build 中继续 时间未知记录" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "将 时间未知记录 移入废纸篓" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "将 时间未知记录 移入废纸篓" }));
    expect(within(screen.getByRole("alertdialog")).getByText("将「时间未知记录」移入废纸篓？")).toBeTruthy();
  });
});
