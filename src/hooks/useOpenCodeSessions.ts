import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenCodeDeletionResult, OpenCodeSessionScan } from "../sessionRecords";
import { errorToString } from "../utils/format";

export function useOpenCodeSessions(active: boolean) {
  const [scan, setScan] = useState<OpenCodeSessionScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = epoch.current + 1;
    epoch.current = ticket;
    setScanning(true);
    setError(null);
    try {
      const next = await invoke<OpenCodeSessionScan>("scan_opencode_sessions");
      if (epoch.current === ticket) setScan(next);
    } catch (caught) {
      if (epoch.current === ticket) setError(errorToString(caught));
    } finally {
      if (epoch.current === ticket) setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const openSession = useCallback(async (sessionId: string) => {
    try {
      await invoke("open_opencode_session", { sessionId });
      return null;
    } catch (caught) {
      return errorToString(caught);
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await invoke("delete_opencode_session", { sessionId });
      return null;
    } catch (caught) {
      return errorToString(caught);
    }
  }, []);

  const deleteSessions = useCallback(async (sessionIds: string[]) => {
    try {
      return await invoke<OpenCodeDeletionResult>("delete_opencode_sessions", { sessionIds });
    } catch (caught) {
      throw new Error(errorToString(caught));
    }
  }, []);

  return { scan, scanning, error, refresh, openSession, deleteSession, deleteSessions };
}
