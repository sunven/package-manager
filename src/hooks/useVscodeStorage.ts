import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  VscodeEditorStatus,
  VscodeRemovalTarget,
  VscodeStorageRemovalProgress,
  VscodeStorageRemovalResult,
  VscodeStorageScan,
} from "../vscodeStorage";
import {
  completedVscodeRemovalIds,
  removeVscodeWorkspaces,
} from "../vscodeRemoval";
import {
  useSessionOperation,
  type SessionOperationAdapter,
  type SessionRead,
} from "./useSessionOperation";

const VSCODE_SCOPES = ["vscode"] as const;
type VscodeScope = (typeof VSCODE_SCOPES)[number];

const adapter: SessionOperationAdapter<
  VscodeScope,
  VscodeStorageScan,
  VscodeRemovalTarget,
  VscodeStorageRemovalResult,
  VscodeStorageRemovalProgress
> = {
  read: async (): Promise<SessionRead<VscodeScope, VscodeStorageScan>> => {
    const scan = await invoke<VscodeStorageScan>("scan_vscode_storage");
    return { scans: { vscode: scan }, failures: {}, globalError: null };
  },
  scopesFor: () => VSCODE_SCOPES,
  execute: (target, report) => {
    const onProgress = new Channel<VscodeStorageRemovalProgress>(report);
    return invoke<VscodeStorageRemovalResult>("remove_vscode_workspace_storage", {
      ids: target.workspaces.map((workspace) => workspace.id),
      confirmedWorkspaces: target.workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        projectPath: workspace.projectPath,
        storagePath: workspace.storagePath,
        kind: workspace.kind,
        projectStatus: workspace.projectStatus,
        removable: workspace.removable,
        removalBlockReason: workspace.removalBlockReason,
        bytes: workspace.usage.bytes,
        usageComplete: workspace.usage.complete,
      })),
      onProgress,
    });
  },
  completedIds: (_target, result) => completedVscodeRemovalIds(result),
  removeCompleted: (scans, _target, completedIds) => {
    const scan = scans.vscode;
    return scan
      ? { ...scans, vscode: removeVscodeWorkspaces(scan, completedIds) }
      : scans;
  },
  shouldRefresh: () => true,
  recordFollowUp: async (_target, result, refresh) => {
    if (!result.historyId) return;
    await invoke("record_maintenance_followup", {
      id: result.historyId,
      status: refresh.status,
      message: refresh.message,
    });
  },
};

export function useVscodeStorage(active: boolean) {
  const {
    scans,
    scanning,
    error,
    operation,
    outcome,
    refresh: refreshOperation,
    begin,
    cancel,
    confirm,
  } = useSessionOperation<
    VscodeScope,
    VscodeStorageScan,
    VscodeRemovalTarget,
    VscodeStorageRemovalResult,
    VscodeStorageRemovalProgress
  >(adapter, { active, scopes: VSCODE_SCOPES, readOnActivate: false });

  const [editorStatus, setEditorStatus] = useState<VscodeEditorStatus | null>(null);
  const [checkingEditor, setCheckingEditor] = useState(false);
  const started = useRef(false);

  const checkEditor = useCallback(async () => {
    setCheckingEditor(true);
    try {
      const status = await invoke<VscodeEditorStatus>("get_vscode_editor_status");
      setEditorStatus(status);
      return status;
    } catch {
      setEditorStatus("Unknown");
      return "Unknown" as const;
    } finally {
      setCheckingEditor(false);
    }
  }, []);

  useEffect(() => {
    if (active) void checkEditor();
  }, [active, checkEditor]);

  const hasOutcome = outcome !== null;
  useEffect(() => {
    if (hasOutcome) void checkEditor();
  }, [hasOutcome, checkEditor]);

  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void refreshOperation(VSCODE_SCOPES);
  }, [active, refreshOperation]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshOperation(VSCODE_SCOPES), checkEditor()]);
  }, [refreshOperation, checkEditor]);

  async function request(target: VscodeRemovalTarget) {
    const status = await checkEditor();
    if (status !== "Stopped") return false;
    begin(target);
    return true;
  }

  return {
    scan: scans.vscode ?? null,
    scanning: scanning.vscode ?? false,
    error,
    refresh,
    operation,
    outcome,
    editorStatus,
    checkingEditor,
    request,
    confirm,
    cancel,
  };
}

export type VscodeStorageWorkflow = ReturnType<typeof useVscodeStorage>;
