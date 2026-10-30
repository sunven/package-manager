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
const directory = "/Users/example/.qoder/projects";
const now = Date.parse("2026-10-27T00:00:00Z");

function record(id: string, title: string, time: number | null, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "-Users-example-work/" + id,
    title,
    lastActivityMs: time,
    workingDirectory: "/Users/example/work",
    bytes: 4096,
    inUse: false,
    ...overrides,
  };
}

function source(overrides: Partial<SessionSourceScan> = {}): SessionSourceScan {
  return {
    directory,
    status: "Ready",
    message: null,
    ageEligible: { days7: 1, days30: 1 },
    records: [
      record("old-uuid", "旧的设计记录", now - 40 * 86_400_000),
      record("recent-uuid", "今天的修复记录", now),
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
    "session:qoder": sessionObservationFacts("qoder", records.scan?.qoder ?? null, records.scanningSources.qoder, records.error),
    "session:qoder-cn": sessionObservationFacts("qoder-cn", records.scan?.["qoder-cn"] ?? null, records.scanningSources["qoder-cn"], records.error),
    "session:opencode": openCodeObservationFacts(openCode.scan, openCode.scanning, openCode.error),
  });
  return <SessionRecordsPage
    coverageItems={{
      codex: requireCoverageItem(index, "session:codex"),
      claude: requireCoverageItem(index, "session:claude"),
      grok: requireCoverageItem(index, "session:grok"),
      qoder: requireCoverageItem(index, "session:qoder"),
      "qoder-cn": requireCoverageItem(index, "session:qoder-cn"),
      opencode: requireCoverageItem(index, "session:opencode"),
    }}
    records={records} openCode={openCode} initialSource="qoder" homeDirectory="/Users/example" nowMs={now}
  />;
}

function respond(scan: SessionSourceScan, removal?: unknown) {
  const empty: SessionSourceScan = { directory: "", status: "Missing", records: [], message: null, ageEligible: { days7: 0, days30: 0 } };
  const all: SessionRecordScan = { codex: empty, claude: empty, qoder: scan, "qoder-cn": empty };
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "scan_session_records") return all;
    if (command === "scan_session_source") return scan;
    if (command === "open_qoder_session") return null;
    if (command.startsWith("remove_session_record")) return removal ?? {
      moved: 0, failed: 0, skipped: 0, operationError: null, message: null, items: [],
    };
    throw new Error("Unexpected command " + command);
  });
}

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(Date, "now").mockReturnValue(now); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Qoder session records", () => {
  it("opens a Qoder session in the terminal with the confirmed source directory", async () => {
    respond(source());
    render(<Harness />);
    await screen.findByText("旧的设计记录");
    expect(screen.getByRole("tab", { name: /Qoder（国际版）/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "在 Qoder（国际版） 中继续 旧的设计记录" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("open_qoder_session", {
      source: "qoder", id: "-Users-example-work/old-uuid", expectedDirectory: directory,
    }));
  });

  it("confirms transcript and sidecar boundaries and freezes the source for single removal", async () => {
    respond(source());
    render(<Harness />);
    await screen.findByText("旧的设计记录");
    fireEvent.click(screen.getByRole("button", { name: "将 旧的设计记录 移入废纸篓" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/转写与配套目录会一起移入废纸篓/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(mockedInvoke.mock.calls.some(([name]) => name.startsWith("remove_session_record"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "将 旧的设计记录 移入废纸篓" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "移入废纸篓" })); });
    expect(mockedInvoke).toHaveBeenCalledWith("remove_session_record", expect.objectContaining({
      source: "qoder", id: "-Users-example-work/old-uuid", expectedDirectory: directory,
    }));
  });

  it("sends the source directory and cutoff for age removal", async () => {
    respond(source());
    render(<Harness />);
    await screen.findByText("旧的设计记录");
    fireEvent.click(screen.getByRole("button", { name: "移除 7 天前的记录" }));
    vi.mocked(Date.now).mockReturnValue(now + 86_400_000);
    await act(async () => { fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "移入废纸篓" })); });
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("remove_session_records_older_than", {
      source: "qoder", days: 7, confirmedCount: 1, expectedDirectory: directory,
      cutoffMs: now - 7 * 86_400_000, onProgress: expect.anything(),
    }));
  });
});
