import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VscodeStorageScan } from "../vscodeStorage";
import { errorToString } from "../utils/format";

export function useVscodeStorage(active: boolean) {
  const [scan, setScan] = useState<VscodeStorageScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    started.current = true;
    busy.current = true;
    setScanning(true);
    setError(null);
    try {
      setScan(await invoke<VscodeStorageScan>("scan_vscode_storage"));
    } catch (error) {
      setError(errorToString(error));
    } finally {
      busy.current = false;
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (active && !started.current) void refresh();
  }, [active, refresh]);

  return { scan, scanning, error, refresh };
}
