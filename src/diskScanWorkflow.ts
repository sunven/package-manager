import { diskRemovalLocked, emptyDiskRemoval, type DiskRemovalEffects, type DiskRemovalView } from "./diskRemoval";
import type { DiskScanEntry, DiskScanChart, DiskScanDirectory, DiskScanGroup, DiskScanMode, DiskScanSettings, DiskScanSummary, DiskScanView } from "./diskScan";
import type { ObservationEvent } from "./observationLedger";
import { errorToString } from "./utils/format";

export interface DiskScanEffects {
  removal: DiskRemovalEffects;
  settings(): Promise<DiskScanSettings>;
  choose(): Promise<string | null>;
  start(path: string, progress: (summary: DiskScanSummary) => void): Promise<DiskScanSummary>;
  stop(scanId: string): Promise<void>;
  directory(input: { scanId: string; directoryId: number; view: number; limit: number; group: DiskScanGroup }): Promise<DiskScanDirectory>;
  chart(input: { scanId: string; directoryId: number }): Promise<DiskScanChart>;
  observe(event: ObservationEvent): void;
}

export function createDiskScanWorkflow(effects: DiskScanEffects) {
  let view: DiskScanView = {
    selectedIds: [], removal: { ...emptyDiskRemoval }, invalidated: null,
    loaded: false, draftPath: "", lastPath: null, summary: null, directoryId: 0, limit: 200, page: null,
    mode: "list", group: "all", chart: null, chartPaused: false, chartPending: false,
    starting: false, stopping: false, picking: false, loading: false, error: null, failure: null, warning: null,
  };
  const listeners = new Set<() => void>();
  let initialization: Promise<void> | null = null;
  let startTicket = 0;
  let navigation = 0;
  let visible = false;
  let reading = false;
  let needsRead = false;
  let directoryError: string | null = null;
  let recordedScan: string | null = null;
  let chartTimer: ReturnType<typeof setTimeout> | null = null;
  let lastChartUpdate = 0;
  let pendingChart: DiskScanChart | null = null;
  let followup: { historyId: string | null; planId: string; restorePath: string; ticket: number; navigation: number } | null = null;
  function patchRemoval(next: Partial<DiskRemovalView>) { patch({ removal: { ...view.removal, ...next } }); }
  function locked() { return diskRemovalLocked(view.removal); }
  function canRemove(entry: DiskScanEntry) {
    return !!view.summary && view.summary.phase !== "running" && !view.starting && !view.invalidated && !locked()
      && entry.id !== 0 && !entry.removalReason && (entry.kind === "file" || entry.kind === "directory");
  }
  function patch(next: Partial<DiskScanView>) {
    view = { ...view, ...next };
    for (const listener of listeners) listener();
  }

  function resetChartUpdates() {
    if (chartTimer !== null) clearTimeout(chartTimer);
    chartTimer = null;
    pendingChart = null;
    lastChartUpdate = 0;
  }

  async function refreshPage() {
    needsRead = true;
    if (reading || !visible || !view.summary) return;
    reading = true;
    while (needsRead && visible && view.summary) {
      if (view.mode === "treemap" && view.chart) {
        if (view.chartPaused) {
          patch({ chartPending: pendingChart !== null || view.summary.revision > view.chart.revision });
          break;
        }
        const delay = 1000 - (Date.now() - lastChartUpdate);
        if (delay > 0) {
          chartTimer ??= setTimeout(() => { chartTimer = null; void refreshPage(); }, delay);
          break;
        }
      }
      if (chartTimer !== null) clearTimeout(chartTimer);
      chartTimer = null;
      needsRead = false;
      const ticket = navigation;
      const scanId: string = view.summary.scanId;
      const mode = view.mode;
      const input = { scanId, directoryId: view.directoryId, view: navigation, limit: view.limit, group: view.group };
      patch({ loading: true });
      try {
        if (mode === "treemap") {
          const buffered = pendingChart;
          pendingChart = null;
          const chart = buffered && buffered.revision >= view.summary.revision
            ? buffered : await effects.chart({ scanId, directoryId: input.directoryId });
          if (ticket === navigation && scanId === view.summary?.scanId) {
            if (view.chartPaused && view.chart) {
              pendingChart = chart;
              patch({ chartPending: true });
            } else {
              lastChartUpdate = Date.now();
              patch({ chart, chartPending: false });
              needsRead ||= chart.revision < view.summary.revision;
            }
            patch({ error: view.error === directoryError ? null : view.error });
            directoryError = null;
          }
        } else {
          const page = await effects.directory(input);
          if (ticket === navigation && scanId === view.summary?.scanId) {
            patch({ page, error: view.error === directoryError ? null : view.error });
            directoryError = null;
          }
        }
      } catch (error) {
        if (ticket === navigation && scanId === view.summary?.scanId) {
          directoryError = `目录记录无法读取：${errorToString(error)}`;
          patch({ error: directoryError });
        }
      }
    }
    reading = false;
    patch({ loading: false });
  }

  function accept(summary: DiskScanSummary, ticket: number) {
    const same = summary.scanId === view.summary?.scanId;
    if (!same && ticket !== startTicket) return;
    if (same && summary.revision <= view.summary!.revision) return;
    if (!same) {
      navigation++;
      resetChartUpdates();
      patch({ summary, selectedIds: [], invalidated: null, lastPath: summary.rootPath, directoryId: 0, limit: 200, page: null, chart: null,
        group: "all", chartPaused: false, chartPending: false, error: null, failure: null, stopping: false });
      if (followup?.ticket === ticket) followup.navigation = navigation;
    } else patch({ summary, stopping: summary.phase === "running" && view.stopping });
    if (summary.finishedAt && recordedScan !== summary.scanId) {
      recordedScan = summary.scanId;
      patch({ failure: null });
      effects.observe({ kind: "success", itemId: "disk-scan", at: summary.finishedAt,
        scope: `disk:${summary.rootPath}`, scopeLabel: summary.rootPath,
        completeness: summary.phase === "completed" ? "complete" : "partial", note: summary.message });
    }
    if (summary.finishedAt && followup?.ticket === ticket) void finishFollowup(summary);
    void refreshPage();
  }

  async function recordFollowup(historyId: string | null, planId: string, status: "ready" | "failed", message: string) {
    if (!historyId) return;
    try { await effects.removal.followup(historyId, status, message); }
    catch (error) {
      if (view.removal.plan?.id === planId) patchRemoval({ historyWarning: `后续读取记录未保存：${errorToString(error)}` });
    }
  }

  async function finishFollowup(summary: DiskScanSummary) {
    const pending = followup;
    if (!pending) return;
    followup = null;
    const message = summary.phase === "completed" ? "已重新扫描" : "重新扫描得到部分结果，可继续查看";
    patchRemoval({ followup: message });
    if (navigation === pending.navigation && view.summary?.scanId === summary.scanId && !locked() && !view.selectedIds.length) {
      try {
        const directoryId = await effects.removal.locate(summary.scanId, pending.restorePath);
        if (navigation === pending.navigation && view.summary?.scanId === summary.scanId
          && startTicket === pending.ticket && !locked() && !view.selectedIds.length) {
          navigation++;
          resetChartUpdates();
          patch({ directoryId, page: null, chart: null });
          void refreshPage();
        }
      } catch { /* The new root remains browsable if the previous directory cannot be located. */ }
    }
    await recordFollowup(pending.historyId, pending.planId, "ready", message);
  }

  async function startScan(path: string, automatic = false) {
    if (view.starting || !view.loaded || !path || locked()) return;
    if (!automatic && followup) {
      const previous = followup;
      followup = null;
      void recordFollowup(previous.historyId, previous.planId, "failed", "后续扫描被新扫描替换");
      patchRemoval({ followup: "后续扫描被新扫描替换" });
    }
    const ticket = ++startTicket;
    if (automatic && followup) followup.ticket = ticket;
    patch({ starting: true, error: null, selectedIds: [] });
    try { accept(await effects.start(path, (summary) => accept(summary, ticket)), ticket); }
    catch (error) {
      const message = errorToString(error);
      patch({ error: message, failure: message });
      effects.observe({ kind: "attempt", itemId: "disk-scan", at: Date.now(), outcome: "failed", scope: `disk:${path}`, reason: message });
      if (automatic && followup?.ticket === ticket) {
        const previous = followup;
        followup = null;
        patchRemoval({ followup: `重新扫描失败：${message}。旧记录仅供查看，请手动重新扫描。` });
        await recordFollowup(previous.historyId, previous.planId, "failed", message);
      }
    } finally { patch({ starting: false }); }
  }

  return {
    read: () => view,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize() {
      initialization ??= (async () => {
        try {
          const settings = await effects.settings();
          patch({ lastPath: settings.lastPath, draftPath: view.draftPath || settings.lastPath || "", warning: settings.warning });
        } catch (error) { patch({ warning: `上次扫描路径无法读取：${errorToString(error)}` }); }
        patch({ loaded: true });
      })();
      return initialization;
    },
    setVisible(next: boolean) {
      visible = next;
      if (next) void refreshPage();
      else {
        if (chartTimer !== null) clearTimeout(chartTimer);
        chartTimer = null;
        patch({ chartPaused: false });
      }
    },
    setMode(mode: DiskScanMode) {
      if (locked() || mode === view.mode) return;
      navigation++;
      resetChartUpdates();
      patch({ mode, group: "all", page: null, chartPaused: false, chartPending: false, error: null });
      void refreshPage();
    },
    showGroup(group: DiskScanGroup) {
      if (locked()) return;
      patch({ selectedIds: [] });
      navigation++;
      resetChartUpdates();
      patch({ mode: "list", group, limit: 200, page: null, chartPaused: false, chartPending: false, error: null });
      void refreshPage();
    },
    setChartPaused(chartPaused: boolean) {
      if (view.mode !== "treemap" || chartPaused === view.chartPaused) return;
      patch({ chartPaused });
      if (!chartPaused && (pendingChart || needsRead)) void refreshPage();
    },
    setPath(draftPath: string) { if (!locked()) patch({ draftPath }); },
    async choose() {
      if (view.picking || locked()) return;
      patch({ picking: true });
      try { const path = await effects.choose(); if (path !== null) patch({ draftPath: path, error: null }); }
      catch (error) { patch({ error: `无法选择目录：${errorToString(error)}` }); }
      finally { patch({ picking: false }); }
    },
    start() { return startScan(view.draftPath); },
    async stop() {
      const summary = view.summary;
      if (summary?.phase !== "running" || view.stopping) return;
      patch({ stopping: true });
      try { await effects.stop(summary.scanId); }
      catch (error) {
        if (view.summary?.scanId === summary.scanId) patch({ error: `无法停止扫描：${errorToString(error)}`, stopping: false });
      }
    },
    enter(directoryId: number) {
      if (locked()) return;
      patch({ selectedIds: [] });
      navigation++;
      resetChartUpdates();
      patch({ directoryId, limit: 200, page: null, chart: null, group: "all", chartPaused: false, chartPending: false, error: null });
      void refreshPage();
    },
    loadMore() { if (locked()) return; patch({ limit: view.limit + 200 }); void refreshPage(); },
    canRemove,
    toggleSelected(entry: DiskScanEntry) {
      if (!canRemove(entry)) return;
      patch({ selectedIds: view.selectedIds.includes(entry.id) ? view.selectedIds.filter((id) => id !== entry.id) : [...view.selectedIds, entry.id] });
    },
    selectDisplayed(selected: boolean) {
      if (locked()) return;
      const ids = view.page?.entries.filter(canRemove).map((entry) => entry.id) ?? [];
      patch({ selectedIds: selected ? [...new Set([...view.selectedIds, ...ids])] : view.selectedIds.filter((id) => !ids.includes(id)) });
    },
    async prepareRemoval(ids: number[]) {
      if (!view.summary || view.summary.phase === "running" || view.starting || view.invalidated || locked() || !ids.length) return;
      patchRemoval({ ...emptyDiskRemoval, phase: "preparing" });
      try {
        const plan = await effects.removal.prepare(view.summary.scanId, [...ids]);
        patchRemoval({ plan, phase: "confirming" });
      } catch (error) { patchRemoval({ phase: "done", error: errorToString(error) }); }
    },
    async cancelRemoval() {
      const { plan, phase, cancelling } = view.removal;
      if (!plan || phase !== "confirming" || cancelling) return;
      patchRemoval({ cancelling: true });
      try { await effects.removal.cancel(plan.id); patchRemoval({ ...emptyDiskRemoval }); }
      catch (error) { patchRemoval({ error: errorToString(error), cancelling: false }); }
    },
    async confirmRemoval() {
      const { plan, phase, cancelling } = view.removal;
      if (!plan || phase !== "confirming" || cancelling) return;
      const page = view.mode === "treemap" ? view.chart : view.page;
      const restorePath = page?.directory.path ?? plan.rootPath;
      patchRemoval({ phase: "running", error: null });
      let historyId: string | null = null;
      try {
        const receipt = await effects.removal.run(plan.id, (event) => {
          if (view.removal.phase !== "running" || event.planId !== view.removal.plan?.id) return;
          const results = event.item && !view.removal.results.some((item) => item.id === event.item!.id)
            ? [...view.removal.results, event.item] : view.removal.results;
          patchRemoval({ results, currentPath: event.currentPath });
        });
        historyId = receipt.historyId;
        patchRemoval({ results: receipt.results, historyWarning: receipt.historyWarning });
      } catch (error) {
        // A rejected call may leave an unclaimed confirmation behind. Cancellation cannot stop a claimed batch.
        try { await effects.removal.cancel(plan.id); } catch { /* The plan may already be consumed. */ }
        patchRemoval({ error: `操作结果未完整返回：${errorToString(error)}。请查看维护历史。` });
      }
      const invalidated = { at: Date.now(), reason: "移除操作后需要重新扫描" };
      patch({ selectedIds: [], invalidated });
      effects.observe({ kind: "invalidate", itemId: "disk-scan", ...invalidated });
      patchRemoval({ phase: "done", currentPath: null, stopping: false, followup: "正在重新扫描…" });
      followup = { historyId, planId: plan.id, restorePath, ticket: 0, navigation };
      await startScan(plan.rootPath, true);
    },
    async stopRemoval() {
      const { plan, phase, stopping } = view.removal;
      if (!plan || phase !== "running" || stopping) return;
      patchRemoval({ stopping: true });
      try { await effects.removal.stop(plan.id); }
      catch (error) { if (view.removal.phase === "running") patchRemoval({ stopping: false, error: errorToString(error) }); }
    },
    refreshPage,
  };
}

export type DiskScanWorkflow = ReturnType<typeof createDiskScanWorkflow>;
