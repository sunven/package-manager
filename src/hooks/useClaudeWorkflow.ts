import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeHookRequest } from "../claudeCode";
import { useClaudeCode } from "./useClaudeCode";
import { useClaudeSkills } from "./useClaudeSkills";

export type ClaudeWorkflowState = ReturnType<typeof useClaudeCode> & {
  cancelHookPreview: (previewId?: string) => void;
};

export function useClaudeWorkflow(active: boolean, tab: string) {
  const [skillsBusy, setSkillsBusy] = useState(false);
  const [preparedHookPreview, setPreparedHookPreview] = useState<string | null>(null);
  const preparedHookPreviewRef = useRef<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const code = useClaudeCode(active, tab, skillsBusy);
  const skills = useClaudeSkills(active && tab === "skills", String(code.revision), code.busy && !skillsBusy, code.invalidate);

  // skillsBusy feeds back into useClaudeCode (declared above), so adjust it
  // during render: React re-renders before committing instead of running an
  // extra effect pass after commit.
  const skillsActive = skills.scanning || skills.phase !== null;
  if (skillsActive !== skillsBusy) {
    setSkillsBusy(skillsActive);
  }

  const cancelHookPreview = useCallback((previewId?: string) => {
    if (!preparedHookPreviewRef.current || (previewId && previewId !== preparedHookPreviewRef.current)) return;
    preparedHookPreviewRef.current = null;
    setPreparedHookPreview(null);
  }, []);

  const prepareHook = useCallback(async (request: ClaudeHookRequest) => {
    const preview = await code.prepareHook(request);
    if (activeRef.current) {
      preparedHookPreviewRef.current = preview.previewId;
      setPreparedHookPreview(preview.previewId);
    }
    return preview;
  }, [code.prepareHook]);

  const commitHook = useCallback(async (previewId: string) => {
    try {
      return await code.commitHook(previewId);
    } finally {
      cancelHookPreview(previewId);
    }
  }, [cancelHookPreview, code.commitHook]);

  useEffect(() => {
    if (!active) cancelHookPreview();
  }, [active, cancelHookPreview]);

  const state: ClaudeWorkflowState = { ...code, prepareHook, commitHook, cancelHookPreview };
  return { state, skills, locked: Boolean(code.busy || skills.busy || preparedHookPreview) };
}

export type ClaudeWorkflow = ReturnType<typeof useClaudeWorkflow>;
