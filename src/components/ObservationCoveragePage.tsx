import { useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "../../components/ui/card";
import type {
  ObservationCoverage,
  ObservationCoverageGroup,
  ObservationCoverageItem,
} from "../observationCoverage";
import type { ObservationGroupId } from "../observationItems";
import { ObservationState } from "./ObservationState";
import { StatCard } from "./ui";

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
  return (
    <ObservationState
      actions={{
        view: { onClick: () => onView(item) },
        refresh: { onClick: () => onRefresh(item), disabled: busy || item.status === "inProgress" },
        adjustScope: {
          onClick: () => onAdjustScope(item),
          variant: "ghost",
        },
      }}
      item={item}
      variant="row"
    />
  );
}
