import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  ProjectDataCandidate,
  ProjectCleanupResult,
  DirectoryMeasurement,
  ProjectCleanupSettings,
  ProjectDataScan,
  UiMessage,
} from "../types";

const MEASUREMENT_CONCURRENCY = 4;

export function useProjectCleanup() {
  const [settings, setSettings] = useState<ProjectCleanupSettings>({
    rootId: null,
    rootPath: null,
    maxDepth: 8,
  });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [maxDepth, setMaxDepthState] = useState(8);
  const [scan, setScan] = useState<ProjectDataScan | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [pendingMeasurements, setPendingMeasurements] = useState(0);
  const [scanCancelled, setScanCancelled] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cleanupResults, setCleanupResults] = useState<Map<string, ProjectCleanupResult>>(new Map());
  const [cleanupErrors, setCleanupErrors] = useState<Map<string, string>>(new Map());
  const [cancelledCleanupIds, setCancelledCleanupIds] = useState<Set<string>>(new Set());
  const [confirmationIds, setConfirmationIds] = useState<string[] | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupFinished, setCleanupFinished] = useState(false);
  const [activeCleanupId, setActiveCleanupId] = useState<string | null>(null);
  const [cleanupCompletedCount, setCleanupCompletedCount] = useState(0);
  const [cleanupCancelRequested, setCleanupCancelRequested] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const scanRef = useRef<ProjectDataScan | null>(null);
  const scanTokenRef = useRef(0);
  const cleanupCancelRef = useRef(false);

  const replaceScan = useCallback((next: ProjectDataScan | null) => {
    scanRef.current = next;
    setScan(next);
  }, []);

  const updateCandidate = useCallback(
    (scanId: string, candidateId: string, updater: (candidate: ProjectDataCandidate) => ProjectDataCandidate) => {
      setScan((current) => {
        if (!current || current.scanId !== scanId) return current;
        const next = {
          ...current,
          candidates: current.candidates.map((candidate) =>
            candidate.candidateId === candidateId ? updater(candidate) : candidate,
          ),
        };
        scanRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void invoke<ProjectCleanupSettings>("get_project_cleanup_settings")
      .then((loaded) => {
        if (!active) return;
        setSettings(loaded);
        setMaxDepthState(loaded.maxDepth);
      })
      .catch((error) => {
        if (active) setMessage(failureMessage("无法读取项目清理设置", error));
      })
      .finally(() => {
        if (active) setSettingsLoading(false);
      });
    return () => {
      active = false;
      scanTokenRef.current += 1;
    };
  }, []);

  const chooseRoot = useCallback(async () => {
    try {
      const selected = await invoke<ProjectCleanupSettings | null>("choose_project_cleanup_root");
      if (!selected) return;
      scanTokenRef.current += 1;
      setSettings(selected);
      setMaxDepthState(selected.maxDepth);
      replaceScan(null);
      setSelectedIds(new Set());
      setCleanupResults(new Map());
      setCleanupErrors(new Map());
      setCancelledCleanupIds(new Set());
      setPendingMeasurements(0);
      setScanCancelled(false);
      setMessage(null);
    } catch (error) {
      setMessage(failureMessage("无法选择扫描根目录", error));
    }
  }, [replaceScan]);

  const measureCandidates = useCallback(
    async (activeScan: ProjectDataScan, token: number) => {
      const candidates = activeScan.candidates.filter(
        (candidate) => candidate.status === "Ready" || candidate.status === "Unrecognized",
      );
      if (!candidates.length) return;
      let cursor = 0;
      setPendingMeasurements(candidates.length);

      const worker = async () => {
        while (token === scanTokenRef.current) {
          const candidate = candidates[cursor];
          cursor += 1;
          if (!candidate) return;
          try {
            const measurement = await invoke<DirectoryMeasurement>("measure_project_data_candidate", {
              scanId: activeScan.scanId,
              candidateId: candidate.candidateId,
            });
            if (token !== scanTokenRef.current) return;
            updateCandidate(activeScan.scanId, candidate.candidateId, (current) => ({ ...current, measurement }));
          } catch (error) {
            if (token !== scanTokenRef.current) return;
            const measurement: DirectoryMeasurement = {
              status: "Error",
              bytes: null,
              human: null,
              files: 0,
              directories: 0,
              skipped: 0,
              latestModifiedMs: null,
              message: errorText(error),
            };
            updateCandidate(activeScan.scanId, candidate.candidateId, (current) => ({ ...current, measurement }));
          } finally {
            if (token === scanTokenRef.current) {
              setPendingMeasurements((current) => Math.max(0, current - 1));
            }
          }
        }
      };

      const workers = Array.from(
        { length: Math.min(MEASUREMENT_CONCURRENCY, candidates.length) },
        () => worker(),
      );
      await Promise.all(workers);
    },
    [updateCandidate],
  );

  const runScan = useCallback(async () => {
    if (!settings.rootId || discovering || pendingMeasurements > 0) return;
    const token = scanTokenRef.current + 1;
    scanTokenRef.current = token;
    setDiscovering(true);
    setScanCancelled(false);
    setMessage(null);
    setSelectedIds(new Set());
    setCleanupResults(new Map());
    setCleanupErrors(new Map());
    setCancelledCleanupIds(new Set());
    setConfirmationIds(null);
    try {
      const result = await invoke<ProjectDataScan>("scan_project_data", {
        rootId: settings.rootId,
        maxDepth,
      });
      if (token !== scanTokenRef.current) return;
      setSettings((current) => ({ ...current, maxDepth, rootPath: result.rootPath }));
      replaceScan(result);
      setDiscovering(false);
      await measureCandidates(result, token);
    } catch (error) {
      if (token === scanTokenRef.current) {
        setMessage(failureMessage("项目派生数据扫描失败", error));
      }
    } finally {
      if (token === scanTokenRef.current) setDiscovering(false);
    }
  }, [discovering, maxDepth, measureCandidates, pendingMeasurements, replaceScan, settings.rootId]);

  const cancelScan = useCallback(() => {
    scanTokenRef.current += 1;
    setDiscovering(false);
    setPendingMeasurements(0);
    setScanCancelled(true);
  }, []);

  const setMaxDepth = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    setMaxDepthState(Math.max(0, Math.min(32, Math.trunc(value))));
  }, []);

  const toggleSelected = useCallback((candidateId: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(candidateId);
      else next.delete(candidateId);
      return next;
    });
  }, []);

  const selectVisible = useCallback((candidateIds: string[]) => {
    setSelectedIds((current) => new Set([...current, ...candidateIds]));
  }, []);

  const unselectVisible = useCallback((candidateIds: string[]) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      candidateIds.forEach((candidateId) => next.delete(candidateId));
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const requestCleanup = useCallback(() => {
    if (!selectedIds.size) return;
    setConfirmationIds(Array.from(selectedIds));
    setCleanupFinished(false);
    setCleanupCompletedCount(0);
    setCleanupCancelRequested(false);
  }, [selectedIds]);

  const confirmCleanup = useCallback(async () => {
    const activeScan = scanRef.current;
    const ids = confirmationIds;
    if (!activeScan || !ids?.length || cleaning) return;
    setCleaning(true);
    setCleanupFinished(false);
    setCleanupCompletedCount(0);
    setCleanupCancelRequested(false);
    cleanupCancelRef.current = false;
    let completed = 0;
    let succeeded = 0;
    let cleaned = 0;

    for (let index = 0; index < ids.length; index += 1) {
      if (cleanupCancelRef.current) {
        const cancelledIds = ids.slice(index);
        setCancelledCleanupIds((current) => new Set([...current, ...cancelledIds]));
        setSelectedIds((current) => {
          const next = new Set(current);
          cancelledIds.forEach((candidateId) => next.delete(candidateId));
          return next;
        });
        break;
      }
      const candidateId = ids[index];
      setActiveCleanupId(candidateId);
      try {
        const result = await invoke<ProjectCleanupResult>("clean_project_data_candidate", {
          scanId: activeScan.scanId,
          candidateId,
        });
        setCleanupResults((current) => new Map(current).set(candidateId, result));
        updateCandidate(activeScan.scanId, candidateId, (candidate) => ({
          ...candidate,
          measurement: result.measurement,
        }));
        cleaned += result.cleanedBytes;
        if (result.status === "Succeeded" || result.status === "Skipped") succeeded += 1;
      } catch (error) {
        setCleanupErrors((current) => new Map(current).set(candidateId, errorText(error)));
      }
      completed += 1;
      setCleanupCompletedCount(completed);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(candidateId);
        return next;
      });
    }

    setActiveCleanupId(null);
    setCleaning(false);
    setCleanupFinished(true);
    if (cleanupCancelRef.current) {
      toast.warning("项目清理已停止", { description: `已处理 ${completed}/${ids.length} 项` });
    } else if (succeeded === ids.length) {
      toast.success("项目清理完成", { description: `已清理目录占用 ${formatBytes(cleaned)}` });
    } else {
      toast.warning("项目清理部分完成", { description: `已处理 ${completed}/${ids.length} 项` });
    }
  }, [cleaning, confirmationIds, updateCandidate]);

  const cancelCleanup = useCallback(() => {
    if (!cleaning) {
      setConfirmationIds(null);
      return;
    }
    cleanupCancelRef.current = true;
    setCleanupCancelRequested(true);
  }, [cleaning]);

  const closeCleanup = useCallback(() => {
    if (cleaning) return;
    setConfirmationIds(null);
  }, [cleaning]);

  const copyPath = useCallback(async (path: string) => {
    try {
      await writeText(path);
      toast.success("路径已复制");
    } catch (error) {
      setMessage(failureMessage("复制路径失败", error));
    }
  }, []);

  const openRoot = useCallback(async () => {
    if (!settings.rootId) return;
    try {
      await invoke("open_project_cleanup_root", { rootId: settings.rootId });
    } catch (error) {
      setMessage(failureMessage("打开扫描根目录失败", error));
    }
  }, [settings.rootId]);

  const openCandidatePath = useCallback(async (candidateId: string, target: "Project" | "Directory") => {
    const activeScan = scanRef.current;
    if (!activeScan) return;
    try {
      await invoke("open_project_data_path", {
        scanId: activeScan.scanId,
        candidateId,
        target,
      });
    } catch (error) {
      setMessage(failureMessage("打开项目派生数据路径失败", error));
    }
  }, []);

  const confirmationCandidates = useMemo(() => {
    if (!scan || !confirmationIds) return [];
    const idSet = new Set(confirmationIds);
    return scan.candidates.filter((candidate) => idSet.has(candidate.candidateId));
  }, [confirmationIds, scan]);

  return {
    activeCleanupId,
    cancelCleanup,
    cancelScan,
    cancelledCleanupIds,
    chooseRoot,
    cleanupCancelRequested,
    cleanupCompletedCount,
    cleanupErrors,
    cleanupFinished,
    cleanupResults,
    cleaning,
    clearSelection,
    closeCleanup,
    confirmationCandidates,
    confirmationIds,
    confirmCleanup,
    copyPath,
    discovering,
    maxDepth,
    message,
    openCandidatePath,
    openRoot,
    pendingMeasurements,
    requestCleanup,
    runScan,
    scan,
    scanCancelled,
    selectVisible,
    selectedIds,
    setMaxDepth,
    settings,
    settingsLoading,
    toggleSelected,
    unselectVisible,
  };
}

export type ProjectCleanupController = ReturnType<typeof useProjectCleanup>;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function failureMessage(title: string, error: unknown): UiMessage {
  return { tone: "bad", title, message: errorText(error) };
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}
