import type { ReactNode } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import type { ObservationCoverageItem } from "../observationCoverage";
import {
  coverageStatusLabels,
  coverageStatusPresentation,
  observationBadgeSummary,
  observationCompletenessText,
  observationDetailText,
  observationTimeText,
} from "../observationPresentation";

export type ObservationStateVariant = "row" | "strip" | "badge";
export type ObservationActionKey = "view" | "refresh" | "adjustScope";

export interface ObservationStateAction {
  onClick: () => void;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
}

export interface ObservationStateProps {
  item: ObservationCoverageItem;
  variant?: ObservationStateVariant;
  showNote?: boolean;
  extra?: ReactNode;
  live?: boolean;
  now?: number;
  actions?: Partial<Record<ObservationActionKey, ObservationStateAction>>;
  className?: string;
}

function ObservationStateBadge({
  item,
  now,
  className,
  summary = false,
}: {
  item: ObservationCoverageItem;
  now?: number;
  className?: string;
  summary?: boolean;
}) {
  const presentation = coverageStatusPresentation[item.status];
  return (
    <Badge
      className={cn("status-badge", className)}
      data-observation-item={item.id}
      data-observation-status={item.status}
      data-status={presentation.visualStatus}
      title={summary ? observationBadgeSummary(item, now) : undefined}
      variant={presentation.badgeVariant}
    >
      {coverageStatusLabels[item.status]}
    </Badge>
  );
}

export function ObservationState({
  item,
  variant = "row",
  showNote = true,
  extra,
  live = false,
  now,
  actions,
  className,
}: ObservationStateProps) {
  if (variant === "badge") {
    return <ObservationStateBadge className={className} item={item} now={now} summary />;
  }

  if (variant === "strip") {
    const time = [observationTimeText(item, now), observationCompletenessText(item)]
      .filter(Boolean)
      .join(" · ");
    const detail = observationDetailText(item, {
      compact: true,
      includeNote: showNote,
    });
    return (
      <div
        className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}
        data-observation-item={item.id}
        {...(live ? { role: "status", "aria-live": "polite" } : {})}
      >
        <ObservationStateBadge item={item} now={now} />
        <span>{time}</span>
        {detail ? <span className="[overflow-wrap:anywhere]">{detail}</span> : null}
        {extra}
      </div>
    );
  }

  const detail = observationDetailText(item, { includeNote: showNote });
  const actionNodes = (["view", "refresh", "adjustScope"] as const)
    .map((key) => renderAction(key, actions?.[key], item))
    .filter(Boolean);

  return (
    <div
      className={cn("flex flex-wrap items-start justify-between gap-3 border-t py-3 first:border-t-0", className)}
      data-observation-item={item.id}
    >
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm">{item.label}</strong>
          <ObservationStateBadge item={item} now={now} />
        </div>
        <p className="text-xs text-muted-foreground">{observationTimeText(item, now)}</p>
        {detail ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</p> : null}
        {extra}
      </div>
      {actionNodes.length ? <div className="flex flex-wrap gap-2">{actionNodes}</div> : null}
    </div>
  );
}

function renderAction(
  key: ObservationActionKey,
  action: ObservationStateAction | undefined,
  item: ObservationCoverageItem,
) {
  if (!action || !item.actions[key]) return null;
  if (key === "view" && item.status === "disabled") return null;
  const label = action.label ?? defaultActionLabel(key, item);
  return (
    <Button
      aria-label={action.ariaLabel ?? label}
      disabled={action.disabled}
      key={key}
      onClick={action.onClick}
      size="sm"
      type="button"
      variant={action.variant ?? "outline"}
    >
      {label}
    </Button>
  );
}

function defaultActionLabel(key: ObservationActionKey, item: ObservationCoverageItem) {
  if (key === "view") return "查看";
  if (key === "refresh") return "刷新";
  return item.group === "managers" ? "设置" : "调整范围";
}
