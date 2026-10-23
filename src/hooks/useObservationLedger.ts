import { useEffect, useSyncExternalStore } from "react";
import {
  getObservationLedgerSnapshot,
  loadObservationLedgerOnce,
  recordObservation,
  subscribeObservationLedger,
} from "../observationLedger";

export function useObservationLedger() {
  const snapshot = useSyncExternalStore(
    subscribeObservationLedger,
    getObservationLedgerSnapshot,
    getObservationLedgerSnapshot,
  );
  useEffect(() => {
    void loadObservationLedgerOnce();
  }, []);
  return { ...snapshot, record: recordObservation };
}
