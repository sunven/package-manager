import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorToString } from "../utils/format";

export type NativeInventoryScan = {
  snapshotId: string | null;
  directory: string;
};

export interface NativeInventoryAdapter<Scan extends NativeInventoryScan> {
  retain(previous: Scan | null, next: Scan): Scan;
  revoke(scan: Scan): Scan;
  invalidate(scan: Scan, reason?: string): Scan;
  ready(scan: Scan): boolean;
  message(scan: Scan): string | null;
}

export type NativeInventoryView<Scan, Result> = {
  scan: Omit<Scan, "snapshotId"> | null;
  current: boolean;
  revision: number;
  scanning: boolean;
  error: string | null;
  result: Result | null;
};

type InventoryState<Scan, Result> = {
  scan: Scan | null;
  current: boolean;
  revision: number;
  scanning: boolean;
  error: string | null;
  result: Result | null;
};

export function withoutSnapshot<T extends { snapshotId: string | null }>(scan: T) {
  const { snapshotId: _, ...view } = scan;
  return view;
}

export function useNativeInventory<Scan extends NativeInventoryScan, Result = unknown>({
  command,
  visible,
  autoRead,
  adapter,
}: {
  command: string;
  visible: boolean;
  autoRead: boolean;
  adapter: NativeInventoryAdapter<Scan>;
}) {
  const [state, setState] = useState<InventoryState<Scan, Result>>({
    scan: null,
    current: false,
    revision: 0,
    scanning: false,
    error: null,
    result: null,
  });
  const native = useRef<Scan | null>(null);
  const epoch = useRef(0);
  const attempted = useRef(-1);
  const revision = useRef(0);
  const running = useRef<Promise<Scan | null> | null>(null);
  const isVisible = useRef(visible);
  isVisible.current = visible;

  const invalidate = useCallback((reason?: string) => {
    epoch.current += 1;
    const nextRevision = ++revision.current;
    native.current = native.current ? adapter.invalidate(native.current, reason) : null;
    setState((previous) => ({
      ...previous,
      scan: native.current,
      current: false,
      revision: nextRevision,
    }));
  }, [adapter]);

  const setResult = useCallback((result: Result | null) => {
    setState((previous) => ({ ...previous, result }));
  }, []);

  const clearError = useCallback(() => {
    setState((previous) => previous.error === null ? previous : { ...previous, error: null });
  }, []);

  const read = useCallback(async () => {
    if (running.current) return running.current;
    const nextRevision = ++revision.current;
    setState((previous) => ({ ...previous, scanning: true, current: false, error: null, revision: nextRevision }));
    const task = (async (): Promise<Scan | null> => {
      let scanned: Scan | null = null;
      do {
        const observed = epoch.current;
        attempted.current = observed;
        let next: Scan | null = null;
        let error: string | null = null;
        try {
          next = adapter.retain(native.current, await invoke<Scan>(command));
          if (!adapter.ready(next)) error = adapter.message(next) ?? "清单读取失败，请重新读取。";
        } catch (caught) {
          error = errorToString(caught);
          next = native.current ? adapter.revoke(native.current) : null;
        }
        if (observed !== epoch.current) continue;
        native.current = next;
        const readRevision = ++revision.current;
        setState((previous) => ({
          ...previous,
          scan: next,
          current: !error && next !== null && adapter.ready(next),
          error,
          revision: readRevision,
        }));
        scanned = next;
        break;
      } while (isVisible.current);
      return scanned;
    })();
    running.current = task;
    try {
      return await task;
    } finally {
      running.current = null;
      setState((previous) => ({ ...previous, scanning: false }));
    }
  }, [adapter, command]);

  useEffect(() => {
    if (visible && autoRead && attempted.current !== epoch.current) void read();
  }, [autoRead, read, state.revision, visible]);

  return {
    scan: state.scan,
    view: { ...state, scan: state.scan ? withoutSnapshot(state.scan) : null } as NativeInventoryView<Scan, Result>,
    native,
    revision,
    running,
    needsRead: () => attempted.current !== epoch.current,
    read,
    invalidate,
    setResult,
    clearError,
  };
}
