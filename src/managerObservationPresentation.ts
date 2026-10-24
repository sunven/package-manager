import { statusLabels } from "./constants";
import type { CoverageStatus, ObservationCoverageItem } from "./observationCoverage";
import {
  coverageStatusLabels,
  observationCompletenessText,
  observationDetailText,
  observationTimeText,
} from "./observationPresentation";
import type { DisplayStatus, ManagerSnapshot } from "./types";

const TAB_PRESENTATION: Record<CoverageStatus, { status: DisplayStatus; label: string }> = {
  inProgress: { status: "Scanning", label: statusLabels.Scanning },
  disabled: { status: "neutral", label: coverageStatusLabels.disabled },
  unavailable: { status: "Missing", label: statusLabels.Missing },
  failed: { status: "Failed", label: statusLabels.Failed },
  partial: { status: "Partial", label: statusLabels.Partial },
  scopeChanged: { status: "Partial", label: coverageStatusLabels.scopeChanged },
  invalidated: { status: "neutral", label: coverageStatusLabels.invalidated },
  lastObserved: { status: "neutral", label: coverageStatusLabels.lastObserved },
  notObserved: { status: "Not scanned", label: statusLabels["Not scanned"] },
  observed: { status: "Ready", label: statusLabels.Ready },
};

export function managerTabPresentation(
  item: ObservationCoverageItem,
  options: {
    managerName: string;
    snapshot?: ManagerSnapshot;
    scanning: boolean;
    now?: number;
  },
): {
  status: DisplayStatus;
  label: string;
  title: string;
  observationStatus: CoverageStatus;
} {
  const { managerName, snapshot, scanning, now } = options;
  const base = TAB_PRESENTATION[scanning ? "inProgress" : item.status];
  let status = base.status;
  let label = base.label;

  if (!scanning && item.status === "observed") {
    if (snapshot?.status === "Unsupported") {
      status = "Unsupported";
      label = statusLabels.Unsupported;
    } else if (snapshot?.status === "Partial") {
      status = "Partial";
      label = statusLabels.Partial;
    }
  }

  const title = [
    managerName,
    label,
    observationTimeText(item, now),
    observationCompletenessText(item),
    observationDetailText(item, { compact: true }),
  ].filter(Boolean).join(" · ");

  return { status, label, title, observationStatus: item.status };
}
