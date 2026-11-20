import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiskScanWorkflow, type DiskScanEffects } from "./diskScanWorkflow";
import type { DiskScanChart, DiskScanDirectory, DiskScanSummary } from "./diskScan";
import { diskScanObservationFacts } from "./diskScan";
import { buildObservationCoverage } from "./observationCoverage";
import { diskChart, diskDirectory, diskEntry, diskSummary } from "./test/diskScanFixtures";

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
    chart: vi.fn(async ({ scanId, directoryId }) => diskChart({ scanId, directory: diskEntry({ id: directoryId }) })),
    observe: vi.fn(),
    removal: {
      prepare: vi.fn(), cancel: vi.fn(async () => {}), run: vi.fn(), stop: vi.fn(async () => {}),
      locate: vi.fn(async () => 0), followup: vi.fn(async () => {}),
    },
  };
  return { effects, callbacks, workflow: createDiskScanWorkflow(effects) };
}

afterEach(() => { vi.useRealTimers(); });

async function removableFixture() {
  const context = fixture();
  const { workflow, effects, callbacks } = context;
  await workflow.initialize(); await workflow.start(); workflow.setVisible(true);
  callbacks[0](diskSummary({ revision: 1, phase: "completed", finishedAt: 10 }));
  await vi.waitFor(() => expect(workflow.read().page).not.toBeNull());
  vi.mocked(effects.removal.prepare).mockImplementation(async (scanId, ids) => ({
    id: "plan-1", scanId, rootPath: "/test", targets: ids.map((id) => ({ id, name: `file-${id}`, path: `/test/file-${id}`, directory: false, partial: false, bytes: 10 })),
  }));
  return context;
}

