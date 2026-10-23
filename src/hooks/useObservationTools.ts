import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EnvironmentInspection } from "../environmentInspection";
import type { ManagerHistory } from "../managerHistory";
import type { ManagerId } from "../types";
import { recordObservation } from "../observationLedger";
import { errorToString } from "../utils/format";

export function useObservationTools(active: "environment" | "history" | null, managers: ManagerId[], revision: number) {
  const [environment, setEnvironment] = useState<EnvironmentInspection | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [environmentBusy, setEnvironmentBusy] = useState(false);
  const [environmentKey, setEnvironmentKey] = useState("");
  const [historyManager, setHistoryManager] = useState<ManagerId>(managers[0] ?? "Npm");
  const [history, setHistory] = useState<ManagerHistory | null>(null);
  const [historyDataManager, setHistoryDataManager] = useState<ManagerId | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const envAttempt = useRef("");
  const historyAttempt = useRef("");
  const envSequence = useRef(0);
  const historySequence = useRef(0);
  const managerKey = managers.join(",");
  const historyKey = `${historyManager}:${revision}`;
  const refreshEnvironment = useCallback(async () => {
    const sequence = ++envSequence.current;
    envAttempt.current = managerKey;
    setEnvironmentBusy(true); setEnvironmentError(null);
    try {
      const next = await invoke<EnvironmentInspection>("inspect_environment", { managers: managerKey.split(",") });
      if (sequence === envSequence.current) {
        setEnvironment(next);
        setEnvironmentKey(managerKey);
        const partial = next.pathEntries.some((entry) => entry.issue)
          || next.commands.some((command) => command.status === "unknown");
        recordObservation({
          kind: "success",
          itemId: "environment",
          at: next.capturedAt,
          scope: next.scopeKey ?? null,
          scopeLabel: "应用 PATH 与已启用管理器",
          completeness: partial ? "partial" : "complete",
          note: partial ? "部分命令无法完整读取" : null,
        });
      }
    } catch (error) {
      if (sequence === envSequence.current) {
        const message = errorToString(error);
        setEnvironmentError(message);
        recordObservation({
          kind: "attempt",
          itemId: "environment",
          at: Date.now(),
          outcome: "failed",
          scope: null,
          reason: message,
        });
      }
    }
    finally { if (sequence === envSequence.current) setEnvironmentBusy(false); }
  }, [managerKey]);
  const refreshHistory = useCallback(async () => {
    const sequence = ++historySequence.current;
    historyAttempt.current = historyKey;
    setHistoryBusy(true); setHistoryError(null);
    try {
      const next = await invoke<ManagerHistory>("list_manager_history", { manager: historyManager });
      if (sequence === historySequence.current) { setHistory(next); setHistoryDataManager(historyManager); }
    } catch (error) { if (sequence === historySequence.current) setHistoryError(errorToString(error)); }
    finally { if (sequence === historySequence.current) setHistoryBusy(false); }
  }, [historyManager, historyKey]);
  useEffect(() => {
    if (active === "environment" && envAttempt.current !== managerKey) void refreshEnvironment();
    if (active === "history" && historyAttempt.current !== historyKey) void refreshHistory();
  }, [active, managerKey, historyKey, refreshEnvironment, refreshHistory]);
  useEffect(() => () => { envSequence.current += 1; historySequence.current += 1; envAttempt.current = ""; historyAttempt.current = ""; }, []);
  return {
    environment: environmentKey === managerKey ? environment : null, environmentBusy, environmentError, refreshEnvironment,
    history: historyDataManager === historyManager ? history : null, historyBusy, historyError, refreshHistory,
    historyManager, setHistoryManager,
  };
}

export type ObservationToolsState = ReturnType<typeof useObservationTools>;
