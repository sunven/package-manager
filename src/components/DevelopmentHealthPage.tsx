import type { LucideIcon } from "lucide-react";
import { Activity, ArrowRight, Boxes, HardDrive, ShieldAlert, Wrench } from "lucide-react";
import type { DevelopmentHealthSummary, HealthRecommendation, HealthTone } from "../developmentHealth";
import type { ManagerId } from "../types";
import { formatBytes, formatHomePath, managerLabel, pathLabel } from "../utils/format";
import { Button } from "../../components/ui/button";
import { EmptyState, Panel, PanelHead, StatusBadge } from "./ui";

export function DevelopmentHealthPage({
  health,
  homeDirectory,
  onOpenManager,
}: {
  health: DevelopmentHealthSummary;
  homeDirectory: string | null;
  onOpenManager: (managerId: ManagerId) => void;
}) {
  const signalCount = health.riskSignalCount + health.reviewSignalCount;

  return (
    <main className="mt-5 grid gap-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile
          detail={`${health.readyManagerCount} 个就绪`}
          icon={Activity}
          label="已扫描工具"
          value={`${health.scannedManagerCount}/${health.enabledManagerCount}`}
        />
        <MetricTile
          detail={`${health.totalPackages} 个资产条目`}
          icon={Boxes}
          label="开发资产"
          value={formatBytes(health.totalBytes)}
        />
        <MetricTile
          detail="缓存 / dry-run / reclaimable"
          icon={Wrench}
          label="维护候选空间"
          value={formatBytes(health.maintenanceBytes)}
        />
        <MetricTile
          detail={`${health.riskSignalCount} 风险 · ${health.reviewSignalCount} 复核`}
          icon={ShieldAlert}
          label="信号"
          value={String(signalCount)}
        />
        <MetricTile
          detail={`${health.scanIssueCount} 个扫描异常`}
          icon={HardDrive}
          label="优先建议"
          value={String(health.recommendations.length)}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Panel className="overflow-hidden">
          <PanelHead
            action={<span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{health.recommendations.length} 项</span>}
            eyebrow="体检"
            title="优先建议"
          />
          {health.recommendations.length ? (
            <div className="divide-y">
              {health.recommendations.map((recommendation) => (
                <RecommendationRow key={recommendation.id} recommendation={recommendation} onOpenManager={onOpenManager} />
              ))}
            </div>
          ) : (
            <EmptyState message={health.scannedManagerCount ? "当前没有优先建议" : "尚未完成体检"} />
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead
            action={<span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{formatBytes(health.totalBytes)}</span>}
            eyebrow="空间"
            title="最大占用"
          />
          {health.topStorage.length ? (
            <div className="divide-y">
              {health.topStorage.map((item) => (
                <button
                  className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 text-left hover:bg-muted/60"
                  key={`${item.managerId}-${item.path}`}
                  onClick={() => onOpenManager(item.managerId)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{pathLabel(item.label)}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{managerLabel(item.managerId)} · {formatHomePath(item.path, homeDirectory)}</span>
                  </span>
                  <span className="text-sm font-medium tabular-nums">{formatBytes(item.bytes)}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState message={health.scannedManagerCount ? "尚未得到空间统计结果" : "尚未扫描开发资产"} />
          )}
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Panel className="overflow-hidden">
          <PanelHead
            action={<span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{signalCount} 个</span>}
            eyebrow="风险"
            title="信号分布"
          />
          {health.signalGroups.length ? (
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {health.signalGroups.map((group) => (
                <div className="rounded-md border bg-background p-3" key={group.key}>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{group.label}</span>
                    <ToneBadge tone={group.tone} />
                  </div>
                  <strong className="mt-2 block text-2xl font-medium leading-7 tabular-nums">{group.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message={health.scannedManagerCount ? "未发现风险或复核信号" : "尚未扫描信号"} />
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead
            action={<span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{health.enabledManagerCount} 个</span>}
            eyebrow="工具"
            title="扫描状态"
          />
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {health.managerStatuses.map((manager) => (
              <button
                className="grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-background px-3 py-2 text-left hover:bg-muted/60"
                key={manager.managerId}
                onClick={() => onOpenManager(manager.managerId)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{managerLabel(manager.managerId)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{manager.packageCount} 个资产条目</span>
                </span>
                <StatusBadge className="shrink-0" status={manager.status} />
              </button>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}

function MetricTile({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-28 min-w-0 grid-rows-[auto_1fr] rounded-md border bg-card p-4 shadow-sm">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-3 min-w-0 self-end">
        <strong className="block truncate text-2xl font-medium leading-8 tabular-nums">{value}</strong>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{detail}</span>
      </div>
    </div>
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
    <div className="grid min-w-0 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ToneBadge tone={recommendation.tone} />
          <span className="text-xs font-medium text-muted-foreground">{managerLabel(recommendation.managerId)}</span>
          {recommendation.bytes ? <span className="text-xs font-medium text-muted-foreground">{formatBytes(recommendation.bytes)}</span> : null}
          {recommendation.count ? <span className="text-xs font-medium text-muted-foreground">{recommendation.count} 项</span> : null}
        </div>
        <p className="mt-2 truncate text-sm font-medium">{recommendation.title}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{recommendation.detail}</p>
      </div>
      {/* Navigates only. Execution stays on the manager tab, beside the cache
          path and its measured size — the figures that justify confirming. */}
      <Button
        aria-label={`查看 ${managerLabel(recommendation.managerId)}：${recommendation.title}`}
        className="w-full sm:w-auto"
        onClick={() => onOpenManager(recommendation.managerId)}
        size="sm"
        type="button"
        variant="outline"
      >
        <ArrowRight data-icon="inline-start" />
        查看
      </Button>
    </div>
  );
}

function ToneBadge({ tone }: { tone: HealthTone }) {
  const config = {
    risk: "border-destructive/40 bg-destructive/10 text-destructive",
    review: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    safe: "border-primary/40 bg-primary/10 text-primary",
  }[tone];
  const label = tone === "risk" ? "风险" : tone === "review" ? "复核" : "维护";

  return (
    <span className={`inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs font-medium ${config}`}>
      {label}
    </span>
  );
}
