import { useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "../../components/ui/card";
import {
  formatObservationTime,
  type CoverageStatus,
  type ObservationCoverage,
  type ObservationCoverageGroup,
  type ObservationCoverageItem,
} from "../observationCoverage";
import type { ObservationGroupId } from "../observationItems";
import { StatCard } from "./ui";

const statusLabels: Record<CoverageStatus, string> = {
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

const badgeStyles: Record<CoverageStatus, { variant: "default" | "secondary" | "destructive" | "outline"; dataStatus: string }> = {
  observed: { variant: "default", dataStatus: "Ready" },
  partial: { variant: "secondary", dataStatus: "Partial" },
  failed: { variant: "destructive", dataStatus: "Failed" },
  unavailable: { variant: "destructive", dataStatus: "Failed" },
  invalidated: { variant: "secondary", dataStatus: "Partial" },
  scopeChanged: { variant: "secondary", dataStatus: "Partial" },
  inProgress: { variant: "secondary", dataStatus: "Scanning" },
  disabled: { variant: "outline", dataStatus: "neutral" },
  lastObserved: { variant: "outline", dataStatus: "neutral" },
  notObserved: { variant: "outline", dataStatus: "neutral" },
};

const defaultExpanded: Record<ObservationGroupId, boolean> = {
  managers: true,
  environment: true,
  project: true,
  vscode: true,
  sessions: true,
  codex: false,
  claude: false,
};

export function ObservationCoveragePage({
  coverage,
  warnings,
  busy,
  onView,
  onRefresh,
  onRefreshManagers,
  onAdjustScope,
}: {
  coverage: ObservationCoverage;
  warnings: string[];
  busy: boolean;
  onView: (item: ObservationCoverageItem) => void;
  onRefresh: (item: ObservationCoverageItem) => void;
  onRefreshManagers: () => void;
  onAdjustScope: (item: ObservationCoverageItem) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { summary } = coverage;
  const empty = coverage.items.every((item) =>
    !item.lastSuccessAt && !item.lastAttemptAt && item.status !== "inProgress"
  );

  function toggle(group: ObservationGroupId) {
    setExpanded((current) => ({ ...current, [group]: !current[group] }));
  }

  return (
    <main aria-label="观察覆盖度" className="view-grid">
      <div className="grid gap-1">
        <h2 className="text-xl font-medium">观察覆盖度</h2>
        <p className="text-sm text-muted-foreground">这里陈述哪些来源已观察、何时观察、读取是否完整。未观察不代表没有内容。</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="已观察" value={summary.partial ? `${summary.observed}（含部分 ${summary.partial}）` : String(summary.observed)} tone="measurement" />
        <StatCard label="需注意" value={String(summary.attention)} tone="info" />
        <StatCard label="未观察" value={String(summary.notObserved)} />
        <StatCard label="已停用" value={String(summary.disabled)} />
      </div>
      {(summary.failed || summary.unavailable || summary.invalidated || summary.scopeChanged || summary.inProgress)
        ? <p className="text-xs text-muted-foreground">
          {[
            summary.failed ? `读取失败 ${summary.failed}` : null,
            summary.unavailable ? `不可用 ${summary.unavailable}` : null,
            summary.invalidated ? `已失效 ${summary.invalidated}` : null,
            summary.scopeChanged ? `范围变化 ${summary.scopeChanged}` : null,
            summary.inProgress ? `观察中 ${summary.inProgress}` : null,
          ].filter(Boolean).join(" · ")}
        </p>
        : null}

      {warnings.length ? (
        <Alert>
          <AlertTitle>观察台账提示</AlertTitle>
          <AlertDescription className="break-words">{warnings.join("；")}</AlertDescription>
        </Alert>
      ) : null}

      {empty ? <p className="text-sm text-muted-foreground">尚未读取任何来源；进入来源页或使用刷新开始观察。</p> : null}

      <div className="grid gap-4">
        {coverage.groups.map((group) => (
          <CoverageGroup
            key={group.id}
            group={group}
            expanded={expanded[group.id]}
            busy={busy}
            onToggle={() => toggle(group.id)}
            onView={onView}
            onRefresh={onRefresh}
            onRefreshManagers={onRefreshManagers}
            onAdjustScope={onAdjustScope}
          />
        ))}
      </div>
    </main>
  );
}

function CoverageGroup({
  group,
  expanded,
  busy,
  onToggle,
  onView,
  onRefresh,
  onRefreshManagers,
  onAdjustScope,
}: {
  group: ObservationCoverageGroup;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onView: (item: ObservationCoverageItem) => void;
  onRefresh: (item: ObservationCoverageItem) => void;
  onRefreshManagers: () => void;
  onAdjustScope: (item: ObservationCoverageItem) => void;
}) {
  const enabled = group.items.filter((item) => item.status !== "disabled");
  const disabled = group.items.filter((item) => item.status === "disabled");
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-2 border-b py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button aria-expanded={expanded} aria-label={`${expanded ? "收起" : "展开"}${group.label}`} onClick={onToggle} size="sm" type="button" variant="ghost">
              {expanded ? <CaretDown aria-hidden="true" /> : <CaretRight aria-hidden="true" />}
              <span className="text-base font-medium">{group.label}</span>
            </Button>
            {group.id === "managers" ? <span className="text-xs text-muted-foreground">已观察 {group.observedCount} / 已启用 {group.enabledCount}</span> : null}
            {group.disabledCount ? <span className="text-xs text-muted-foreground">{group.disabledCount} 已停用</span> : null}
            {group.attentionCount ? <Badge variant="secondary">需注意 {group.attentionCount}</Badge> : null}
          </div>
          {group.id === "managers" ? (
            <Button disabled={busy} onClick={onRefreshManagers} size="sm" type="button" variant="outline">扫描已启用管理器</Button>
          ) : null}
        </div>
        <CardDescription>
          {group.id === "managers" ? "未扫描不代表没有占用；最近读取失败或部分读取时保留上次结果。" : "范围、完整性和观察时间只代表相应来源的一次读取。"}
        </CardDescription>
      </CardHeader>
      {expanded ? (
        <CardContent className="pt-0">
          {enabled.map((item) => (
            <CoverageRow key={item.id} item={item} busy={busy} onView={onView} onRefresh={onRefresh} onAdjustScope={onAdjustScope} />
          ))}
          {disabled.length ? (
            <div className="mt-3 border-t pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">已停用</p>
              {disabled.map((item) => (
                <CoverageRow key={item.id} item={item} busy={busy} onView={onView} onRefresh={onRefresh} onAdjustScope={onAdjustScope} />
              ))}
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function CoverageRow({
  item,
  busy,
  onView,
  onRefresh,
  onAdjustScope,
}: {
  item: ObservationCoverageItem;
  busy: boolean;
  onView: (item: ObservationCoverageItem) => void;
  onRefresh: (item: ObservationCoverageItem) => void;
  onAdjustScope: (item: ObservationCoverageItem) => void;
}) {
  const style = badgeStyles[item.status];
  const detail = detailText(item);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-t py-3 first:border-t-0" data-observation-item={item.id}>
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm">{item.label}</strong>
          <Badge className="status-badge" data-status={style.dataStatus} variant={style.variant}>
            {statusLabels[item.status]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{timeText(item)}</p>
        {detail ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {item.status !== "disabled" ? (
          <Button onClick={() => onView(item)} size="sm" type="button" variant="outline">查看</Button>
        ) : null}
        {item.actions.refresh ? (
          <Button
            disabled={busy || item.status === "inProgress"}
            onClick={() => onRefresh(item)}
            size="sm"
            type="button"
            variant="outline"
          >
            刷新
          </Button>
        ) : null}
        {item.actions.adjustScope ? (
          <Button onClick={() => onAdjustScope(item)} size="sm" type="button" variant="ghost">
            {item.group === "managers" ? "设置" : "调整范围"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function timeText(item: ObservationCoverageItem) {
  const parts: string[] = [];
  if (item.lastSuccessAt) {
    const prefix = item.status === "lastObserved"
      ? "上次观察于"
      : item.status === "observed" || item.status === "partial"
        ? "观察于"
        : "上次成功于";
    parts.push(`${prefix} ${formatObservationTime(item.lastSuccessAt)}`);
  }
  if (item.lastAttemptAt && item.lastAttemptOutcome !== "succeeded") {
    parts.push(`最近尝试于 ${formatObservationTime(item.lastAttemptAt)}`);
  }
  if (!parts.length) parts.push(item.status === "inProgress" ? "首次读取中" : "尚未读取");
  if (item.status === "lastObserved") parts.push("本次会话尚未读取");
  return parts.join(" · ");
}

function detailText(item: ObservationCoverageItem) {
  const details: string[] = [];
  if (item.scopeChanged) {
    details.push(`范围已变化：上次 ${item.lastSuccessScopeLabel ?? "未知"}；当前 ${item.currentScopeLabel ?? "未知"}`);
  } else if (item.currentScopeLabel) {
    details.push(`范围：${item.currentScopeLabel}`);
  }
  if (item.status === "invalidated" && item.invalidatedAt) {
    details.push(`失效于 ${formatObservationTime(item.invalidatedAt)}${item.invalidatedReason ? `：${item.invalidatedReason}` : ""}`);
  }
  if (item.note && !item.scopeChanged) details.push(item.note);
  if (item.lastAttemptOutcome !== "succeeded" && item.lastAttemptReason && item.status !== "failed" && item.status !== "unavailable") {
    details.push(`最近尝试失败：${item.lastAttemptReason}`);
  }
  if (item.completeness === "partial" && item.status !== "partial") details.push("读取不完整");
  return details.join(" · ");
}
