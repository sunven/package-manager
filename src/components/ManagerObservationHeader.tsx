import { Button } from "../../components/ui/button";
import type { ManagerScanState } from "../managerScanning";
import { scanStateLabel } from "../managerScanning";
import type { ObservationCoverageItem } from "../observationCoverage";
import { ObservationState } from "./ObservationState";

export function ManagerObservationHeader({
  item,
  scanState,
  scanMeta,
  scanning,
  busy,
  onRefresh,
  now,
}: {
  item: ObservationCoverageItem;
  scanState?: ManagerScanState;
  scanMeta: string;
  scanning: boolean;
  busy: boolean;
  onRefresh: () => void;
  now?: number;
}) {
  const phase = scanState?.phase;
  const phaseDetail = phase && phase !== "idle" ? scanStateLabel(scanState) : null;
  const extra = phaseDetail || scanMeta
    ? <span className="flex min-w-0 flex-col gap-0.5">
        {phaseDetail ? <span>{phaseDetail}</span> : null}
        {scanMeta ? <span>{scanMeta}</span> : null}
      </span>
    : null;

  return (
    <div className="mb-3 mt-2 flex flex-wrap items-center justify-between gap-2">
      <ObservationState
        extra={extra}
        item={item}
        live
        now={now}
        showNote={item.status !== "failed" && item.status !== "partial"}
        variant="strip"
      />
      <Button disabled={scanning || busy} onClick={onRefresh} type="button" variant="outline">
        刷新当前管理器
      </Button>
    </div>
  );
}
