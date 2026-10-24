import type { CoverageStatus, ObservationCoverageItem } from "./observationCoverage";
import {
  observationCompletenessText,
  observationDetailText,
  observationTimeText,
} from "./observationPresentation";
import type { DisplayStatus, ManagerSnapshot } from "./types";

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
  let status: DisplayStatus;
  let label: string;

  if (scanning || item.status === "inProgress") {
    status = "Scanning";
    label = "扫描中";
  } else if (item.status === "disabled") {
    status = "neutral";
    label = "已停用";
  } else if (item.status === "unavailable") {
    status = "Missing";
    label = "未安装";
  } else if (item.status === "failed") {
    status = "Failed";
    label = "失败";
  } else if (item.status === "partial") {
    status = "Partial";
    label = "部分可用";
  } else if (item.status === "scopeChanged") {
    status = "Partial";
    label = "范围已变化";
  } else if (item.status === "invalidated") {
    status = "neutral";
    label = "已失效";
  } else if (item.status === "lastObserved") {
    status = "neutral";
    label = "上次观察";
  } else if (item.status === "notObserved") {
    status = "Not scanned";
    label = "未扫描";
  } else if (snapshot?.status === "Unsupported") {
    status = "Unsupported";
    label = "不支持";
  } else if (snapshot?.status === "Partial") {
    status = "Partial";
    label = "部分可用";
  } else {
    status = "Ready";
    label = "就绪";
  }

  const title = [
    managerName,
    label,
    observationTimeText(item, now),
    observationCompletenessText(item),
    observationDetailText(item, { includeScope: false, includeCompleteness: false }),
  ].filter(Boolean).join(" · ");

  return { status, label, title, observationStatus: item.status };
}
