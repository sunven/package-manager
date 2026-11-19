import { Channel, invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { createDiskScanWorkflow } from "../diskScanWorkflow";
import type { DiskScanSummary } from "../diskScan";
import { recordObservation } from "../observationLedger";

const workflow = createDiskScanWorkflow({
  settings: () => invoke("get_disk_scan_settings"),
  choose: () => invoke("choose_disk_scan_directory"),
  start: (path, progress) => invoke("start_disk_scan", { path, onProgress: new Channel<DiskScanSummary>(progress) }),
  stop: (scanId) => invoke("stop_disk_scan", { scanId }),
  directory: (input) => invoke("read_disk_scan_directory", input),
  observe: recordObservation,
});

export function useDiskScan() {
  const view = useSyncExternalStore(workflow.subscribe, workflow.read, workflow.read);
  useEffect(() => { void workflow.initialize(); }, []);
  return { view, workflow };
}
