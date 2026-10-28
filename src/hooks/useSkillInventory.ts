import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorToString } from "../utils/format";

export type SkillInventoryPhase = "preparing" | "confirming" | "executing";

type InventorySource = {
  snapshotId: string | null;
  directory: string;
};

type InventoryPreview = {
  planId: string;
};

export type InterpretedInventory<Scan> = {
  scan: Scan;
  usable: boolean;
  error: string | null;
};

export interface SkillInventoryAdapter<
  Scan extends InventorySource,
  Intent,
  Preview extends InventoryPreview,
  Outcome,
> {
  scan(): Promise<Scan>;
  prepare(intent: Intent, snapshotId: string): Promise<Preview>;
  cancel(planId: string): Promise<unknown>;
  commit(planId: string): Promise<Outcome>;
  readDetails(snapshotId: string, path: string): Promise<string>;
  interpretScan(previous: Scan | null, next: Scan): InterpretedInventory<Scan>;
  unconfirmed(message: string): Outcome;
}

export interface SkillInventoryOptions<Scan = { snapshotId: string | null; directory: string }> {
  active: boolean;
  dependency: string;
  externalBusy?: boolean;
  onMutation?: () => void;
  observe?: (scan: Scan | null, error: string | null, at: number) => void;
  observeInvalidation?: (at: number, reason: string) => void;
}

export interface SkillInventory<Scan, Intent, Preview, Outcome> {
  scan: Scan | null;
  current: boolean;
  scanning: boolean;
  phase: SkillInventoryPhase | null;
  preview: Preview | null;
  error: string | null;
  result: Outcome | null;
  revision: number;
  busy: boolean;
  request(intent: Intent): Promise<string | null>;
  cancel(): void;
  confirm(): Promise<Outcome | null>;
  details(path: string): Promise<string>;
  refresh(): Promise<void>;
}

export function useSkillInventory<
  Scan extends InventorySource,
  Intent,
  Preview extends InventoryPreview,
  Outcome,
>(
  adapter: SkillInventoryAdapter<Scan, Intent, Preview, Outcome>,
  { active, dependency, externalBusy = false, onMutation, observe, observeInvalidation }: SkillInventoryOptions<Scan>,
): SkillInventory<Scan, Intent, Preview, Outcome> {
  const observeRef = useRef(observe);
  observeRef.current = observe;
  const observeInvalidationRef = useRef(observeInvalidation);
  observeInvalidationRef.current = observeInvalidation;
  const observedDependency = useRef<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [current, setCurrent] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [phase, setPhase] = useState<SkillInventoryPhase | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [revision, setRevision] = useState(0);
  const native = useRef<Scan | null>(null);
  const pending = useRef<Preview | "preparing" | "executing" | null>(null);
  const valid = useRef(false);
  const generation = useRef(0);
  const attempted = useRef(-1);
  const running = useRef(false);
  const mutation = useRef(onMutation);
  mutation.current = onMutation;

  const read = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    valid.current = false;
    setCurrent(false);
    setScanning(true);
    setError(null);
    const epoch = generation.current;
    attempted.current = epoch;
    try {
      const next = await adapter.scan();
      if (epoch !== generation.current) return;
      const interpreted = adapter.interpretScan(native.current, next);
      native.current = interpreted.scan;
      valid.current = interpreted.usable;
      setScan(interpreted.scan);
      setCurrent(interpreted.usable);
      setError(interpreted.error);
      observeRef.current?.(interpreted.scan, interpreted.error, Date.now());
    } catch (caught) {
      if (epoch === generation.current) {
        const message = errorToString(caught);
        setError(message);
        observeRef.current?.(native.current, message, Date.now());
      }
    } finally {
      running.current = false;
      setScanning(false);
      setRevision((value) => value + 1);
    }
  }, [adapter]);

  // Adapters are module-level constants; changing identity is a source change.
  useEffect(() => {
    const changed = observedDependency.current !== null && observedDependency.current !== dependency;
    observedDependency.current = dependency;
    generation.current += 1;
    valid.current = false;
    setCurrent(false);
    setRevision((value) => value + 1);
    if (changed && native.current) observeInvalidationRef.current?.(Date.now(), "来源依赖已变化");
    if (pending.current && typeof pending.current !== "string") {
      const planId = pending.current.planId;
      try { void adapter.cancel(planId).catch(() => undefined); } catch { /* cancellation is best-effort */ }
      pending.current = null;
      setPreview(null);
      setPhase(null);
    }
  }, [adapter, dependency]);

  useEffect(() => {
    if (active && !externalBusy && !pending.current && attempted.current !== generation.current) void read();
  }, [active, externalBusy, revision, phase, read]);

  const request = useCallback(async (intent: Intent) => {
    const snapshotId = native.current?.snapshotId;
    if (pending.current || running.current || externalBusy || !valid.current || !snapshotId) {
      return "清单已过期或正在维护，请刷新后重试。";
    }
    pending.current = "preparing";
    setPhase("preparing");
    setResult(null);
    const epoch = generation.current;
    try {
      const next = await adapter.prepare(intent, snapshotId);
      if (epoch !== generation.current) {
        await adapter.cancel(next.planId);
        pending.current = null;
        setPhase(null);
        return "清单已变化，请重新检查。";
      }
      pending.current = next;
      setPreview(next);
      setPhase("confirming");
      return null;
    } catch (caught) {
      pending.current = null;
      setPhase(null);
      return errorToString(caught);
    }
  }, [adapter, externalBusy]);

  const cancel = useCallback(() => {
    if (!pending.current || typeof pending.current === "string") return;
    const planId = pending.current.planId;
    try { void adapter.cancel(planId).catch(() => undefined); } catch { /* cancellation is best-effort */ }
    pending.current = null;
    setPreview(null);
    setPhase(null);
  }, [adapter]);

  const confirm = useCallback(async () => {
    if (!pending.current || typeof pending.current === "string") return null;
    const selected = pending.current;
    pending.current = "executing";
    setPhase("executing");
    valid.current = false;
    setCurrent(false);
    let outcome: Outcome;
    try {
      outcome = await adapter.commit(selected.planId);
    } catch (caught) {
      outcome = adapter.unconfirmed(
        "操作结果未完整确认：" + errorToString(caught) + "。请核对清单，勿直接重复执行。",
      );
    }
    setResult(outcome);
    mutation.current?.();
    generation.current += 1;
    await read();
    pending.current = null;
    setPreview(null);
    setPhase(null);
    return outcome;
  }, [adapter, read]);

  const details = useCallback(async (path: string) => {
    const snapshotId = native.current?.snapshotId;
    if (!valid.current || !snapshotId) throw new Error("清单已过期，请刷新后查看说明。");
    return adapter.readDetails(snapshotId, path);
  }, [adapter]);

  const refresh = useCallback(async () => {
    if (!pending.current && !externalBusy) await read();
  }, [externalBusy, read]);

  const busy = externalBusy || scanning || phase !== null;

  // Stable identity between state updates: App uses this object as a memo
  // dependency for observation coverage facts.
  return useMemo(() => ({
    scan,
    current,
    scanning,
    phase,
    preview,
    error,
    result,
    revision,
    busy,
    request,
    cancel,
    confirm,
    details,
    refresh,
  }), [
    scan, current, scanning, phase, preview, error, result, revision, busy,
    request, cancel, confirm, details, refresh,
  ]);
}
