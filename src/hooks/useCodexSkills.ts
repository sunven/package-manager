import { invoke } from "@tauri-apps/api/core";
import type { SkillIntent, SkillOutcome, SkillPreview, SkillScan } from "../codexSkills";
import { codexObservationFacts, recordObservationFacts } from "../observationFacts";
import { recordObservation } from "../observationLedger";
import { useSkillInventory, type SkillInventoryAdapter } from "./useSkillInventory";

const adapter: SkillInventoryAdapter<SkillScan, SkillIntent, SkillPreview, SkillOutcome> = {
  scan: () => invoke<SkillScan>("scan_codex_skills"),
  prepare: (request, snapshotId) =>
    invoke<SkillPreview>("prepare_codex_skill", { request: { ...request, snapshotId } }),
  cancel: (planId) => invoke("cancel_codex_skill", { planId }),
  commit: (planId) => invoke<SkillOutcome>("commit_codex_skill", { planId }),
  readDetails: (snapshotId, path) => invoke<string>("read_codex_skill", { snapshotId, path }),
  interpretScan: (previous, next) => next.status === "Ready"
    ? { scan: next, usable: true, error: null }
    : {
        scan: previous?.directory === next.directory
          ? { ...next, skills: previous.skills, snapshotId: null }
          : next,
        usable: false,
        error: next.message ?? "技能清单读取失败。",
      },
  unconfirmed: (message) => ({ status: "Partial", message }),
};

export function useCodexSkills(active: boolean, dependency: string, externalBusy = false) {
  return useSkillInventory(adapter, {
    active,
    dependency,
    externalBusy,
    observe: (scan, error, at) => recordObservationFacts(
      "codex:skills",
      codexObservationFacts("skills", { scan, current: !error && scan !== null, scanning: false, error }),
      at,
    ),
    observeInvalidation: (at, reason) => recordObservation({
      kind: "invalidate",
      itemId: "codex:skills",
      at,
      reason: reason ?? "来源已失效",
    }),
  });
}

export type CodexSkills = ReturnType<typeof useCodexSkills>;
