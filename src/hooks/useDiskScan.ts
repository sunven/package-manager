import { Channel, invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { createDiskScanWorkflow } from "../diskScanWorkflow";
import { bumpHistoryRevision } from "../historyRevision";
import type { DiskRemovalProgress, DiskRemovalReceipt } from "../diskRemoval";
import type { DiskScanSummary } from "../diskScan";
import { recordObservation } from "../observationLedger";

const workflow = createDiskScanWorkflow({
  settings: () => invoke("get_disk_scan_settings"),
  choose: () => invoke("choose_disk_scan_directory"),
  start: (path, progress) => invoke("start_disk_scan", { path, onProgress: new Channel<DiskScanSummary>(progress) }),
  stop: (scanId) => invoke("stop_disk_scan", { scanId }),
  directory: (input) => invoke("read_disk_scan_directory", input),
  chart: (input) => invoke("read_disk_scan_chart", input),
  observe: recordObservation,
  removal: {
    prepare: (scanId, ids) => invoke("prepare_disk_removal", { scanId, ids }),
    cancel: (planId) => invoke("cancel_disk_removal", { planId }),
    run: async (planId, progress) => {
      try { return await invoke<DiskRemovalReceipt>("run_disk_removal", { planId, onProgress: new Channel<DiskRemovalProgress>((event) => { progress(event); bumpHistoryRevision(); }) }); }
      finally { bumpHistoryRevision(); }
    },
    stop: (planId) => invoke("stop_disk_removal", { planId }),
    locate: (scanId, path) => invoke("locate_disk_scan_directory", { scanId, path }),
    followup: async (id, status, message) => { await invoke("record_maintenance_followup", { id, status, message }); bumpHistoryRevision(); },
  },
});

export function useDiskScan() {
  const view = useSyncExternalStore(workflow.subscribe, workflow.read, workflow.read);
  useEffect(() => { void workflow.initialize(); }, []);
  return { view, workflow };
}
