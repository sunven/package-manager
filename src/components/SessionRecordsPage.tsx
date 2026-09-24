import { ArrowClockwise as RefreshCw } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
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
import { formatBytes, formatHomePath } from "../utils/format";
import {
  bulkRemovalConfirmText,
  bulkRemovalRequest,
  formatSessionActivity,
  removableSessionRecords,
  removalResultText,
  selectedRemovalConfirmText,
  selectedRemovalRequest,
  sessionSections,
  singleRemovalConfirmText,
  type SessionRecord,
  type SessionRecordScan,
  type SessionRemovalResult,
  type SessionSectionView,
  type SessionSourceId,
  type SessionSourceScan,
} from "../sessionRecords";
import { EmptyState, Panel, PanelHead, StatCard } from "./ui";

const sources = [
  { key: "codex" as const, label: "Codex", empty: "没有 Codex 会话记录", fallback: "~/.codex/sessions" },
  { key: "claude" as const, label: "Claude", empty: "没有 Claude 会话记录", fallback: "~/.claude/projects" },
];

type PendingRemoval =
  | { kind: "one"; source: SessionSourceId; id: string; title: string }
  | { kind: "age"; source: SessionSourceId; label: string; days: 7 | 30; count: number }
  | { kind: "selected"; source: SessionSourceId; label: string; ids: string[]; count: number };

const emptySelection: Record<SessionSourceId, string[]> = { codex: [], claude: [] };

