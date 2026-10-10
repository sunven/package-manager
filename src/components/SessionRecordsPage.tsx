import { Input } from "../../components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { ArrowClockwise as RefreshCw, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { CardContent } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { errorToString, formatBytes, formatHomePath } from "../utils/format";
import {
  bulkRemovalConfirmText,
  bulkRemovalRequest,
  formatSessionActivity,
  removableSessionRecords,
  removalResultText,
  removalReasonLabels,
  filterSessionRecords,
  type SessionFilter,
  type SessionUsageFilter,
  selectedRemovalConfirmText,
  selectedRemovalRequest,
  sessionSections,
  type SessionSort,
  singleRemovalConfirmText,
  type SessionRecord,
  type SessionRecordScan,
  type SessionRemovalResult,
  type SessionSectionView,
  type SessionSourceId,
  type SessionSourceScan,
} from "../sessionRecords";
import { EmptyState, Panel, StatCard } from "./ui";

const sources = [
  { key: "codex" as const, label: "Codex", empty: "没有 Codex 会话记录", fallback: "~/.codex/sessions" },
  { key: "claude" as const, label: "Claude", empty: "没有 Claude 会话记录", fallback: "~/.claude/projects" },
];

type PendingRemoval =
  | { kind: "one"; source: SessionSourceId; id: string; title: string }
  | { kind: "age"; source: SessionSourceId; label: string; days: 7 | 30; count: number }
  | { kind: "selected"; source: SessionSourceId; label: string; records: SessionRecord[] };

const emptySelection: Record<SessionSourceId, string[]> = { codex: [], claude: [] };

