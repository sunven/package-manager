import { invoke } from "@tauri-apps/api/core";
import type { SkillIntent, SkillOutcome, SkillPreview, SkillScan } from "../claudeSkills";
import { useSkillInventory, type SkillInventoryAdapter } from "./useSkillInventory";

const adapter: SkillInventoryAdapter<SkillScan, SkillIntent, SkillPreview, SkillOutcome> = {
  scan: () => invoke<SkillScan>("scan_claude_skills"),
  prepare: (request, snapshotId) =>
    invoke<SkillPreview>("prepare_claude_skill", { request: { ...request, snapshotId } }),
  cancel: (planId) => invoke("cancel_claude_skill", { planId }),
  commit: (planId) => invoke<SkillOutcome>("commit_claude_skill", { planId }),
  readDetails: (snapshotId, path) => invoke<string>("read_claude_skill", { snapshotId, path }),
  interpretScan: (_previous, next) => ({ scan: next, usable: true, error: null }),
  unconfirmed: (message) => ({ status: "Partial", message }),
};

export function useClaudeSkills(active: boolean, dependency: string, externalBusy = false, onMutation?: () => void) {
  return useSkillInventory(adapter, { active, dependency, externalBusy, onMutation });
}

export type ClaudeSkills = ReturnType<typeof useClaudeSkills>;
