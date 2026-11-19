import type { DiskScanDirectory, DiskScanSettings, DiskScanSummary, DiskScanView } from "./diskScan";
import type { ObservationEvent } from "./observationLedger";
import { errorToString } from "./utils/format";

export interface DiskScanEffects {
  settings(): Promise<DiskScanSettings>;
  choose(): Promise<string | null>;
  start(path: string, progress: (summary: DiskScanSummary) => void): Promise<DiskScanSummary>;
  stop(scanId: string): Promise<void>;
  directory(input: { scanId: string; directoryId: number; view: number; limit: number }): Promise<DiskScanDirectory>;
  observe(event: ObservationEvent): void;
}

export function createDiskScanWorkflow(effects: DiskScanEffects) {
  let view: DiskScanView = {
    loaded: false, draftPath: "", lastPath: null, summary: null, directoryId: 0, limit: 200, page: null,
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
  function patch(next: Partial<DiskScanView>) {
    view = { ...view, ...next };
    for (const listener of listeners) listener();
  }

  async function refreshPage() {
    needsRead = true;
    if (reading || !visible || !view.summary) return;
    reading = true;
    while (needsRead && visible && view.summary) {
      needsRead = false;
      const ticket = navigation;
      const scanId: string = view.summary.scanId;
      const input = { scanId, directoryId: view.directoryId, view: navigation, limit: view.limit };
      patch({ loading: true });
      try {
        const page = await effects.directory(input);
        if (ticket === navigation && scanId === view.summary?.scanId) {
          patch({ page, error: view.error === directoryError ? null : view.error });
          directoryError = null;
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
      patch({ summary, lastPath: summary.rootPath, directoryId: 0, limit: 200, page: null, error: null, failure: null, stopping: false });
    } else patch({ summary, stopping: summary.phase === "running" && view.stopping });
    if (summary.finishedAt && recordedScan !== summary.scanId) {
      recordedScan = summary.scanId;
      patch({ failure: null });
      effects.observe({ kind: "success", itemId: "disk-scan", at: summary.finishedAt,
        scope: `disk:${summary.rootPath}`, scopeLabel: summary.rootPath,
        completeness: summary.phase === "completed" ? "complete" : "partial", note: summary.message });
    }
    void refreshPage();
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
    setVisible(next: boolean) { visible = next; if (next) void refreshPage(); },
    setPath(draftPath: string) { patch({ draftPath }); },
    async choose() {
      if (view.picking) return;
      patch({ picking: true });
      try { const path = await effects.choose(); if (path !== null) patch({ draftPath: path, error: null }); }
      catch (error) { patch({ error: `无法选择目录：${errorToString(error)}` }); }
      finally { patch({ picking: false }); }
    },
    async start() {
      if (view.starting || !view.loaded || !view.draftPath) return;
      const ticket = ++startTicket;
      const path = view.draftPath;
      patch({ starting: true, error: null });
      try { accept(await effects.start(path, (summary) => accept(summary, ticket)), ticket); }
      catch (error) {
        const message = errorToString(error);
        patch({ error: message, failure: message });
        effects.observe({ kind: "attempt", itemId: "disk-scan", at: Date.now(), outcome: "failed", scope: `disk:${path}`, reason: message });
      } finally { patch({ starting: false }); }
    },
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
      navigation++;
      patch({ directoryId, limit: 200, page: null, error: null });
      void refreshPage();
    },
    loadMore() { patch({ limit: view.limit + 200 }); void refreshPage(); },
    refreshPage,
  };
}

export type DiskScanWorkflow = ReturnType<typeof createDiskScanWorkflow>;
