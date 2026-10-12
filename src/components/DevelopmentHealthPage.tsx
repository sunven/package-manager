import { ArrowRight } from "@phosphor-icons/react";
import type { DevelopmentHealthSummary, HealthRecommendation, HealthTone } from "../developmentHealth";
import type { ManagerId } from "../types";
import { formatBytes, managerLabel } from "../utils/format";
import { Button } from "../../components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { EmptyState } from "./ui";

export function DevelopmentHealthPage({
  health,
  onOpenManager,
}: {
  health: DevelopmentHealthSummary;
  homeDirectory: string | null;
  onOpenManager: (managerId: ManagerId) => void;
}) {
  return (
    <Card aria-label="优先建议" className="gap-4 py-4" role="region">
      <CardHeader className="px-4">
        <CardTitle aria-level={3} role="heading">优先建议</CardTitle>
        <CardAction className="text-xs text-muted-foreground">{health.recommendations.length} 项</CardAction>
      </CardHeader>
      <CardContent className="px-4">
        {health.recommendations.length ? (
          <div className="studio-recs">
            {health.recommendations.map((recommendation) => (
              <RecommendationRow key={recommendation.id} onOpenManager={onOpenManager} recommendation={recommendation} />
            ))}
          </div>
        ) : (
          <EmptyState message={health.scannedManagerCount ? "当前没有优先建议" : "尚未完成体检"} />
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationRow({
  onOpenManager,
  recommendation,
}: {
  onOpenManager: (managerId: ManagerId) => void;
  recommendation: HealthRecommendation;
}) {
  return (
    <div className="studio-rec" data-tone={recommendation.tone}>
      <div>
        <div className="studio-rec-meta">
          <ToneBadge tone={recommendation.tone} />
          <span>{managerLabel(recommendation.managerId)}</span>
          {recommendation.space ? <span>{recommendation.space.label} {recommendation.space.value}</span> : null}
          {recommendation.bytes ? <span>{formatBytes(recommendation.bytes)}</span> : null}
          {recommendation.count ? <span>{recommendation.count} 项</span> : null}
        </div>
        <p>{recommendation.title}</p>
      </div>
      {/* Navigates only. Execution stays on the manager tab, beside the cache
          path and its measured size — the figures that justify confirming. */}
      <Button
        aria-label={`查看 ${managerLabel(recommendation.managerId)}：${recommendation.title}`}
        onClick={() => onOpenManager(recommendation.managerId)}
        size="sm"
        type="button"
        variant="outline"
      >
        <ArrowRight data-icon="inline-start" />
        查看
      </Button>
      <small>{recommendation.detail}</small>
    </div>
  );
}

function ToneBadge({ tone }: { tone: HealthTone }) {
  const config = {
    risk: "tone-risk",
    review: "tone-review",
    safe: "tone-safe",
  }[tone];
  const label = tone === "risk" ? "扫描异常" : tone === "review" ? "复核" : "维护";

  return <span className={`studio-tone ${config}`}>{label}</span>;
}
