import { useEffect, useState } from "react";
import type { ManagerId } from "../types";
import {
  loadObservationScopes,
  type ObservationScopes,
} from "../observationLedger";
import { errorToString } from "../utils/format";

export function useObservationScopes(enabledManagers: ManagerId[]) {
  const key = enabledManagers.join(",");
  const [scopes, setScopes] = useState<ObservationScopes>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadObservationScopes(enabledManagers)
      .then((next) => {
        if (cancelled) return;
        setScopes(next);
        setError(null);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(errorToString(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { scopes, error };
}
