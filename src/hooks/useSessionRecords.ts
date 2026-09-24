import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionRecordScan, SessionRemovalResult, SessionSourceId } from "../sessionRecords";
import { errorToString } from "../utils/format";

export function useSessionRecords(active: boolean) {
  const [scan, setScan] = useState<SessionRecordScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = generation.current + 1;
    generation.current = ticket;
    setScanning(true);
    setError(null);
    try {
      const next = await invoke<SessionRecordScan>("scan_session_records");
      if (generation.current === ticket) setScan(next);
    } catch (caught) {
      if (generation.current === ticket) setError(errorToString(caught));
    } finally {
      if (generation.current === ticket) setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const removeOne = useCallback(async (source: SessionSourceId, id: string) => {
    const result = await invoke<SessionRemovalResult>("remove_session_record", { source, id });
    if (result.moved > 0) {
      setScan((current) => current && {
        ...current,
        [source]: {
          ...current[source],
          records: current[source].records.filter((record) => record.id !== id),
        },
      });
    }
    void refresh();
    return result;
  }, [refresh]);

  const removeOlder = useCallback(async (source: SessionSourceId, days: 7 | 30) => {
    const result = await invoke<SessionRemovalResult>("remove_session_records_older_than", { source, days });
    void refresh();
    return result;
  }, [refresh]);

  const removeSelected = useCallback(async (source: SessionSourceId, ids: string[]) => {
    const result = await invoke<SessionRemovalResult>("remove_session_records", { source, ids });
    void refresh();
    return result;
  }, [refresh]);

  return { scan, scanning, error, refresh, removeOne, removeOlder, removeSelected };
}
