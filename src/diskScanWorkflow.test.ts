import { describe, expect, it, vi } from "vitest";
import { createDiskScanWorkflow, type DiskScanEffects } from "./diskScanWorkflow";
import type { DiskScanDirectory, DiskScanSummary } from "./diskScan";
import { diskScanObservationFacts } from "./diskScan";
import { buildObservationCoverage } from "./observationCoverage";
import { diskDirectory, diskEntry, diskSummary } from "./test/diskScanFixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const callbacks: ((summary: DiskScanSummary) => void)[] = [];
  const effects: DiskScanEffects = {
    settings: vi.fn(async () => ({ lastPath: "/saved", warning: null })),
    choose: vi.fn(async () => "/picked"),
    start: vi.fn(async (_path, progress) => { callbacks.push(progress); return diskSummary({ scanId: `scan-${callbacks.length}` }); }),
    stop: vi.fn(async () => {}),
    directory: vi.fn(async ({ scanId, directoryId }) => diskDirectory({ scanId, directory: diskEntry({ id: directoryId }) })),
    observe: vi.fn(),
  };
  return { effects, callbacks, workflow: createDiskScanWorkflow(effects) };
}

describe("disk scan lifecycle", () => {
  it("restores only the last path and leaves selection as a draft", async () => {
    const { effects, workflow } = fixture();
    await Promise.all([workflow.initialize(), workflow.initialize()]);
    expect(effects.settings).toHaveBeenCalledTimes(1);
    expect(workflow.read().draftPath).toBe("/saved");
    await workflow.choose();
    expect(workflow.read().draftPath).toBe("/picked");
    expect(workflow.read().lastPath).toBe("/saved");
    expect(effects.start).not.toHaveBeenCalled();
    expect(effects.directory).not.toHaveBeenCalled();
    expect(workflow.read().summary).toBeNull();
  });

  it("keeps the old scan and accepts its progress after an invalid new path", async () => {
    const { effects, callbacks, workflow } = fixture();
    await workflow.initialize(); await workflow.start();
    workflow.setPath("bad");
    vi.mocked(effects.start).mockRejectedValueOnce("目录不存在");
    await workflow.start();
    expect(workflow.read().summary?.scanId).toBe("scan-1");
    expect(workflow.read().error).toBe("目录不存在");
    callbacks[0](diskSummary({ revision: 1, entries: 300 }));
    expect(workflow.read().summary?.entries).toBe(300);
    expect(effects.stop).not.toHaveBeenCalled();
    expect(effects.observe).toHaveBeenCalledWith(expect.objectContaining({ kind: "attempt", outcome: "failed" }));
  });

  it("ignores late events from a replaced scan and an older start response", async () => {
    const { effects, callbacks, workflow } = fixture();
    await workflow.initialize(); await workflow.start();
    await workflow.start();
    callbacks[0](diskSummary({ revision: 3, phase: "completed", finishedAt: 40 }));
    expect(workflow.read().summary?.scanId).toBe("scan-2");
    const pending = deferred<DiskScanSummary>();
    vi.mocked(effects.start).mockImplementationOnce((_path, progress) => {
      progress(diskSummary({ scanId: "scan-3", revision: 1, phase: "completed", finishedAt: 50 }));
      return pending.promise;
    });
    const start = workflow.start();
    pending.resolve(diskSummary({ scanId: "scan-3" })); await start;
    expect(workflow.read().summary?.phase).toBe("completed");
    expect(effects.observe).toHaveBeenCalledTimes(1);
  });

  it("does not declare stopped until native traversal reports its terminal state", async () => {
    const { effects, callbacks, workflow } = fixture();
    await workflow.initialize(); await workflow.start(); await workflow.stop();
    expect(effects.stop).toHaveBeenCalledWith("scan-1");
    expect(workflow.read().summary?.phase).toBe("running");
    expect(workflow.read().stopping).toBe(true);
    callbacks[0](diskSummary({ revision: 1, phase: "stopped", entries: 20, finishedAt: 30, message: "扫描已停止" }));
    expect(workflow.read().stopping).toBe(false);
    expect(workflow.read().summary?.entries).toBe(20);
    expect(effects.observe).toHaveBeenCalledWith(expect.objectContaining({ kind: "success", completeness: "partial" }));
  });

  it("retains navigation while hidden and refreshes only the visible directory", async () => {
    const { effects, callbacks, workflow } = fixture();
    await workflow.initialize(); await workflow.start();
    expect(effects.directory).not.toHaveBeenCalled();
    workflow.setVisible(true);
    await vi.waitFor(() => expect(workflow.read().page).not.toBeNull());
    workflow.enter(1);
    await vi.waitFor(() => expect(workflow.read().page?.directory.id).toBe(1));
    workflow.loadMore();
    await vi.waitFor(() => expect(effects.directory).toHaveBeenLastCalledWith(expect.objectContaining({ directoryId: 1, limit: 400 })));
    workflow.setVisible(false);
    vi.mocked(effects.directory).mockClear();
    callbacks[0](diskSummary({ revision: 1, entries: 800 }));
    expect(effects.directory).not.toHaveBeenCalled();
    workflow.setVisible(true);
    await vi.waitFor(() => expect(effects.directory).toHaveBeenCalledWith(expect.objectContaining({ directoryId: 1, limit: 400 })));
    expect(effects.start).toHaveBeenCalledTimes(1);
  });

  it("discards an old directory read when navigation changes", async () => {
    const { effects, workflow } = fixture();
    const pending = deferred<DiskScanDirectory>();
    vi.mocked(effects.directory).mockReturnValueOnce(pending.promise);
    workflow.setVisible(true);
    await workflow.initialize(); await workflow.start();
    workflow.enter(1);
    pending.resolve(diskDirectory());
    await vi.waitFor(() => expect(workflow.read().page?.directory.id).toBe(1));
    expect(effects.directory).toHaveBeenCalledTimes(2);
  });

  it("clears a recovered directory error while preserving an invalid path error", async () => {
    const { effects, workflow } = fixture();
    vi.mocked(effects.directory).mockRejectedValueOnce("连接中断");
    workflow.setVisible(true);
    await workflow.initialize(); await workflow.start();
    await vi.waitFor(() => expect(workflow.read().error).toBe("目录记录无法读取：连接中断"));
    await workflow.refreshPage();
    expect(workflow.read().error).toBeNull();
    expect(workflow.read().page).not.toBeNull();
    vi.mocked(effects.start).mockRejectedValueOnce("目录不存在");
    await workflow.start(); await workflow.refreshPage();
    expect(workflow.read().error).toBe("目录不存在");
  });

  it("reports complete, partial and previous observations without scanning from coverage", async () => {
    const { callbacks, workflow } = fixture();
    await workflow.initialize();
    const initial = diskScanObservationFacts(workflow.read());
    const previous = { itemId: "disk-scan" as const, lastSuccess: { at: 10, scope: "disk:/saved", scopeLabel: "/saved", completeness: "partial" as const, note: "已停止" }, lastAttempt: null, invalidated: null };
    const coverage = buildObservationCoverage({ records: { "disk-scan": previous }, facts: { "disk-scan": initial }, scopes: {}, enabledManagers: [] });
    expect(coverage.items.find((item) => item.id === "disk-scan")).toMatchObject({ status: "lastObserved", completeness: "partial", actions: { refresh: false } });
    await workflow.start();
    callbacks[0](diskSummary({ revision: 1, phase: "limited", finishedAt: 60 }));
    expect(diskScanObservationFacts(workflow.read()).success?.completeness).toBe("partial");
    const current = buildObservationCoverage({ records: {}, facts: { "disk-scan": diskScanObservationFacts(workflow.read()) }, scopes: { "disk-scan": { key: "disk:/saved", label: "/saved" } }, enabledManagers: [] });
    expect(current.items.find((item) => item.id === "disk-scan")).toMatchObject({ status: "partial", currentScopeLabel: "/test", scopeChanged: false });
  });
});