export function SessionRecordsPage({
  scan,
  scanning,
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
  scanning: boolean;
  error: string | null;
  onRefresh: () => void;
  onRemove: (source: SessionSourceId, id: string) => Promise<SessionRemovalResult>;
  onRemoveOlder: (source: SessionSourceId, days: 7 | 30) => Promise<SessionRemovalResult>;
  onRemoveSelected: (source: SessionSourceId, ids: string[]) => Promise<SessionRemovalResult>;
  nowMs?: number;
  initialSource?: SessionSourceId;
  homeDirectory: string | null;
}) {
  const sections = useMemo(() => (scan ? sessionSections(scan) : null), [scan]);
  const [activeSource, setActiveSource] = useState<SessionSourceId>(initialSource);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const [removing, setRemoving] = useState(false);
  const [result, setResult] = useState<SessionRemovalResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<SessionSourceId, string[]>>(emptySelection);

  return (
    <main className="view-grid" aria-busy={scanning}>
      <Panel>
        <PanelHead
          eyebrow="SESSION RECORDS"
          title="会话记录"
          action={
            <Button disabled={scanning} onClick={onRefresh} size="sm" type="button" variant="outline">
              <RefreshCw className={scanning ? "animate-spin" : undefined} data-icon="inline-start" />
              {scanning ? "读取中" : "刷新"}
            </Button>
          }
        />
        <CardContent className="flex flex-col gap-2 p-3">
          <p className="text-sm text-muted-foreground">
            Codex 和 Claude 留在本机的对话文件。这些占用是记录离开原目录后的体积，物理空间要等废纸篓清空才释放。
          </p>
        </CardContent>
      </Panel>

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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移入废纸篓</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "one"
                ? singleRemovalConfirmText(pending.title)
                : pending?.kind === "age"
                  ? bulkRemovalConfirmText(pending.label, pending.days, pending.count)
                  : pending?.kind === "selected"
                    ? selectedRemovalConfirmText(pending.label, pending.count)
                    : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
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
                  const action = current.kind === "one"
                    ? onRemove(current.source, current.id)
                    : current.kind === "age"
                      ? onRemoveOlder(current.source, current.days)
                      : onRemoveSelected(current.source, current.ids);
                  void action.then((next) => {
                    if (current.kind === "selected") {
                      const submitted = new Set(current.ids);
                      setSelectedIds((existing) => ({
                        ...existing,
                        [current.source]: existing[current.source].filter((id) => !submitted.has(id)),
                      }));
                    }
                    setResult(next);
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
          <AlertTitle>{removalResultText(result)}</AlertTitle>
          {result.message ? <AlertDescription>{result.message}</AlertDescription> : null}
        </Alert>
      ) : null}

      <Tabs onValueChange={(value) => setActiveSource(value as SessionSourceId)} value={activeSource}>
        <TabsList>
          {sources.map((source) => {
            const count = sections?.[source.key].count;
            return (
              <TabsTrigger key={source.key} value={source.key}>
                {source.label}
                {count === undefined ? "" : ` ${count}`}
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
                emptyMessage={source.empty}
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
                onRequestSelectedRemoval={(ids, count) => {
                  setResult(null);
                  setPending({ kind: "selected", source: source.key, label: source.label, ids, count });
                }}
                onSelectAll={() => {
                  setSelectedIds((current) => ({
                    ...current,
                    [source.key]: removableSessionRecords(data?.records ?? []).map((record) => record.id),
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
                onToggle={(groupKey) => setCollapsed((current) => ({ ...current, [`${source.key}:${groupKey}`]: !current[`${source.key}:${groupKey}`] }))}
                removing={removing}
                selectedIds={selectedIds[source.key]}
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
  onClearSelection,
  onRequestAgeRemoval,
  onRequestRemoval,
  onRequestSelectedRemoval,
  onSelectAll,
  onSetGroupSelected,
  onSetRecordSelected,
  removing,
  selectedIds,
}: {
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
  onClearSelection: () => void;
  onRequestAgeRemoval: (days: 7 | 30, count: number) => void;
  onRequestRemoval: (id: string, title: string) => void;
  onRequestSelectedRemoval: (ids: string[], count: number) => void;
  onSelectAll: () => void;
  onSetGroupSelected: (records: SessionRecord[], selected: boolean) => void;
  onSetRecordSelected: (id: string, selected: boolean) => void;
  removing: boolean;
  selectedIds: readonly string[];
}) {
  const records = source?.records ?? [];
  const removable = removableSessionRecords(records);
  const selected = selectedRemovalRequest(records, selectedIds);
  const selectedCount = selected?.count ?? 0;
  const selectedSet = new Set(selected?.ids ?? []);
  return (
    <Panel className="overflow-hidden">
      <PanelHead
        eyebrow={label.toUpperCase()}
        title={label}
        action={
          <span className="flex gap-2">
            {([7, 30] as const).map((days) => {
              const request = bulkRemovalRequest(source?.records ?? [], days, nowMs);
              return (
                <Button
                  disabled={removing || request === null}
                  key={days}
                  onClick={() => {
                    if (request) onRequestAgeRemoval(request.days, request.count);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {`移除 ${days} 天前`}
                </Button>
              );
            })}
          </span>
        }
      />
      <CardContent className="flex flex-col gap-2 p-3">
        <p className="break-all text-xs text-muted-foreground">
          {source ? formatHomePath(source.directory, homeDirectory) : fallbackPath}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <StatCard label={`${label} 会话记录`} value={view ? `${view.count} 条` : "—"} />
          <StatCard label="离开原目录的体积" value={view ? formatBytes(view.bytes) : "—"} />
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
              全选可移除
            </Button>
            <Button disabled={removing || selectedCount === 0} onClick={onClearSelection} size="sm" type="button" variant="outline">
              清空
            </Button>
            <Button
              disabled={removing || selected === null}
              onClick={() => {
                if (selected) onRequestSelectedRemoval(selected.ids, selected.count);
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
                        <span className="text-sm text-muted-foreground">
                          {record.lastActivityMs === null ? "没有最后活动时间" : formatSessionActivity(record.lastActivityMs)}
                        </span>
                        <span className="flex items-center justify-end gap-2">
                          {record.inUse ? <Badge variant="outline">使用中，暂不移除</Badge> : (
                            <Button
                              disabled={removing}
                              onClick={() => onRequestRemoval(record.id, record.title)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              移入废纸篓
                            </Button>
                          )}
                          <span className="text-sm font-medium tabular-nums">{formatBytes(record.bytes)}</span>
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