describe("disk removal lifecycle", () => {
  it("selects only displayed eligible siblings and preserves selection between views", async () => {
    const { workflow } = await removableFixture();
    workflow.selectDisplayed(true);
    expect(workflow.read().selectedIds).toEqual([1, 2, 3]);
    workflow.loadMore();
    workflow.setMode("treemap");
    expect(workflow.read().selectedIds).toEqual([1, 2, 3]);
    workflow.showGroup("zero");
    expect(workflow.read().selectedIds).toEqual([]);
    await workflow.refreshPage();
    workflow.toggleSelected(diskEntry({ id: 2, kind: "file" }));
    workflow.enter(1);
    expect(workflow.read().selectedIds).toEqual([]);
  });

  it("freezes only the requested target, blocks editing, and cancellation permits a new confirmation", async () => {
    const { workflow, effects } = await removableFixture();
    workflow.selectDisplayed(true);
    await workflow.prepareRemoval([2]);
    expect(effects.removal.prepare).toHaveBeenCalledWith("scan-1", [2]);
    workflow.enter(1); await workflow.start(); workflow.selectDisplayed(false);
    expect(workflow.read().directoryId).toBe(0);
    expect(effects.start).toHaveBeenCalledTimes(1);
    expect(workflow.read().selectedIds).toEqual([1, 2, 3]);
    await workflow.cancelRemoval();
    expect(effects.removal.cancel).toHaveBeenCalledWith("plan-1");
    expect(effects.removal.run).not.toHaveBeenCalled();
    await workflow.prepareRemoval([1]);
    expect(workflow.read().removal.phase).toBe("confirming");
  });

  it("continues off-page, keeps partial results and re-scans the committed root instead of the draft", async () => {
    const { workflow, effects, callbacks } = await removableFixture();
    const completion = deferred<Awaited<ReturnType<typeof effects.removal.run>>>();
    let report!: Parameters<typeof effects.removal.run>[1];
    vi.mocked(effects.removal.run).mockImplementation((_id, progress) => { report = progress; return completion.promise; });
    workflow.setPath("/unsubmitted");
    await workflow.prepareRemoval([1, 2]);
    const run = workflow.confirmRemoval();
    workflow.setVisible(false);
    const item = { id: 1, path: "/test/file-1", status: "failed" as const, message: "permission denied" };
    report({ planId: "plan-1", completed: 1, total: 2, currentPath: null, item });
    await workflow.stopRemoval();
    expect(effects.removal.stop).toHaveBeenCalledWith("plan-1");
    completion.resolve({ results: [item], stopped: true, historyId: "history-1", historyWarning: null }); await run;
    expect(effects.start).toHaveBeenLastCalledWith("/test", expect.any(Function));
    expect(workflow.read().draftPath).toBe("/unsubmitted");
    expect(workflow.read().selectedIds).toEqual([]);
    expect(workflow.read().removal.results).toEqual([item]);
    callbacks[1](diskSummary({ scanId: "scan-2", revision: 1, phase: "stopped", finishedAt: 30 }));
    await vi.waitFor(() => expect(effects.removal.followup).toHaveBeenCalledWith("history-1", "ready", expect.stringContaining("部分结果")));
    expect(effects.removal.locate).toHaveBeenCalledWith("scan-2", "/test");
    report({ planId: "plan-1", completed: 2, total: 2, currentPath: "late", item: { ...item, id: 2 } });
    expect(workflow.read().removal.results).toHaveLength(1);
    expect(workflow.canRemove(diskEntry({ id: 3 }))).toBe(true);
  });

  it("leaves old observations read-only after follow-up failure and never retries removal", async () => {
    const { workflow, effects } = await removableFixture();
    vi.mocked(effects.removal.run).mockResolvedValue({ results: [{ id: 2, path: "/test/file-2", status: "moved", message: null }], stopped: false, historyId: "history-1", historyWarning: null });
    vi.mocked(effects.start).mockRejectedValueOnce("root unavailable");
    await workflow.prepareRemoval([2]); await workflow.confirmRemoval();
    expect(workflow.read().invalidated).not.toBeNull();
    expect(workflow.read().removal.results[0].status).toBe("moved");
    expect(workflow.read().removal.followup).toContain("重新扫描失败");
    expect(diskScanObservationFacts(workflow.read()).invalidated).not.toBeNull();
    await workflow.prepareRemoval([1]);
    expect(effects.removal.run).toHaveBeenCalledTimes(1);
    expect(effects.removal.prepare).toHaveBeenCalledTimes(1);
    expect(effects.removal.followup).toHaveBeenCalledWith("history-1", "failed", "root unavailable");
    await workflow.start();
    expect(workflow.read().summary?.scanId).toBe("scan-2");
    expect(workflow.read().invalidated).toBeNull();
  });

  it("does not start a duplicate run while confirmation is being cancelled", async () => {
    const { workflow, effects } = await removableFixture();
    const cancelled = deferred<void>();
    vi.mocked(effects.removal.cancel).mockReturnValue(cancelled.promise);
    await workflow.prepareRemoval([2]);
    const cancel = workflow.cancelRemoval();
    await workflow.confirmRemoval();
    expect(effects.removal.run).not.toHaveBeenCalled();
    cancelled.resolve(); await cancel;
    expect(workflow.read().removal.phase).toBe("idle");
  });

  it.each(["confirmation", "selection"])("does not restore a directory over a new %s", async (interaction) => {
    const { workflow, effects, callbacks } = await removableFixture();
    const located = deferred<number>();
    vi.mocked(effects.removal.locate).mockReturnValue(located.promise);
    vi.mocked(effects.removal.run).mockResolvedValue({ results: [], stopped: true, historyId: "history-1", historyWarning: null });
    await workflow.prepareRemoval([2]); await workflow.confirmRemoval();
    callbacks[1](diskSummary({ scanId: "scan-2", revision: 1, phase: "completed", finishedAt: 30 }));
    expect(effects.removal.locate).toHaveBeenCalled();
    if (interaction === "confirmation") await workflow.prepareRemoval([3]);
    else workflow.toggleSelected(diskEntry({ id: 3 }));
    located.resolve(1);
    await vi.waitFor(() => expect(effects.removal.followup).toHaveBeenCalled());
    expect(workflow.read().directoryId).toBe(0);
    if (interaction === "confirmation") expect(workflow.read().removal.phase).toBe("confirming");
    else expect(workflow.read().selectedIds).toEqual([3]);
  });

  it("releases an unclaimed confirmation after a rejected run before rescanning", async () => {
    const { workflow, effects } = await removableFixture();
    vi.mocked(effects.removal.run).mockRejectedValue("transport failed");
    await workflow.prepareRemoval([2]); await workflow.confirmRemoval();
    expect(effects.removal.cancel).toHaveBeenCalledWith("plan-1");
    expect(vi.mocked(effects.removal.cancel).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(effects.start).mock.invocationCallOrder[1]);
    expect(workflow.read().summary?.scanId).toBe("scan-2");
    expect(workflow.read().removal.error).toContain("操作结果未完整返回");
    expect(effects.removal.run).toHaveBeenCalledTimes(1);
  });
});

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

