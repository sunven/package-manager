import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import type { MavenUnusedOutcome, MavenUnusedScan } from "../mavenUnused";

export function useMavenUnused() {
  const [roots, setRoots] = useState<string[]>([]);
  const [referenceMode, setReferenceMode] = useState<"complete" | "available">("complete");
  const [scan, setScan] = useState<MavenUnusedScan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [phase, setPhase] = useState<"idle" | "choosing" | "scanning" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MavenUnusedOutcome | null>(null);
  const running = useRef(false);
  const busy = phase !== "idle";

  function changeRoots(next: string[]) {
    if (running.current) return;
    setRoots([...new Set(next)]);
    setScan(null);
    setSelected(new Set());
    setOutcome(null);
    setError(null);
  }

  function changeReferenceMode(next: "complete" | "available") {
    if (running.current) return;
    setReferenceMode(next);
    setScan(null);
    setSelected(new Set());
    setOutcome(null);
    setError(null);
  }

  async function chooseRoot() {
    if (running.current) return;
    running.current = true;
    setPhase("choosing");
    try {
      const path = await invoke<string | null>("choose_maven_project_directory");
      if (path) {
        setRoots((current) => [...new Set([...current, path])]);
        setScan(null);
        setSelected(new Set());
        setOutcome(null);
        setError(null);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      running.current = false;
      setPhase("idle");
    }
  }

  async function refresh() {
    if (running.current || !roots.length) return;
    running.current = true;
    setPhase("scanning");
    setError(null);
    setScan(null);
    setSelected(new Set());
    setOutcome(null);
    try {
      setScan(await invoke<MavenUnusedScan>("scan_maven_unused_dependencies", { roots, referenceMode }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      running.current = false;
      setPhase("idle");
    }
  }

  function toggle(id: string) {
    if (running.current || !scan || scan.blockers.length || !scan.candidates.some((candidate) => candidate.id === id)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 200) next.add(id);
      return next;
    });
  }

  function selectMany(ids: string[], checked: boolean) {
    if (running.current || !scan || scan.blockers.length) return;
    const allowed = new Set(scan.candidates.map((candidate) => candidate.id));
    const candidates = [...new Set(ids)].filter((id) => allowed.has(id));
    setSelected((current) => {
      const next = new Set(current);
      for (const id of candidates) {
        if (!checked) next.delete(id);
        else if (next.size < 200) next.add(id);
      }
      return next;
    });
  }

  async function remove() {
    if (running.current || !scan || scan.blockers.length || !selected.size) return false;
    running.current = true;
    setPhase("removing");
    setError(null);
    try {
      const result = await invoke<MavenUnusedOutcome>("remove_maven_unused_dependencies", {
        scanId: scan.scanId,
        ids: [...selected],
      });
      setOutcome(result);
      return result.moved > 0;
    } catch (reason) {
      setError(String(reason));
      return false;
    } finally {
      // Every execution requires a new scan, including failures and skipped items.
      setScan(null);
      setSelected(new Set());
      running.current = false;
      setPhase("idle");
    }
  }

  return { roots, referenceMode, scan, selected, phase, busy, error, outcome, chooseRoot, refresh, toggle, selectMany, remove, changeRoots, changeReferenceMode };
}

export type MavenUnusedWorkflow = ReturnType<typeof useMavenUnused>;
