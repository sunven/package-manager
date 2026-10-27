import { invoke } from "@tauri-apps/api/core";
import type { SessionRefresh } from "./sessionRecords";

export async function recordMaintenanceFollowUp(
  historyId: string,
  refresh: SessionRefresh,
) {
  await invoke("record_maintenance_followup", {
    id: historyId,
    status: refresh.status,
    message: refresh.message,
  });
}
