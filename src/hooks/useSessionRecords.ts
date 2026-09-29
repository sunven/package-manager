import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionRecordScan, SessionRemovalResult, SessionSourceId, SessionSourceScan } from "../sessionRecords";
import { errorToString } from "../utils/format";

const idleScanning: Record<SessionSourceId, boolean> = { codex: false, claude: false };

export function useSessionRecords(active: boolean) {
  const [scan, setScan] = useState<SessionRecordScan | null>(null);
  const [scanningSources, setScanningSources] = useState(idleScanning);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const sourceEpoch = useRef<Record<SessionSourceId, number>>({ codex: 0, claude: 0 });

  const refresh = useCallback(async (source?: SessionSourceId) => {
    if (source) {
      const ticket = sourceEpoch.current[source] + 1;
      sourceEpoch.current[source] = ticket;
      setScanningSources((current) => ({ ...current, [source]: true }));
      try {
        const next = await invoke<SessionSourceScan>("scan_session_source", { source });
        if (sourceEpoch.current[source] === ticket) {
          setScan((current) => ({
            codex: source === "codex" ? next : current?.codex ?? emptySource(),
            claude: source === "claude" ? next : current?.claude ?? emptySource(),
          }));
        }
      } catch (caught) {
        if (sourceEpoch.current[source] === ticket) {
          const message = errorToString(caught);
          setScan((current) => current && {
            ...current,
            [source]: { ...(current[source]), status: "Failed", message },
          });
        }
      } finally {
        if (sourceEpoch.current[source] === ticket) {
          setScanningSources((current) => ({ ...current, [source]: false }));
        }
      }
      return;
    }

    const ticket = epoch.current + 1;
    epoch.current = ticket;
    sourceEpoch.current = { codex: ticket, claude: ticket };
    setScanningSources({ codex: true, claude: true });
    setError(null);
    try {
      const next = await invoke<SessionRecordScan>("scan_session_records");
      setScan((current) => ({
        codex: sourceEpoch.current.codex === ticket ? next.codex : current?.codex ?? next.codex,
        claude: sourceEpoch.current.claude === ticket ? next.claude : current?.claude ?? next.claude,
      }));
    } catch (caught) {
      if (epoch.current === ticket) setError(errorToString(caught));
    } finally {
      setScanningSources((current) => ({
        codex: sourceEpoch.current.codex === ticket ? false : current.codex,
        claude: sourceEpoch.current.claude === ticket ? false : current.claude,
      }));
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
    void refresh(source);
    return result;
  }, [refresh]);

  const removeOlder = useCallback(async (source: SessionSourceId, days: 7 | 30) => {
    const result = await invoke<SessionRemovalResult>("remove_session_records_older_than", { source, days });
    void refresh(source);
    return result;
  }, [refresh]);

  const removeSelected = useCallback(async (source: SessionSourceId, ids: string[]) => {
    const result = await invoke<SessionRemovalResult>("remove_session_records", { source, ids });
    void refresh(source);
    return result;
  }, [refresh]);

  return { scan, scanningSources, error, refresh, removeOne, removeOlder, removeSelected };
}

function emptySource(): SessionSourceScan {
  return { directory: "", status: "Missing", records: [], message: null };
}
