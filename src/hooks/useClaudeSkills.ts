import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillIntent, SkillOutcome, SkillPreview, SkillScan } from "../claudeSkills";
import { errorToString } from "../utils/format";

export function useClaudeSkills(active: boolean, dependency: string, externalBusy = false, onMutation?: () => void) {
  const [scan, setScan] = useState<SkillScan | null>(null);
  const [current, setCurrent] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [phase, setPhase] = useState<"preparing" | "confirming" | "executing" | null>(null);
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SkillOutcome | null>(null);
  const native = useRef<SkillScan | null>(null);
  const pending = useRef<SkillPreview | "preparing" | "executing" | null>(null);
  const valid = useRef(false);
  const generation = useRef(0);
  const attempted = useRef(-1);
  const running = useRef(false);
  const [revision, setRevision] = useState(0);

  const read = useCallback(async () => {
    if (running.current) return;
    running.current = true; valid.current = false; setCurrent(false); setScanning(true); setError(null);
    const epoch = generation.current; attempted.current = epoch;
    try {
      const next = await invoke<SkillScan>("scan_claude_skills");
      if (epoch !== generation.current) return;
      native.current = next; valid.current = true; setScan(next); setCurrent(true);
    } catch (caught) { if (epoch === generation.current) setError(errorToString(caught)); }
    finally { running.current = false; setScanning(false); setRevision((value) => value + 1); }
  }, []);

  useEffect(() => {
    generation.current += 1; valid.current = false; setCurrent(false); setRevision((value) => value + 1);
    if (pending.current && typeof pending.current !== "string") {
      void invoke("cancel_claude_skill", { planId: pending.current.planId }).catch(() => undefined);
      pending.current = null; setPreview(null); setPhase(null);
    }
  }, [dependency]);
  useEffect(() => {
    if (active && !externalBusy && !pending.current && attempted.current !== generation.current) void read();
  }, [active, externalBusy, revision, phase, read]);

  async function request(intent: SkillIntent) {
    if (pending.current || running.current || externalBusy || !valid.current || !native.current?.snapshotId) return "清单已过期或正在维护，请刷新后重试。";
    pending.current = "preparing"; setPhase("preparing"); setResult(null);
    const epoch = generation.current;
    try {
      const next = await invoke<SkillPreview>("prepare_claude_skill", { request: { ...intent, snapshotId: native.current.snapshotId } });
      if (epoch !== generation.current) {
        await invoke("cancel_claude_skill", { planId: next.planId }); pending.current = null; setPhase(null); return "清单已变化，请重新检查。";
      }
      pending.current = next; setPreview(next); setPhase("confirming"); return null;
    } catch (caught) { pending.current = null; setPhase(null); return errorToString(caught); }
  }
  function cancel() {
    if (!pending.current || typeof pending.current === "string") return;
    void invoke("cancel_claude_skill", { planId: pending.current.planId }).catch(() => undefined);
    pending.current = null; setPreview(null); setPhase(null);
  }
  async function confirm() {
    if (!pending.current || typeof pending.current === "string") return null;
    const selected = pending.current; pending.current = "executing"; setPhase("executing"); valid.current = false; setCurrent(false);
    let outcome: SkillOutcome;
    try { outcome = await invoke<SkillOutcome>("commit_claude_skill", { planId: selected.planId }); }
    catch (caught) { outcome = { status: "Partial", message: "操作结果未完整确认：" + errorToString(caught) + "。请核对清单，勿直接重复执行。" }; }
    setResult(outcome); onMutation?.(); generation.current += 1; await read();
    pending.current = null; setPreview(null); setPhase(null); return outcome;
  }
  async function details(path: string) {
    if (!valid.current || !native.current?.snapshotId) throw new Error("清单已过期，请刷新后查看说明。");
    return invoke<string>("read_claude_skill", { snapshotId: native.current.snapshotId, path });
  }
  return { scan, current, scanning, phase, preview, error, result, revision, busy: externalBusy || scanning || phase !== null,
    request, cancel, confirm, details, refresh: async () => { if (!pending.current && !externalBusy) await read(); } };
}
export type ClaudeSkills = ReturnType<typeof useClaudeSkills>;