export function SessionRecordsPage({
  scan,
  scanningSources,
  error,
  onRefresh,
  onRemove,
  onRemoveOlder,
  onRemoveSelected,
  nowMs = Date.now(),
  initialSource = "codex",
  homeDirectory,
}: {
  scan: SessionRecordScan | null;
  scanningSources: Record<SessionSourceId, boolean>;
  error: string | null;
  onRefresh: (source: SessionSourceId) => void;
  onRemove: (source: SessionSourceId, id: string) => Promise<SessionRemovalResult>;
  onRemoveOlder: (source: SessionSourceId, days: 7 | 30) => Promise<SessionRemovalResult>;
  onRemoveSelected: (source: SessionSourceId, ids: string[]) => Promise<SessionRemovalResult>;
  nowMs?: number;
  initialSource?: SessionSourceId;
  homeDirectory: string | null;
}) {
  const [sorts, setSorts] = useState<Record<SessionSourceId, SessionSort>>({ codex: "time", claude: "time" });
  const [filters, setFilters] = useState<Record<SessionSourceId, SessionFilter>>({ codex: { query: "", usage: "all" }, claude: { query: "", usage: "all" } });
  const sections = useMemo(() => (scan ? sessionSections(scan, sorts, filters) : null), [scan, sorts, filters]);
  const [activeSource, setActiveSource] = useState<SessionSourceId>(initialSource);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  const [removing, setRemoving] = useState(false);
  const [result, setResult] = useState<SessionRemovalResult | null>(null);
  const [resultSource, setResultSource] = useState("");
  const [selectedIds, setSelectedIds] = useState<Record<SessionSourceId, string[]>>(emptySelection);

  useEffect(() => {
    if (!scan) return;
    setSelectedIds((current) => ({
      codex: selectedRemovalRequest(scan.codex.records, current.codex)?.ids ?? [],
      claude: selectedRemovalRequest(scan.claude.records, current.claude)?.ids ?? [],
    }));
  }, [scan]);

  return (
    <main className="view-grid" aria-busy={scanningSources.codex || scanningSources.claude}>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>会话记录读取失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setPending(null);
        }}
      >
        <AlertDialogContent
          className={pending?.kind === "selected" ? "flex max-h-[calc(100dvh-2rem)] flex-col" : undefined}
          onCloseAutoFocus={(event) => {
            const trigger = selectionTrigger.current;
            selectionTrigger.current = null;
            if (trigger && !trigger.disabled) {
              event.preventDefault();
              trigger.focus();
            }
          }}
        >
          <AlertDialogHeader className="shrink-0">
            <AlertDialogTitle>确认移入废纸篓</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "one"
                ? singleRemovalConfirmText(pending.title)
                : pending?.kind === "age"
                  ? bulkRemovalConfirmText(pending.label, pending.days, pending.count)
                  : pending?.kind === "selected"
                    ? selectedRemovalConfirmText(pending.label, pending.records.length)
                    : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pending?.kind === "selected" ? (
            <>
              <ul
                aria-label={`${pending.label} 待移入废纸篓的会话记录`}
                className="min-h-0 max-h-80 divide-y overflow-y-auto overscroll-contain rounded-lg border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                role="list"
                tabIndex={0}
              >
                {pending.records.map((record) => (
                  <li className="min-w-0 px-4 py-3" key={record.id}>
                    <p className="wrap-anywhere text-sm font-medium">{record.title || record.id}</p>
                    <dl className="mt-2 grid gap-1 text-sm">
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-foreground/80">工作目录</dt>
                        <dd className="min-w-0 break-all">
                          {record.workingDirectory ? formatHomePath(record.workingDirectory, homeDirectory) : "没有工作目录"}
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-foreground/80">最后活动时间</dt>
                        <dd>{record.lastActivityMs === null ? "没有最后活动时间" : formatSessionActivity(record.lastActivityMs)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              <p className="shrink-0 text-sm text-foreground/80">清空废纸篓前可恢复记录；移入废纸篓不代表磁盘空间立即释放。</p>
            </>
          ) : null}
          <AlertDialogFooter className="shrink-0">
            <AlertDialogCancel asChild>
              <Button disabled={removing} type="button" variant="outline">
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={removing}
                onClick={(event) => {
                  event.preventDefault();
                  if (!pending) return;
                  const current = pending;
                  setRemoving(true);
                  setResultSource(current.source === "codex" ? "Codex" : "Claude");
                  const action = Promise.resolve().then(() => current.kind === "one"
                    ? onRemove(current.source, current.id)
                    : current.kind === "age"
                      ? onRemoveOlder(current.source, current.days)
                      : onRemoveSelected(current.source, current.records.map((record) => record.id)));
                  void action.then((next) => {
                    if (current.kind === "selected") {
                      const submitted = new Set(current.records.map((record) => record.id));
                      setSelectedIds((existing) => ({
                        ...existing,
                        [current.source]: existing[current.source].filter((id) => !submitted.has(id)),
                      }));
                    }
                    setResult(next);
                  }).catch((error) => {
                    setResult({ moved: 0, failed: 0, skipped: 0, items: [], message: null, operationError: errorToString(error) });
                  }).finally(() => {
                    setPending(null);
                    setRemoving(false);
                  });
                }}
                type="button"
                variant="destructive"
              >
                {removing ? "移入中" : "移入废纸篓"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {result ? (
        <Alert>
          <AlertTitle>{resultSource} · {removalResultText(result)}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {result.operationError ? <p>{result.operationError}</p> : <p>按执行时的实际检查结果汇报；确认时的观察数量可能变化。移入废纸篓不代表磁盘空间立即释放。</p>}
            {result.message ? <p>{result.message}</p> : null}
            {result.items.length ? <details><summary className="cursor-pointer">查看逐条结果（{result.items.length}）</summary><ul className="mt-2 flex max-h-64 flex-col gap-2 overflow-auto">
              {result.items.map((item) => <li key={item.id} className="break-all"><strong>{item.id}</strong> · {item.status === "Moved" ? "已移入废纸篓" : item.reason ? removalReasonLabels[item.reason] : item.status === "Skipped" ? "跳过" : "失败"}{item.message ? ` · ${item.message}` : ""}</li>)}
            </ul></details> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs onValueChange={(value) => setActiveSource(value as SessionSourceId)} value={activeSource}>
        <TabsList className="w-full">
          {sources.map((source) => {
            const count = sections?.[source.key].count;
            return (
              <TabsTrigger key={source.key} value={source.key}>
                {source.label}
                {count === undefined ? null : (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {sources.map((source) => {
          const data = scan?.[source.key];
          const view = sections?.[source.key];
          return (
            <TabsContent key={source.key} value={source.key}>
              <SourceSection
                collapsed={collapsed}
                emptyMessage={view?.totalCount ? "没有匹配搜索和状态筛选的会话记录" : source.empty}
                filter={filters[source.key]}
                onFilterChange={(patch) => {
                  setFilters((current) => ({ ...current, [source.key]: { ...current[source.key], ...patch } }));
                  setSelectedIds((current) => ({ ...current, [source.key]: [] }));
                }}
                fallbackPath={source.fallback}
                homeDirectory={homeDirectory}
                label={source.label}
                nowMs={nowMs}
                onClearSelection={() => {
                  setSelectedIds((current) => ({ ...current, [source.key]: [] }));
                }}
                onRequestAgeRemoval={(days, count) => {
                  setResult(null);
                  setPending({ kind: "age", source: source.key, label: source.label, days, count });
                }}
                onRequestRemoval={(id, title) => {
                  setResult(null);
                  setPending({ kind: "one", source: source.key, id, title });
                }}
                onRequestSelectedRemoval={(records, trigger) => {
                  selectionTrigger.current = trigger;
                  setResult(null);
                  setPending({ kind: "selected", source: source.key, label: source.label, records });
                }}
                onSelectAll={() => {
                  setSelectedIds((current) => ({
                    ...current,
                    [source.key]: removableSessionRecords(filterSessionRecords(data?.records ?? [], filters[source.key])).map((record) => record.id),
                  }));
                }}
                onSetGroupSelected={(records, selected) => {
                  const groupIds = removableSessionRecords(records).map((record) => record.id);
                  setSelectedIds((current) => {
                    const next = new Set(current[source.key]);
                    for (const id of groupIds) {
                      if (selected) next.add(id);
                      else next.delete(id);
                    }
                    return { ...current, [source.key]: [...next] };
                  });
                }}
                onSetRecordSelected={(id, selected) => {
                  setSelectedIds((current) => {
                    const next = new Set(current[source.key]);
                    if (selected) next.add(id);
                    else next.delete(id);
                    return { ...current, [source.key]: [...next] };
                  });
                }}
                onRefresh={() => onRefresh(source.key)}
                onSortChange={(next) => setSorts((current) => ({ ...current, [source.key]: next }))}
                onToggle={(groupKey) => setCollapsed((current) => ({ ...current, [`${source.key}:${groupKey}`]: !current[`${source.key}:${groupKey}`] }))}
                removing={removing}
                scanning={scanningSources[source.key]}
                selectedIds={selectedIds[source.key]}
                sort={sorts[source.key]}
                source={data ?? null}
                sourceKey={source.key}
                view={view ?? null}
              />
            </TabsContent>
          );
        })}
      </Tabs>
    </main>
  );
}

function SourceSection({
  filter,
  onFilterChange,
  source,
  view,
  label,
  emptyMessage,
  fallbackPath,
  homeDirectory,
  collapsed,
  sourceKey,
  onToggle,
  nowMs,
  onSortChange,
  onClearSelection,
  onRequestAgeRemoval,
  onRequestRemoval,
  onRefresh,
  onRequestSelectedRemoval,
  onSelectAll,
  onSetGroupSelected,
  onSetRecordSelected,
  removing,
  scanning,
  selectedIds,
  sort,
}: {
  filter: SessionFilter;
  onFilterChange: (patch: Partial<SessionFilter>) => void;
  source: SessionSourceScan | null;
  view: SessionSectionView | null;
  label: string;
  emptyMessage: string;
  fallbackPath: string;
  homeDirectory: string | null;
  collapsed: Record<string, boolean>;
  sourceKey: string;
  onToggle: (groupKey: string) => void;
  nowMs: number;
  onSortChange: (sort: SessionSort) => void;
  onClearSelection: () => void;
  onRequestAgeRemoval: (days: 7 | 30, count: number) => void;
  onRequestRemoval: (id: string, title: string) => void;
  onRefresh: () => void;
  onRequestSelectedRemoval: (records: SessionRecord[], trigger: HTMLButtonElement) => void;
  onSelectAll: () => void;
  onSetGroupSelected: (records: SessionRecord[], selected: boolean) => void;
  onSetRecordSelected: (id: string, selected: boolean) => void;
  removing: boolean;
  scanning: boolean;
  selectedIds: readonly string[];
  sort: SessionSort;
}) {
  const records = view?.groups.flatMap((group) => group.records) ?? [];
  const removable = removableSessionRecords(records);
  const selected = selectedRemovalRequest(records, selectedIds);
  const selectedCount = selected?.count ?? 0;
  const selectedSet = new Set(selected?.ids ?? []);
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Input disabled={removing} type="search" aria-label={`搜索 ${label} 会话记录`} placeholder="搜索标题或工作目录" value={filter.query} onChange={(event) => onFilterChange({ query: event.target.value })} className="min-w-40 flex-1" />
        <ToggleGroup disabled={removing} type="single" value={filter.usage} onValueChange={(usage) => { if (usage) onFilterChange({ usage: usage as SessionUsageFilter }); }} aria-label={`${label} 使用状态`}>
          <ToggleGroupItem value="all">全部</ToggleGroupItem><ToggleGroupItem value="inUse">使用中</ToggleGroupItem><ToggleGroupItem value="notInUse">未使用中</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">匹配 {view?.count ?? 0} / 来源共 {view?.totalCount ?? 0} 条</span>
      </div>
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <p className="min-w-0 break-all text-xs text-muted-foreground">
          {source ? formatHomePath(source.directory, homeDirectory) : fallbackPath}
        </p>
        <span className="flex shrink-0 gap-2">
          <span aria-label="排序" className="flex gap-1" role="group">
            <Button aria-pressed={sort === "time"} onClick={() => onSortChange("time")} size="sm" type="button" variant={sort === "time" ? "secondary" : "outline"}>
              按时间
            </Button>
            <Button aria-pressed={sort === "size"} onClick={() => onSortChange("size")} size="sm" type="button" variant={sort === "size" ? "secondary" : "outline"}>
              按大小
            </Button>
          </span>
          <Button disabled={scanning || removing} onClick={onRefresh} size="sm" type="button" variant="outline">
            <RefreshCw className={scanning ? "animate-spin" : undefined} data-icon="inline-start" />
            {scanning ? "读取中" : "刷新"}
          </Button>
          {([7, 30] as const).map((days) => {
            const request = bulkRemovalRequest(source?.records ?? [], days, nowMs);
            return (
              <Button
                disabled={scanning || removing || request === null}
                key={days}
                onClick={() => {
                  if (request) onRequestAgeRemoval(request.days, request.count);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {`移除 ${days} 天前（整个 ${label} 来源）`}
              </Button>
            );
          })}
        </span>
      </div>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <StatCard label={`${label} 会话记录`} value={view ? `${view.count} 条` : "—"} />
          <StatCard label="当前结果的记录占用" value={view ? formatBytes(view.bytes) : "—"} />
        </div>
      </CardContent>
      {source?.status === "Failed" && source.message ? (
        <Alert variant="destructive">
          <AlertTitle>{label} 会话记录读取失败</AlertTitle>
          <AlertDescription>{source.message}</AlertDescription>
        </Alert>
      ) : null}
      {source?.status === "Partial" && source.message ? (
        <Alert>
          <AlertTitle>{label} 会话记录不完整</AlertTitle>
          <AlertDescription>{source.message}</AlertDescription>
        </Alert>
      ) : null}
      {view?.empty ? (
        <EmptyState message={emptyMessage} />
      ) : view ? (
        <div className="flex flex-col">
          <div className="flex flex-wrap gap-2 border-b px-4 py-2">
            <Button
              disabled={removing || removable.length === 0 || selectedCount === removable.length}
              onClick={onSelectAll}
              size="sm"
              type="button"
              variant="outline"
            >
              全选当前结果中可移除记录
            </Button>
            <Button disabled={removing || selectedCount === 0} onClick={onClearSelection} size="sm" type="button" variant="outline">
              清空
            </Button>
            <Button
              disabled={removing || selected === null}
              onClick={(event) => {
                if (selected) onRequestSelectedRemoval(records.filter((record) => selectedSet.has(record.id)), event.currentTarget);
              }}
              size="sm"
              type="button"
              variant="destructive"
            >
              {`移入废纸篓 ${selectedCount} 条`}
            </Button>
          </div>
          {view?.groups.map((group) => {
            const collapseKey = `${sourceKey}:${group.key}`;
            const isCollapsed = collapsed[collapseKey] ?? false;
            const groupRemovable = removableSessionRecords(group.records);
            const groupAllSelected = groupRemovable.length > 0 && groupRemovable.every((record) => selectedSet.has(record.id));
            return (
              <section key={collapseKey}>
                <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2">
                  <Checkbox
                    aria-label={`选择${group.label}的可移除会话记录`}
                    checked={groupAllSelected}
                    disabled={removing || groupRemovable.length === 0}
                    onCheckedChange={(checked) => onSetGroupSelected(group.records, checked === true)}
                  />
                  <button
                    aria-expanded={!isCollapsed}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                    onClick={() => onToggle(group.key)}
                    type="button"
                  >
                    <span className="text-sm font-medium">{group.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {group.count} 条 · {formatBytes(group.bytes)}
                    </span>
                  </button>
                </div>
                {isCollapsed ? null : (
                  <ul className="divide-y">
                    {group.records.map((record) => (
                      <li className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_auto]" key={record.id}>
                        <Checkbox
                          aria-label={`选择 ${record.title}`}
                          checked={!record.inUse && selectedSet.has(record.id)}
                          disabled={removing || record.inUse}
                          onCheckedChange={(checked) => onSetRecordSelected(record.id, checked === true)}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{record.title}</span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {record.workingDirectory
                              ? formatHomePath(record.workingDirectory, homeDirectory)
                              : "没有工作目录"}
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                          <span>{record.lastActivityMs === null ? "没有最后活动时间" : formatSessionActivity(record.lastActivityMs)}</span>
                          <span className="font-medium tabular-nums text-foreground">{formatBytes(record.bytes)}</span>
                        </span>
                        <span className="flex items-center justify-end">
                          {record.inUse ? <Badge variant="outline">使用中，暂不移除</Badge> : (
                            <Button
                              aria-label="移入废纸篓"
                              disabled={removing}
                              onClick={() => onRequestRemoval(record.id, record.title)}
                              size="icon-sm"
                              title="移入废纸篓"
                              type="button"
                              variant="outline"
                            >
                              <Trash aria-hidden="true" />
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </Panel>
  );
}
