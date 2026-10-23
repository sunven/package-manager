import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MaintenanceHistory, MaintenanceRecord } from "../maintenanceHistory";
import { errorToString } from "../utils/format";

export function useMaintenanceHistory(active: boolean, revision: number) {
  const [history, setHistory] = useState<MaintenanceHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MaintenanceRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const loadedRevision = useRef<number | null>(null);

  const select = useCallback(async (id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    if (!id) {
      setDetailLoading(false);
      return;
    }
    const sequence = ++detailSequence.current;
    setDetailLoading(true);
    try {
      const next = await invoke<MaintenanceRecord>("get_maintenance_record", { id });
      if (sequence === detailSequence.current) setDetail(next);
    } catch (caught) {
      if (sequence === detailSequence.current) setDetailError(errorToString(caught));
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++listSequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await invoke<MaintenanceHistory>("list_maintenance_history");
      if (sequence !== listSequence.current) return;
      setHistory(next);
      if (selectedRef.current && !next.records.some((record) => record.id === selectedRef.current)) {
        selectedRef.current = null;
        setSelectedId(null);
        setDetail(null);
      } else if (selectedRef.current) {
        await select(selectedRef.current);
      }
    } catch (caught) {
      if (sequence === listSequence.current) setError(errorToString(caught));
    } finally {
      if (sequence === listSequence.current) setLoading(false);
    }
  }, [select]);

  useEffect(() => {
    if (!active) return;
    if (loadedRevision.current === revision) return;
    loadedRevision.current = revision;
    void refresh();
  }, [active, revision, refresh]);

  useEffect(() => () => {
    listSequence.current += 1;
    detailSequence.current += 1;
    loadedRevision.current = null;
  }, []);

  return {
    records: history?.records ?? [],
    warnings: history?.warnings ?? [],
    loading,
    error,
    refresh,
    selectedId,
    select,
    detail,
    detailLoading,
    detailError,
  };
}
