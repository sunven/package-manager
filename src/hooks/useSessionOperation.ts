import { useCallback, useEffect, useRef, useState } from "react";
import { bumpHistoryRevision } from "../historyRevision";
import type { SessionRefresh } from "../sessionRecords";
import { errorToString } from "../utils/format";

export type SessionRead<Source extends string, Scan> = {
  scans: Partial<Record<Source, Scan>>;
  failures: Partial<Record<Source, string>>;
  globalError: string | null;
};

export interface SessionOperationAdapter<Source extends string, Scan, Target, Result, Progress = void> {
  observe?(source: Source, scan: Scan | null, failure: string | null, at: number, readFailed: boolean): void;
  read(scopes: readonly Source[], previous: Partial<Record<Source, Scan>>): Promise<SessionRead<Source, Scan>>;
  scopesFor(target: Target): readonly Source[];
  execute(target: Target, report: (progress: Progress) => void): Promise<Result>;
  completedIds(target: Target, result: Result): readonly string[];
  removeCompleted(
    scans: Partial<Record<Source, Scan>>,
    target: Target,
    completedIds: readonly string[],
  ): Partial<Record<Source, Scan>>;
  shouldRefresh(target: Target, result: Result | null): boolean;
  recordFollowUp?(target: Target, result: Result, refresh: SessionRefresh): Promise<void>;
}

export type SessionOperationPhase = "confirming" | "executing" | "refreshing";

export type SessionOperationState<Target, Progress = void> = {
  id: number;
  phase: SessionOperationPhase;
  target: Target;
  progress: Progress | null;
};

export type SessionOperationOutcome<Target, Result> = {
  target: Target;
  result: Result | null;
  error: string | null;
  completedIds: string[];
  refresh: SessionRefresh;
  followUpWarning: string | null;
};

export interface SessionOperationOptions<Source extends string> {
  active: boolean;
  scopes: readonly Source[];
  readOnActivate?: boolean;
}

export interface SessionOperation<Source extends string, Scan, Target, Result, Progress = void> {
  scans: Partial<Record<Source, Scan>>;
  scanning: Partial<Record<Source, boolean>>;
  error: string | null;
  operation: SessionOperationState<Target, Progress> | null;
  outcome: SessionOperationOutcome<Target, Result> | null;
  refresh(scopes: readonly Source[]): Promise<void>;
  begin(target: Target): void;
  cancel(id: number): void;
  confirm(id: number): Promise<void>;
}

function scanningPatch<Source extends string>(
  scopes: readonly Source[],
  value: boolean,
): Partial<Record<Source, boolean>> {
  return Object.fromEntries(scopes.map((scope) => [scope, value])) as Partial<Record<Source, boolean>>;
}