async function chartFixture() {
  vi.useFakeTimers();
  const fixtureState = fixture();
  const { effects, workflow } = fixtureState;
  vi.mocked(effects.chart).mockImplementation(async ({ scanId, directoryId }) => diskChart({
    scanId, directory: diskEntry({ id: directoryId }), revision: workflow.read().summary!.revision,
    phase: workflow.read().summary!.phase,
  }));
  workflow.setMode("treemap");
  workflow.setVisible(true);
  await workflow.initialize(); await workflow.start();
  await vi.advanceTimersByTimeAsync(0);
  return fixtureState;
}

describe("disk scan chart browsing", () => {
  it("coalesces progress to one chart read per second without reading list pages", async () => {
    const { effects, callbacks, workflow } = await chartFixture();
    expect(effects.chart).toHaveBeenCalledTimes(1);
    expect(effects.directory).not.toHaveBeenCalled();
    for (let revision = 1; revision <= 3; revision++) {
      callbacks[0](diskSummary({ revision }));
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(workflow.read().chart?.revision).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(workflow.read().chart?.revision).toBe(3);
    expect(effects.chart).toHaveBeenCalledTimes(2);
    workflow.setVisible(false);
  });

  it("keeps one displayed batch during interaction, even when the scan finishes", async () => {
    const { effects, callbacks, workflow } = await chartFixture();
    const shown = workflow.read().chart;
    workflow.setChartPaused(true);
    callbacks[0](diskSummary({ revision: 1, phase: "completed", finishedAt: 10, entries: 400 }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(workflow.read().summary?.phase).toBe("completed");
    expect(workflow.read().chart).toBe(shown);
    expect(workflow.read().chartPending).toBe(true);
    expect(effects.chart).toHaveBeenCalledTimes(1);
    workflow.setChartPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(workflow.read().chart?.phase).toBe("completed");
    expect(workflow.read().chartPending).toBe(false);
    expect(effects.chart).toHaveBeenCalledTimes(2);
    workflow.setVisible(false);
  });

  it("buffers an in-flight read when hovering starts and applies it as one batch", async () => {
    const { effects, callbacks, workflow } = await chartFixture();
    const pending = deferred<DiskScanChart>();
    vi.mocked(effects.chart).mockReturnValueOnce(pending.promise);
    callbacks[0](diskSummary({ revision: 1 }));
    await vi.advanceTimersByTimeAsync(1_000);
    workflow.setChartPaused(true);
    pending.resolve(diskChart({ revision: 1, total: 999, counts: { unmeasured: 10, zero: 20, excluded: 30 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(workflow.read().chart?.total).toBe(4);
    expect(workflow.read().chartPending).toBe(true);
    workflow.setChartPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(workflow.read().chart).toMatchObject({ total: 999, revision: 1, counts: { unmeasured: 10, zero: 20, excluded: 30 } });
    expect(effects.chart).toHaveBeenCalledTimes(2);
    workflow.setVisible(false);
  });

  it("skips an outdated buffered batch when newer results arrive during interaction", async () => {
    const { effects, callbacks, workflow } = await chartFixture();
    const pending = deferred<DiskScanChart>();
    vi.mocked(effects.chart).mockReturnValueOnce(pending.promise);
    callbacks[0](diskSummary({ revision: 1 }));
    await vi.advanceTimersByTimeAsync(1_000);
    workflow.setChartPaused(true);
    pending.resolve(diskChart({ revision: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    callbacks[0](diskSummary({ revision: 2, phase: "completed", finishedAt: 10 }));
    const displayed: number[] = [];
    const unsubscribe = workflow.subscribe(() => displayed.push(workflow.read().chart!.revision));
    workflow.setChartPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(workflow.read().chart).toMatchObject({ revision: 2, phase: "completed" });
    expect(displayed).not.toContain(1);
    expect(effects.chart).toHaveBeenCalledTimes(3);
    unsubscribe();
    workflow.setVisible(false);
  });

  it("navigation clears interaction pause and rejects stale chart responses", async () => {
    const { effects, callbacks, workflow } = await chartFixture();
    const stale = deferred<DiskScanChart>();
    vi.mocked(effects.chart).mockReturnValueOnce(stale.promise);
    callbacks[0](diskSummary({ revision: 1 }));
    await vi.advanceTimersByTimeAsync(1_000);
    workflow.setChartPaused(true);
    workflow.enter(42);
    expect(workflow.read().chart).toBeNull();
    expect(workflow.read().chartPaused).toBe(false);
    stale.resolve(diskChart({ revision: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(workflow.read().chart?.directory.id).toBe(42);
    expect(effects.start).toHaveBeenCalledTimes(1);
    workflow.setVisible(false);
  });

  it("opens current grouped pages and clears the group when changing directory or returning to the chart", async () => {
    const { effects, workflow } = await chartFixture();
    workflow.showGroup("other");
    await vi.advanceTimersByTimeAsync(0);
    expect(effects.directory).toHaveBeenLastCalledWith(expect.objectContaining({ group: "other", limit: 200, directoryId: 0 }));
    workflow.loadMore(); await vi.advanceTimersByTimeAsync(0);
    expect(effects.directory).toHaveBeenLastCalledWith(expect.objectContaining({ group: "other", limit: 400 }));
    workflow.setMode("treemap"); await vi.advanceTimersByTimeAsync(0);
    expect(workflow.read()).toMatchObject({ mode: "treemap", group: "all" });
    workflow.showGroup("unmeasured"); await vi.advanceTimersByTimeAsync(0);
    workflow.enter(1); await vi.advanceTimersByTimeAsync(0);
    expect(workflow.read()).toMatchObject({ directoryId: 1, group: "all", limit: 200 });
    expect(effects.start).toHaveBeenCalledTimes(1);
    workflow.setVisible(false);
  });

  it("keeps view mode when hidden or rescanning and resets it for a new app instance", async () => {
    const { effects, callbacks, workflow } = await chartFixture();
    workflow.setChartPaused(true);
    workflow.setVisible(false);
    callbacks[0](diskSummary({ revision: 1 }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(effects.chart).toHaveBeenCalledTimes(1);
    workflow.setVisible(true); await vi.advanceTimersByTimeAsync(0);
    expect(workflow.read()).toMatchObject({ mode: "treemap", chartPaused: false });
    workflow.enter(1); await vi.advanceTimersByTimeAsync(0);
    workflow.setChartPaused(true);
    await workflow.start(); await vi.advanceTimersByTimeAsync(0);
    expect(workflow.read()).toMatchObject({ mode: "treemap", directoryId: 0, chartPaused: false });
    expect(workflow.read().chart?.scanId).toBe("scan-2");
    expect(createDiskScanWorkflow(effects).read().mode).toBe("list");
    workflow.setVisible(false);
  });

  it("preserves a chart after a read error and recovers through retry", async () => {
    const { effects, callbacks, workflow } = await chartFixture();
    vi.mocked(effects.chart).mockRejectedValueOnce("连接中断");
    callbacks[0](diskSummary({ revision: 1 }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(workflow.read().chart?.revision).toBe(0);
    expect(workflow.read().error).toContain("连接中断");
    await workflow.refreshPage();
    expect(workflow.read().chart?.revision).toBe(1);
    expect(workflow.read().error).toBeNull();
    workflow.setVisible(false);
  });
});
