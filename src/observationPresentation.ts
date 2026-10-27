import {
  formatObservationTime,
  type CoverageStatus,
  type ObservationCoverageItem,
} from "./observationCoverage";

export const coverageStatusLabels: Record<CoverageStatus, string> = {
  disabled: "已停用",
  inProgress: "观察中",
  invalidated: "已失效",
  scopeChanged: "范围已变化",
  failed: "读取失败",
  unavailable: "不可用",
  observed: "已观察",
  partial: "部分",
  lastObserved: "上次观察",
  notObserved: "未观察",
};

export const coverageStatusPresentation: Record<CoverageStatus, {
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
  visualStatus: "Ready" | "Partial" | "Failed" | "Scanning" | "neutral";
}> = {
  observed: { badgeVariant: "default", visualStatus: "Ready" },
  partial: { badgeVariant: "secondary", visualStatus: "Partial" },
  failed: { badgeVariant: "destructive", visualStatus: "Failed" },
  unavailable: { badgeVariant: "destructive", visualStatus: "Failed" },
  invalidated: { badgeVariant: "secondary", visualStatus: "Partial" },
  scopeChanged: { badgeVariant: "secondary", visualStatus: "Partial" },
  inProgress: { badgeVariant: "secondary", visualStatus: "Scanning" },
  disabled: { badgeVariant: "outline", visualStatus: "neutral" },
  lastObserved: { badgeVariant: "outline", visualStatus: "neutral" },
  notObserved: { badgeVariant: "outline", visualStatus: "neutral" },
};

const CURRENT_OBSERVATIONS: CoverageStatus[] = ["observed", "partial", "lastObserved", "inProgress"];

export function observationTimeText(item: ObservationCoverageItem, now?: number) {
  const parts: string[] = [];
  if (item.lastSuccessAt) {
    const prefix = item.status === "lastObserved"
      ? "上次观察于"
      : item.status === "observed" || item.status === "partial"
        ? "观察于"
        : "上次成功于";
    parts.push(`${prefix} ${formatObservationTime(item.lastSuccessAt, now)}`);
  }
  if (item.lastAttemptAt && item.lastAttemptOutcome !== "succeeded") {
    parts.push(`最近尝试于 ${formatObservationTime(item.lastAttemptAt, now)}`);
  }
  if (!parts.length) {
    if (item.status === "inProgress") {
      parts.push("首次读取中");
    } else if (item.status === "observed" || item.status === "partial" || item.status === "lastObserved") {
      parts.push("观察时间未知");
    } else {
      parts.push("尚未读取");
    }
  }
  if (item.status === "lastObserved") parts.push("本次会话尚未读取");
  return parts.join(" · ");
}

export function observationCompletenessText(item: ObservationCoverageItem) {
  if (!CURRENT_OBSERVATIONS.includes(item.status)) return null;
  if (item.completeness === "complete") return "读取完整";
  if (item.completeness === "partial") return "读取不完整";
  return null;
}

export function observationDetailText(
  item: ObservationCoverageItem,
  options: { compact?: boolean; includeNote?: boolean } = {},
) {
  const { compact = false, includeNote = true } = options;
  const details: string[] = [];
  if (item.scopeChanged) {
    details.push(`范围已变化：上次 ${item.lastSuccessScopeLabel ?? "未知"}；当前 ${item.currentScopeLabel ?? "未知"}`);
  } else if (!compact && item.currentScopeLabel) {
    details.push(`范围：${item.currentScopeLabel}`);
  }
  if (item.status === "invalidated" && item.invalidatedAt) {
    details.push(`失效于 ${formatObservationTime(item.invalidatedAt)}${item.invalidatedReason ? `：${item.invalidatedReason}` : ""}`);
  }
  if (includeNote && item.note && !item.scopeChanged) details.push(item.note);
  if (
    includeNote
    && item.lastAttemptOutcome !== "succeeded"
    && item.lastAttemptReason
    && item.status !== "failed"
    && item.status !== "unavailable"
  ) {
    details.push(`最近尝试失败：${item.lastAttemptReason}`);
  }
  if (!compact && item.completeness === "partial" && item.status !== "partial") {
    details.push("读取不完整");
  }
  return details.join(" · ");
}

export function observationBadgeSummary(item: ObservationCoverageItem, now?: number) {
  return [
    item.label,
    coverageStatusLabels[item.status],
    observationTimeText(item, now),
    observationCompletenessText(item),
    observationDetailText(item),
  ].filter(Boolean).join(" · ");
}