export function useSessionOperation<Source extends string, Scan, Target, Result, Progress = void>(
  adapter: SessionOperationAdapter<Source, Scan, Target, Result, Progress>,
  { active, scopes: initialScopes, readOnActivate = true }: SessionOperationOptions<Source>,
): SessionOperation<Source, Scan, Target, Result, Progress> {
  const [scans, setScans] = useState<Partial<Record<Source, Scan>>>({});
  const [scanning, setScanning] = useState<Partial<Record<Source, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<SessionOperationState<Target, Progress> | null>(null);
  const [outcome, setOutcome] = useState<SessionOperationOutcome<Target, Result> | null>(null);
  const scansRef = useRef<Partial<Record<Source, Scan>>>({});
  const pending = useRef<SessionOperationState<Target, Progress> | null>(null);
  const tickets = useRef<Partial<Record<Source, number>>>({});
  const epoch = useRef(0);
  const sequence = useRef(0);

  function applyScans(next: Partial<Record<Source, Scan>>) {
    scansRef.current = next;
    setScans(next);
  }

  const read = useCallback(async (scopes: readonly Source[]): Promise<SessionRefresh> => {
    const ticket = ++epoch.current;
    for (const scope of scopes) tickets.current[scope] = ticket;
    setScanning((current) => ({ ...current, ...scanningPatch(scopes, true) }));
    setError(null);
    setOutcome((current) => current && adapter.scopesFor(current.target).some((scope) => scopes.includes(scope))
      ? { ...current, refresh: { status: "refreshing", message: null } }
      : current);

    let observed: SessionRead<Source, Scan>;
    try {
      observed = await adapter.read(scopes, scansRef.current);
    } catch (caught) {
      const message = errorToString(caught);
      const at = Date.now();
      for (const scope of scopes) {
        if (tickets.current[scope] !== ticket) continue;
        setScanning((current) => ({ ...current, [scope]: false }));
        adapter.observe?.(scope, scansRef.current[scope] ?? null, message, at, true);
        setOutcome((current) => current && adapter.scopesFor(current.target).includes(scope)
          ? { ...current, refresh: { status: "failed", message } }
          : current);
      }
      if (scopes.every((scope) => tickets.current[scope] === ticket)) setError(message);
      return { status: "failed", message };
    }

    const currentScopes = scopes.filter((scope) => tickets.current[scope] === ticket);
    if (currentScopes.length === scopes.length && observed.globalError) setError(observed.globalError);
    if (currentScopes.length) {
      const next = { ...scansRef.current };
      for (const scope of currentScopes) {
        const scan = observed.scans[scope];
        if (scan !== undefined) next[scope] = scan;
      }
      applyScans(next);
    }
    let firstFailure: string | null = null;
    const at = Date.now();
    for (const scope of scopes) {
      if (tickets.current[scope] !== ticket) continue;
      setScanning((current) => ({ ...current, [scope]: false }));
      const failure = observed.failures[scope] ?? null;
      if (failure && firstFailure === null) firstFailure = failure;
      adapter.observe?.(scope, observed.scans[scope] ?? scansRef.current[scope] ?? null, failure, at, false);
      setOutcome((current) => current && adapter.scopesFor(current.target).includes(scope)
        ? { ...current, refresh: failure ? { status: "failed", message: failure } : { status: "ready", message: null } }
        : current);
    }
    return firstFailure
      ? { status: "failed", message: firstFailure }
      : { status: "ready", message: null };
  }, [adapter]);

  const refresh = useCallback(async (scopes: readonly Source[]) => {
    if (pending.current && pending.current.phase !== "confirming") return;
    await read(scopes);
  }, [read]);

  useEffect(() => {
    if (active && readOnActivate) void refresh(initialScopes);
  }, [active, initialScopes, readOnActivate, refresh]);

  function begin(target: Target) {
    if (pending.current) return;
    const next: SessionOperationState<Target, Progress> = {
      id: ++sequence.current,
      phase: "confirming",
      target: structuredClone(target),
      progress: null,
    };
    pending.current = next;
    setOperation(next);
    setOutcome(null);
  }

  function cancel(id: number) {
    if (!pending.current || pending.current.id !== id || pending.current.phase !== "confirming") return;
    pending.current = null;
    setOperation(null);
  }

  async function confirm(id: number) {
    const approval = pending.current;
    if (!approval || approval.id !== id || approval.phase !== "confirming") return;
    const target = approval.target;
    pending.current = { ...approval, phase: "executing", progress: null };
    setOperation(pending.current);
    const report = (progress: Progress) => {
      const current = pending.current;
      if (!current || current.phase !== "executing") return;
      const next = { ...current, progress };
      pending.current = next;
      setOperation(next);
    };

    const scopes = adapter.scopesFor(target);
    const ticket = ++epoch.current;
    for (const scope of scopes) tickets.current[scope] = ticket;
    setScanning((current) => ({ ...current, ...scanningPatch(scopes, false) }));

    let result: Result | null = null;
    let failure: string | null = null;
    try {
      result = await adapter.execute(target, report);
    } catch (caught) {
      failure = errorToString(caught);
    }
    const completedIds = result ? [...adapter.completedIds(target, result)] : [];
    applyScans(adapter.removeCompleted(scansRef.current, target, completedIds));
    const shouldRefresh = adapter.shouldRefresh(target, result);
    setOutcome({
      target,
      result,
      error: failure,
      completedIds,
      refresh: shouldRefresh ? { status: "refreshing", message: null } : { status: "notRequested", message: null },
      followUpWarning: null,
    });
    let refresh: SessionRefresh = { status: "notRequested", message: null };
    if (shouldRefresh) {
      pending.current = { ...approval, phase: "refreshing" };
      setOperation(pending.current);
      refresh = await read(scopes);
    }
    let followUpWarning: string | null = null;
    if (adapter.recordFollowUp && result) {
      try {
        await adapter.recordFollowUp(target, result, refresh);
      } catch (caught) {
        followUpWarning = errorToString(caught);
      }
    }
    setOutcome((current) => current ? { ...current, refresh, followUpWarning } : current);
    bumpHistoryRevision();
    pending.current = null;
    setOperation(null);
  }

  return { scans, scanning, error, operation, outcome, refresh, begin, cancel, confirm };
}
