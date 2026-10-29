import { Input } from "../../components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { ArrowClockwise as RefreshCw, ArrowSquareOut, CaretDown, CaretRight, Trash } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
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
  ageRemovalRequest,
  bulkRemovalConfirmText,
  formatSessionActivity,
  formatSessionRecordId,
  removableSessionRecords,
  removalProgressBreakdown,
  removalProgressText,
  removalResultText,
  removalReasonLabels,
  filterSessionRecords,
  type SessionFilter,
  filterOpenCodeSessions,
  groupOpenCodeSessions,
  type OpenCodeSessionFilter,
  type OpenCodeSessionRecord,
  type OpenCodeSessionScan,
  type OpenCodeSessionSort,
  type SessionUsageFilter,
  selectedRemovalConfirmText,
  selectedRemovalRequest,
  sessionSections,
  type SessionSort,
  singleRemovalConfirmText,
  type SessionRecord,
  type SessionSectionView,
  type SessionSourceId,
  type SessionSourceScan,
} from "../sessionRecords";
import type { useSessionRecords } from "../hooks/useSessionRecords";
import type { useOpenCodeSessions } from "../hooks/useOpenCodeSessions";
import { useSessionSelection } from "../hooks/useSessionSelection";
import type { ObservationCoverageItem } from "../observationCoverage";
import { relativeObservationTime } from "../observationCoverage";
import { ObservationState } from "./ObservationState";
import { EmptyState, Panel, RefreshNotice, StatCard } from "./ui";

const sources = [
  { key: "codex" as const, label: "Codex", empty: "没有 Codex 会话记录", fallback: "~/.codex/sessions" },
  { key: "claude" as const, label: "Claude", empty: "没有 Claude 会话记录", fallback: "~/.claude/projects" },
  { key: "grok" as const, label: "Grok Build", empty: "没有 Grok Build 会话记录", fallback: "~/.grok/sessions" },
  { key: "qoder" as const, label: "Qoder（国际版）", empty: "没有 Qoder 会话记录", fallback: "~/.qoder/projects" },
  { key: "qoder-cn" as const, label: "Qoder CN（国内版）", empty: "没有 Qoder CN 会话记录", fallback: "~/.qoder-cn/projects" },
];

function openableSource(key: SessionSourceId) {
  return key === "grok" || key === "qoder" || key === "qoder-cn";
}

const selectableSession = (record: SessionRecord) => !record.inUse;
const selectableOpenCode = () => true;

export function SessionRecordsPage({
  records,
  openCode,
  nowMs,
  initialSource = "codex",
  homeDirectory,
  coverageItems,
  onShowHistory,
}: {
  records: ReturnType<typeof useSessionRecords>;
  openCode: ReturnType<typeof useOpenCodeSessions>;
  nowMs?: number;
  initialSource?: SessionSourceId | "opencode";
  homeDirectory: string | null;
  coverageItems: Record<SessionSourceId | "opencode", ObservationCoverageItem>;
  onShowHistory?: (recordId: string) => void;
}) {
  const { scan, scanningSources, error, refresh: onRefresh } = records;
  const {
    scan: openCodeScan,
    scanning: openCodeScanning,
    preparing: openCodePreparing,
    prepareError: openCodePrepareError,
    error: openCodeError,
  } = openCode;
  // Age cut-offs follow the latest scan instead of drifting on every render.
  const currentTime = useMemo(() => nowMs ?? Date.now(), [nowMs, scan]);
  const pending = records.operation?.phase !== "refreshing" ? records.operation?.target ?? null : null;
  const removing = records.operation !== null && records.operation.phase !== "confirming";
  const removalProgress = records.operation?.phase === "executing" ? records.operation.progress : null;
  const showRemovalProgress = removalProgress !== null && (removalProgress.phase === "preparing" || removalProgress.total > 0);
  const removalProgressValue = removalProgress && removalProgress.phase !== "preparing"
    ? removalProgress.phase === "started" ? 0 : removalProgress.processed
    : 0;
  const removalProgressPercent = removalProgress && removalProgress.phase !== "preparing" && removalProgress.total > 0
    ? (removalProgressValue / removalProgress.total) * 100
    : 0;
  const removalProgressDetail = removalProgress ? removalProgressBreakdown(removalProgress) : null;
  const result = records.outcome?.result;
  const resultSource = sources.find((source) => source.key === records.outcome?.source)?.label ?? "会话记录";
  const removalSource = records.outcome?.source;
  const pendingOpenCodeDelete = openCode.operation?.phase !== "refreshing" ? openCode.operation?.target ?? null : null;
  const deletingOpenCodeId = openCode.operation && openCode.operation.phase !== "confirming"
    ? openCode.operation.target.roots[0]?.id ?? null
    : null;
  const openCodeDeleteResult = openCode.outcome;
  const [sorts, setSorts] = useState<Record<SessionSourceId, SessionSort>>({ codex: "time", claude: "time", grok: "time", qoder: "time", "qoder-cn": "time" });
  const [filters, setFilters] = useState<Record<SessionSourceId, SessionFilter>>({ codex: { query: "", usage: "all" }, claude: { query: "", usage: "all" }, grok: { query: "", usage: "all" }, qoder: { query: "", usage: "all" }, "qoder-cn": { query: "", usage: "all" } });
  const sections = useMemo(() => (scan ? sessionSections(scan, sorts, filters) : null), [scan, sorts, filters]);
  const [activeSource, setActiveSource] = useState<SessionSourceId | "opencode">(initialSource);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  const completedSessionIds = records.outcome?.completedIds ?? null;
  const codexSelection = useSessionSelection({
    records: scan?.codex.records ?? null,
    isSelectable: selectableSession,
    completedIds: records.outcome?.source === "codex" ? completedSessionIds : null,
  });
  const claudeSelection = useSessionSelection({
    records: scan?.claude.records ?? null,
    isSelectable: selectableSession,
    completedIds: records.outcome?.source === "claude" ? completedSessionIds : null,
  });
  const grokSelection = useSessionSelection({
    records: scan?.grok?.records ?? null,
    isSelectable: selectableSession,
    completedIds: records.outcome?.source === "grok" ? completedSessionIds : null,
  });
  const qoderSelection = useSessionSelection({
    records: scan?.qoder?.records ?? null,
    isSelectable: selectableSession,
    completedIds: records.outcome?.source === "qoder" ? completedSessionIds : null,
  });
  const qoderCnSelection = useSessionSelection({
    records: scan?.["qoder-cn"]?.records ?? null,
    isSelectable: selectableSession,
    completedIds: records.outcome?.source === "qoder-cn" ? completedSessionIds : null,
  });
  const selections = {
    codex: codexSelection,
    claude: claudeSelection,
    grok: grokSelection,
    qoder: qoderSelection,
    "qoder-cn": qoderCnSelection,
  };
  const openCodeSelection = useSessionSelection({
    records: openCode.scan?.records ?? null,
    isSelectable: selectableOpenCode,
    completedIds: openCode.outcome?.completedIds ?? null,
  });

  return (
    <main className="view-grid" aria-busy={scanningSources.codex || scanningSources.claude || scanningSources.grok || scanningSources.qoder || scanningSources["qoder-cn"] || openCodeScanning}>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>会话记录读取失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && records.operation) records.cancel(records.operation.id);
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
                ? singleRemovalConfirmText(pending.record.title)
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
            </>
          ) : null}
          {showRemovalProgress && removalProgress ? (
            <div className="shrink-0 space-y-2">
              <p className="text-sm text-foreground/80">{removalProgressText(removalProgress)}</p>
              {removalProgress.phase !== "preparing" ? (
                <div
                  aria-label="会话记录移除进度"
                  aria-valuemax={removalProgress.total}
                  aria-valuemin={0}
                  aria-valuenow={removalProgressValue}
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150"
                    style={{ width: `${removalProgressPercent}%` }}
                  />
                </div>
              ) : null}
              {removalProgressDetail ? (
                <p className="text-xs text-foreground/70">{removalProgressDetail}</p>
              ) : null}
            </div>
          ) : null}
          <p className="shrink-0 text-sm text-foreground/80">清空废纸篓前可恢复记录；移入废纸篓不代表磁盘空间立即释放。</p>
          {pending?.source === "grok" ? (
            <p className="shrink-0 text-sm text-foreground/80">整条本机会话目录会移入废纸篓。搜索索引与远端副本保留，Grok 搜索中仍可能出现旧片段。独立关联记录不会自动连带移除，指向原记录的引用可能失效。执行前及每条移除前会复核 Grok Build 已退出。</p>
          ) : null}
          {pending?.source === "qoder" || pending?.source === "qoder-cn" ? (
            <p className="shrink-0 text-sm text-foreground/80">一条记录的转写与配套目录会一起移入废纸篓；CLI 运行中未被进程打开的记录仍可移除。诊断日志不在操作范围内。</p>
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
                  if (records.operation) void records.confirm(records.operation.id);
                }}
                type="button"
                variant="destructive"
              >
                {removing ? "正在移入废纸篓" : "移入废纸篓"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingOpenCodeDelete !== null}
        onOpenChange={(open) => {
          if (!open && openCode.operation) openCode.cancel(openCode.operation.id);
        }}
      >
        <AlertDialogContent className={pendingOpenCodeDelete?.kind === "age" ? "flex max-h-[calc(100dvh-2rem)] flex-col" : undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingOpenCodeDelete?.kind === "age" ? `永久删除 ${pendingOpenCodeDelete.days} 天前的 OpenCode 记录？` : pendingOpenCodeDelete?.kind === "selected" ? "永久删除所选 OpenCode 会话？" : "永久删除 OpenCode 会话？"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOpenCodeDelete ? pendingOpenCodeDelete.kind === "age"
                ? `将永久删除整个 OpenCode 来源中早于 ${formatSessionActivity(pendingOpenCodeDelete.cutoffMs ?? 0)} 的 ${pendingOpenCodeDelete.affected.length} 条记录，不受搜索和归档筛选限制。目标及全部后代都必须早于门槛且未运行；执行前发现记录或父子关系变化时，整批不开始，请刷新后重新确认。此操作无法恢复。`
                : pendingOpenCodeDelete.kind === "one"
                ? `将永久删除「${pendingOpenCodeDelete.selected[0]?.title ?? ""}」及其全部子会话。当前列表中可见 ${pendingOpenCodeDelete.affected.length - 1} 条子会话。若会话仍在运行，请先在 OpenCode 中结束。此操作不会移入废纸篓，无法恢复。`
                : `将永久删除 ${pendingOpenCodeDelete.affected.length} 条会话，其中已选择 ${pendingOpenCodeDelete.selected.length} 条，其余会由父会话级联删除。若会话仍在运行，请先在 OpenCode 中结束。此操作不会移入废纸篓，无法恢复。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingOpenCodeDelete ? (
            <ul aria-label="待永久删除的 OpenCode 会话" className="min-h-0 max-h-80 divide-y overflow-y-auto rounded-lg border">
              {pendingOpenCodeDelete.affected.map((record) => {
                const isSelected = pendingOpenCodeDelete.selected.some((selected) => selected.id === record.id);
                return (
                  <li className="flex min-w-0 items-center justify-between gap-3 px-4 py-3" key={record.id}>
                    <div className="min-w-0">
                      <p className="wrap-anywhere text-sm font-medium">{record.title || record.id}</p>
                      <p className="break-all text-xs text-muted-foreground">{formatHomePath(record.workingDirectory, homeDirectory)}{record.archived ? " · 已归档" : ""}</p>
                      {pendingOpenCodeDelete.kind === "age" ? <p className="break-all text-xs text-muted-foreground">{formatSessionActivity(record.lastActivityMs)}{record.parentId ? ` · 父会话：${record.parentTitle || record.parentId}` : ""}</p> : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{pendingOpenCodeDelete.kind === "age" ? pendingOpenCodeDelete.roots.some((root) => root.id === record.id) ? "按年龄删除" : "级联删除" : isSelected ? "已选择" : "级联删除"}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p className="text-sm text-foreground/80">OpenCode 永久删除无法恢复，不会移入废纸篓。</p>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button disabled={deletingOpenCodeId !== null} type="button" variant="outline">取消</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={deletingOpenCodeId !== null}
                onClick={(event) => {
                  event.preventDefault();
                  if (openCode.operation) void openCode.confirm(openCode.operation.id);
                }}
                type="button"
                variant="destructive"
              >
                {deletingOpenCodeId ? "正在删除" : "永久删除"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {openCodeDeleteResult ? (
        <Alert variant={openCodeDeleteResult.error || openCodeDeleteResult.result?.preflightError || openCodeDeleteResult.result?.items.some((item) => item.status === "failed") ? "destructive" : "default"}>
          <AlertTitle>{openCodeDeleteResult.pending.kind === "one"
            ? openCodeDeleteResult.error || openCodeDeleteResult.result?.preflightError ? "OpenCode 会话删除未确认" : "OpenCode 会话已永久删除"
            : openCodeDeleteResult.result?.preflightError ? "OpenCode 批量删除已取消"
              : openCodeDeleteResult.error ? "OpenCode 批量删除结果未能确认"
                : openCodeDeleteResult.result?.items.some((item) => item.status === "failed") ? "OpenCode 批量删除部分完成" : "OpenCode 会话已永久删除"}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {openCodeDeleteResult.error ? <p>{openCodeDeleteResult.error}。请刷新会话记录核对。</p> : null}
            {openCodeDeleteResult.result?.preflightError ? <p>{openCodeDeleteResult.result.preflightError}</p> : null}
            {openCodeDeleteResult.result?.historyWarning ? <p>维护历史未完整保存：{openCodeDeleteResult.result.historyWarning}</p> : null}
            {openCodeDeleteResult.followUpWarning ? <p>后续读取未写入历史：{openCodeDeleteResult.followUpWarning}</p> : null}
            {openCodeDeleteResult.result?.historyId && onShowHistory ? <Button className="w-fit" onClick={() => onShowHistory(openCodeDeleteResult.result!.historyId!)} size="sm" type="button" variant="outline">已保存到维护历史</Button> : null}
            {openCodeDeleteResult.result?.items.length ? (
              <>
                <p>删除成功 {openCodeDeleteResult.result.items.filter((item) => item.status === "deleted").length} 条，失败 {openCodeDeleteResult.result.items.filter((item) => item.status === "failed").length} 条，未执行 {openCodeDeleteResult.result.items.filter((item) => item.status === "notAttempted").length} 条。</p>
                <ul className="flex max-h-64 flex-col gap-1 overflow-auto">
                  {openCodeDeleteResult.result.items.map((item) => {
                    const title = openCodeDeleteResult.pending.roots.find((record) => record.id === item.id)?.title ?? item.id;
                    const status = item.status === "deleted" ? "已永久删除" : item.status === "failed" ? "失败" : "未执行";
                    return <li className="break-all" key={item.id}>{title} · {status}{item.message ? ` · ${item.message}` : ""}</li>;
                  })}
                </ul>
              </>
            ) : null}
            <RefreshNotice value={openCodeDeleteResult.refresh} onRetry={openCode.refresh} />
          </AlertDescription>
        </Alert>
      ) : null}

      {result ? (
        <Alert>
          <AlertTitle>{resultSource} · {removalResultText(result)}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {result.operationError ? <p>{result.operationError}。请刷新会话记录，核对后再试。</p> : <p>以上为实际移除结果，可能与确认时的条数不同。清空废纸篓前可恢复记录，磁盘空间不会立即释放。</p>}
            {result.message ? <p>{result.message}</p> : null}
            {result.historyWarning ? <p>维护历史未完整保存：{result.historyWarning}</p> : null}
            {records.outcome?.followUpWarning ? <p>后续读取未写入历史：{records.outcome.followUpWarning}</p> : null}
            {result.historyId && onShowHistory ? <Button className="w-fit" onClick={() => onShowHistory(result.historyId!)} size="sm" type="button" variant="outline">已保存到维护历史</Button> : null}
            {records.outcome ? <RefreshNotice value={records.outcome.refresh} onRetry={() => void records.refresh(removalSource)} /> : null}
            {result.items.length ? <details><summary className="cursor-pointer">查看逐条结果（{result.items.length}）</summary><ul className="mt-2 flex max-h-64 flex-col gap-2 overflow-auto">
              {result.items.map((item) => <li key={item.id} className="break-all"><strong>{formatSessionRecordId(removalSource, item.id)}</strong> · {item.status === "Moved" ? "已移入废纸篓" : item.reason ? removalReasonLabels[item.reason] : item.status === "Skipped" ? "跳过" : item.status === "NotAttempted" ? "未执行" : "失败"}{item.message ? ` · ${item.message}` : ""}</li>)}
            </ul></details> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs className="min-w-0" onValueChange={(value) => setActiveSource(value as SessionSourceId | "opencode")} value={activeSource}>
        <TabsList className="h-auto w-full flex-wrap">
          {sources.map((source) => {
            const count = sections?.[source.key]?.count;
            return (
              <TabsTrigger key={source.key} value={source.key}>
                {source.label}
                {count === undefined ? null : (
                  <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                )}
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="opencode">
            OpenCode
            {openCodeScan ? <span className="text-xs tabular-nums text-muted-foreground">{openCodeScan.records.length}</span> : null}
          </TabsTrigger>
        </TabsList>
        {sources.map((source) => {
          const data = scan?.[source.key];
          const view = sections?.[source.key];
          const selection = selections[source.key];
          return (
            <TabsContent className="min-w-0" key={source.key} value={source.key}>
              <SourceSection
                collapsed={collapsed}
                emptyMessage={data?.status === "Failed" ? "未能读取会话记录，请查看错误信息后刷新重试"
                  : data?.status === "Partial" && !view?.totalCount ? "尚未读到会话记录，请查看读取不完整的提示"
                    : data?.status === "Missing" ? `未找到 ${source.label} 会话记录目录`
                      : view?.totalCount ? "没有匹配的会话记录，请调整搜索词或使用状态筛选" : source.empty}
                filter={filters[source.key]}
                onFilterChange={(patch) => {
                  setFilters((current) => ({ ...current, [source.key]: { ...current[source.key], ...patch } }));
                  selection.clear();
                }}
                fallbackPath={source.fallback}
                homeDirectory={homeDirectory}
                label={source.label}
                onOpen={openableSource(source.key) ? (record) => records.openSession(source.key, record) : undefined}
                openingId={records.openingSession?.source === source.key ? records.openingSession.id : null}
                nowMs={currentTime}
                onClearSelection={() => selection.clear()}
                onRequestAgeRemoval={(days, count) => {
                  records.request({ kind: "age", source: source.key, label: source.label, days, count });
                }}
                onRequestRemoval={(record) => {
                  records.request({ kind: "one", source: source.key, record });
                }}
                onRequestSelectedRemoval={(selectedRecords, trigger) => {
                  selectionTrigger.current = trigger;
                  records.request({ kind: "selected", source: source.key, label: source.label, records: selectedRecords });
                }}
                onSelectAll={() => selection.selectAll(filterSessionRecords(data?.records ?? [], filters[source.key]))}
                onSetGroupSelected={(records, selected) => selection.selectGroup(records, selected)}
                onSetRecordSelected={(id, selected) => selection.toggle(id, selected)}
                onRefresh={() => onRefresh(source.key)}
                onSortChange={(next) => setSorts((current) => ({ ...current, [source.key]: next }))}
                onToggle={(groupKey, nextCollapsed) => setCollapsed((current) => ({ ...current, [`${source.key}:${groupKey}`]: nextCollapsed }))}
                removing={removing || Boolean(records.openingSession)}
                scanning={scanningSources[source.key]}
                selectedIds={selection.selectedIds}
                sort={sorts[source.key]}
                source={data ?? null}
                coverageItem={coverageItems[source.key]}
                sourceKey={source.key}
                view={view ?? null}
              />
            </TabsContent>
          );
        })}
        <TabsContent className="min-w-0" value="opencode">
          <OpenCodeSection
            coverageItem={coverageItems.opencode}
            error={openCodeError}
            preparing={openCodePreparing}
            prepareError={openCodePrepareError}
            homeDirectory={homeDirectory}
            deletingId={deletingOpenCodeId}
            onOpen={openCode.openSession}
            onRequestDelete={(id) => { void openCode.request("one", [id]); }}
            onRequestAgeDelete={(days) => { void openCode.requestAge(days); }}
            onDeleteSelected={() => { void openCode.request("selected", openCodeSelection.selectedIds); }}
            onClearSelection={() => openCodeSelection.clear()}
            onSelectAll={(records) => openCodeSelection.selectAll(records)}
            onSetSelected={(id, selected) => openCodeSelection.toggle(id, selected)}
            selectedIds={openCodeSelection.selectedIds}
            onRefresh={openCode.refresh}
            scan={openCodeScan}
            scanning={openCodeScanning}
            nowMs={currentTime}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function OpenCodeSection({
  scan,
  scanning,
  preparing,
  error,
  prepareError,
  coverageItem,
  onRefresh,
  onOpen,
  onRequestDelete,
  onRequestAgeDelete,
  onDeleteSelected,
  onClearSelection,
  onSelectAll,
  onSetSelected,
  selectedIds,
  deletingId,
  homeDirectory,
  nowMs,
}: {
  scan: OpenCodeSessionScan | null;
  scanning: boolean;
  preparing: boolean;
  error: string | null;
  prepareError: string | null;
  coverageItem: ObservationCoverageItem;
  onRefresh: () => void;
  onOpen: (sessionId: string) => Promise<string | null>;
  onRequestDelete: (id: string) => void;
  onRequestAgeDelete: (days: 7 | 30) => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  onSelectAll: (records: OpenCodeSessionRecord[]) => void;
  onSetSelected: (id: string, selected: boolean) => void;
  selectedIds: readonly string[];
  deletingId: string | null;
  homeDirectory: string | null;
  nowMs: number;
}) {
  const [filter, setFilter] = useState<OpenCodeSessionFilter>({ query: "", archived: "all" });
  const [sort, setSort] = useState<OpenCodeSessionSort>("time");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const records = useMemo(() => filterOpenCodeSessions(scan?.records ?? [], filter), [scan, filter]);
  const groups = useMemo(() => groupOpenCodeSessions(records, sort), [records, sort]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRecords = useMemo(() => records.filter((record) => selectedSet.has(record.id)), [records, selectedSet]);
  const eligibleAge7 = scan?.status === "ready" && scan.activeSessionIds
    ? scan.ageEligible.days7
    : null;
  const eligibleAge30 = scan?.status === "ready" && scan.activeSessionIds
    ? scan.ageEligible.days30
    : null;

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Input type="search" aria-label="搜索 OpenCode 会话" placeholder="搜索标题或工作目录" value={filter.query} onChange={(event) => { setFilter((current) => ({ ...current, query: event.target.value })); onClearSelection(); }} className="min-w-40 flex-1" />
        <ToggleGroup type="single" value={filter.archived} onValueChange={(archived) => { if (archived) { setFilter((current) => ({ ...current, archived: archived as OpenCodeSessionFilter["archived"] })); onClearSelection(); } }} aria-label="OpenCode 归档状态">
          <ToggleGroupItem value="all">全部</ToggleGroupItem><ToggleGroupItem value="active">未归档</ToggleGroupItem><ToggleGroupItem value="archived">已归档</ToggleGroupItem>
        </ToggleGroup>
        <div className="grid min-w-0 gap-0.5">
          <span className="text-xs text-muted-foreground" role="status">{scan?.status === "ready" ? `匹配 ${records.length} / 已读取 ${scan.records.length} 条` : "OpenCode 服务不可用"}</span>
          <ObservationState
            item={coverageItem}
            showNote={coverageItem.status !== "failed" && coverageItem.status !== "unavailable"}
            variant="strip"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-b px-3 py-2">
        <span aria-label="排序" className="flex gap-1" role="group">
          <Button aria-pressed={sort === "time"} onClick={() => setSort("time")} size="sm" type="button" variant={sort === "time" ? "secondary" : "outline"}>按时间</Button>
          <Button aria-pressed={sort === "project"} onClick={() => setSort("project")} size="sm" type="button" variant={sort === "project" ? "secondary" : "outline"}>按项目</Button>
        </span>
        <Button disabled={scanning || preparing || deletingId !== null} onClick={onRefresh} size="sm" type="button" variant="outline">
          <RefreshCw className={scanning ? "animate-spin" : undefined} data-icon="inline-start" />
          {scanning ? "读取中" : "刷新"}
        </Button>
        {([7, 30] as const).map((days) => (
          <Button
            aria-describedby="opencode-age-deletion-help opencode-age-deletion-eligibility"
            disabled={scanning || preparing || deletingId !== null || openingId !== null || scan?.status !== "ready" || scan.activeSessionIds === null || (days === 7 ? eligibleAge7 : eligibleAge30) === 0}
            key={days}
            onClick={() => onRequestAgeDelete(days)}
            size="sm"
            type="button"
            variant="outline"
          >永久删除 {days} 天前的记录</Button>
        ))}
      </div>
      <p className="px-3 py-2 text-xs text-muted-foreground" id="opencode-age-deletion-help">按天数永久删除以最后活动时间为准，作用于整个 OpenCode 来源，不受搜索和归档筛选限制。有近期或运行中后代的父会话保留；删除不会移入废纸篓，无法恢复。</p>
      <p className="px-3 pb-2 text-xs text-muted-foreground" id="opencode-age-deletion-eligibility" role="status">{eligibleAge7 === null || eligibleAge30 === null
        ? scan?.activityMessage ?? scan?.message ?? "读取会话及运行状态后显示当前符合年龄条件的数量。"
        : eligibleAge7 === 0 && eligibleAge30 === 0
          ? "当前没有符合 7 天或 30 天门槛的会话；近期或运行中的会话及其父会话会保留。"
          : eligibleAge7 === 0
            ? `当前没有符合 7 天门槛的会话；30 天门槛符合 ${eligibleAge30} 条。`
            : eligibleAge30 === 0
              ? `当前没有符合 30 天门槛的会话；7 天门槛符合 ${eligibleAge7} 条。`
              : `当前符合年龄门槛：7 天 ${eligibleAge7} 条、30 天 ${eligibleAge30} 条。`}</p>
      {preparing ? <p className="px-3 pb-2 text-xs text-muted-foreground" role="status">正在准备删除计划…</p> : null}
      {prepareError ? <Alert className="m-3" variant="destructive"><AlertTitle>无法准备 OpenCode 删除计划</AlertTitle><AlertDescription>{prepareError}</AlertDescription></Alert> : null}
      {scan?.activityMessage ? <Alert className="m-3"><AlertTitle>OpenCode 运行状态暂不可读取</AlertTitle><AlertDescription>{scan.activityMessage} 请刷新重试。</AlertDescription></Alert> : null}
      {error ? <Alert className="m-3" variant="destructive"><AlertTitle>OpenCode 会话读取失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {scan?.message ? <Alert className="m-3" variant={scan.status === "failed" ? "destructive" : "default"}><AlertTitle>{scan.status === "unavailable" ? "OpenCode 暂不可读取" : "OpenCode 会话读取失败"}</AlertTitle><AlertDescription>{scan.message}</AlertDescription></Alert> : null}
      {openError ? <Alert className="m-3" variant="destructive"><AlertTitle>无法打开 OpenCode 会话</AlertTitle><AlertDescription>{openError}</AlertDescription></Alert> : null}
      {scan?.status === "ready" && records.length === 0 ? <p className="p-6 text-sm text-muted-foreground">{scan.records.length ? "没有匹配的会话，请调整搜索词或归档筛选" : "没有 OpenCode 会话记录"}</p> : null}
      {records.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <Button disabled={deletingId !== null || scanning || preparing || scan?.status !== "ready" || selectedRecords.length === records.length} onClick={() => onSelectAll(records)} size="sm" type="button" variant="outline">
            全选当前结果
          </Button>
          <Button disabled={deletingId !== null || scanning || preparing || selectedRecords.length === 0} onClick={onClearSelection} size="sm" type="button" variant="outline">
            取消选择
          </Button>
          <Button disabled={deletingId !== null || scanning || preparing || scan?.status !== "ready" || selectedRecords.length === 0} onClick={onDeleteSelected} size="sm" type="button" variant="destructive">
            永久删除 {selectedRecords.length} 条
          </Button>
        </div>
      ) : null}
      {records.length ? (
        <div aria-label="OpenCode 会话记录" role="region">
          {groups.map((group) => {
            const projectMode = sort === "project";
            const isCollapsed = collapsed[group.key] ?? (projectMode && !filter.query.trim());
            const groupPath = projectMode && group.path ? formatHomePath(group.path, homeDirectory) : null;
            const groupId = `opencode-group-${encodeURIComponent(group.key)}`;
            return (
              <section className="border-t" key={group.key}>
                <h3>
                  <button aria-controls={groupId} aria-expanded={!isCollapsed} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setCollapsed((current) => ({ ...current, [group.key]: !isCollapsed }))} type="button">
                    <span className="flex min-w-0 items-center gap-2">
                      {isCollapsed ? <CaretRight aria-hidden="true" /> : <CaretDown aria-hidden="true" />}
                      {projectMode ? (
                        <span className="grid min-w-0 gap-0.5">
                          <span className="truncate text-sm font-medium">{group.label}</span>
                          {groupPath ? <span className="truncate text-xs font-normal text-muted-foreground">{groupPath}</span> : null}
                        </span>
                      ) : <span>{group.label}</span>}
                    </span>
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {group.records.length} 条{projectMode
                        ? ` · ${group.lastActivityMs == null ? "没有最后活动时间" : relativeObservationTime(group.lastActivityMs, nowMs)}`
                        : ` · ${isCollapsed ? "展开" : "折叠"}`}
                    </span>
                  </button>
                </h3>
                <ul className="divide-y" hidden={isCollapsed} id={groupId}>
                {group.records.map((record) => (
                  <li className={`flex min-w-0 flex-wrap items-start justify-between gap-3 py-3 ${projectMode ? "pl-10 pr-4" : "px-4"}`} key={record.id}>
                    <Checkbox
                      aria-label={`选择 ${record.title}`}
                      aria-describedby={openingId !== null || deletingId !== null || scanning || preparing || scan?.status !== "ready" ? "opencode-selection-blocked" : undefined}
                      checked={selectedSet.has(record.id)}
                      disabled={openingId !== null || deletingId !== null || scanning || preparing || scan?.status !== "ready"}
                      onCheckedChange={(checked) => onSetSelected(record.id, checked === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="wrap-anywhere text-sm font-medium">{record.title}</p>
                        {record.archived ? <Badge variant="secondary">已归档</Badge> : null}
                      </div>
                      <dl className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        <div className="flex flex-wrap gap-x-2"><dt>最后活动时间</dt><dd>{formatSessionActivity(record.lastActivityMs)}</dd></div>
                        <div className="flex flex-wrap gap-x-2"><dt>工作目录</dt><dd className="min-w-0 break-all">{formatHomePath(record.workingDirectory, homeDirectory)}</dd></div>
                        {record.parentId ? <div className="flex flex-wrap gap-x-2"><dt>父会话</dt><dd className="min-w-0 break-all">{record.parentTitle || record.parentId}</dd></div> : null}
                      </dl>
                    </div>
                    <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
                      <Button
                        disabled={openingId !== null || deletingId !== null || scanning || preparing}
                        onClick={async () => {
                          setOpeningId(record.id);
                          setOpenError(null);
                          const nextError = await onOpen(record.id);
                          setOpenError(nextError);
                          setOpeningId(null);
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <ArrowSquareOut data-icon="inline-start" />
                        {openingId === record.id ? "正在打开" : "在 OpenCode 中打开"}
                      </Button>
                      <Button
                        aria-label={`永久删除 ${record.title}`}
                        disabled={openingId !== null || deletingId !== null || scanning || preparing || scan?.status !== "ready"}
                        onClick={() => {
                          onRequestDelete(record.id);
                        }}
                        size="icon-sm"
                        title="永久删除会话及其子会话"
                        type="button"
                        variant="ghost"
                      >
                        <Trash aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            );
          })}
        </div>
      ) : null}
      {scan?.status !== "ready" || scanning || preparing || deletingId !== null || openingId !== null ? <p className="sr-only" id="opencode-selection-blocked">{scanning ? "正在读取 OpenCode 会话，暂不能选择。" : preparing ? "正在准备删除计划，暂不能选择。" : deletingId !== null ? "正在删除 OpenCode 会话，暂不能选择。" : openingId !== null ? "正在打开会话，暂不能选择。" : scan?.message ?? "OpenCode 服务不可用，暂不能选择。"}</p> : null}
    </Panel>
  );
}

function SourceSection({
  filter,
  onFilterChange,
  source,
  view,
  label,
  onOpen,
  openingId,
  emptyMessage,
  fallbackPath,
  homeDirectory,
  collapsed,
  sourceKey,
  coverageItem,
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
  onOpen?: (record: SessionRecord) => Promise<string | null>;
  openingId?: string | null;
  emptyMessage: string;
  fallbackPath: string;
  homeDirectory: string | null;
  collapsed: Record<string, boolean>;
  sourceKey: string;
  coverageItem: ObservationCoverageItem;
  onToggle: (groupKey: string, collapsed: boolean) => void;
  nowMs: number;
  onSortChange: (sort: SessionSort) => void;
  onClearSelection: () => void;
  onRequestAgeRemoval: (days: 7 | 30, count: number) => void;
  onRequestRemoval: (record: SessionRecord) => void;
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
  const [openError, setOpenError] = useState<string | null>(null);
  const grok = sourceKey === "grok";
  const qoder = sourceKey === "qoder" || sourceKey === "qoder-cn";
  const blockedReason = grok ? source?.status === "Failed" ? "请先成功读取 Grok Build 会话记录。" : source?.removalBlockedReason : null;
  const mutationBlocked = removing || (grok && (scanning || Boolean(blockedReason)));
  const records = useMemo(() => view?.groups.flatMap((group) => group.records) ?? [], [view]);
  const removable = useMemo(() => removableSessionRecords(records), [records]);
  const selected = useMemo(() => selectedRemovalRequest(records, selectedIds), [records, selectedIds]);
  const selectedCount = selected?.count ?? 0;
  const selectedSet = useMemo(() => new Set(selected?.ids ?? []), [selected]);
  const eligibleAge7 = source?.ageEligible.days7 ?? 0;
  const eligibleAge30 = source?.ageEligible.days30 ?? 0;
  const { inUseCount, unknownActivityCount, recentAge7Count, recentAge30Count } = useMemo(() => {
    let inUse = 0;
    let unknownActivity = 0;
    let recent7 = 0;
    let recent30 = 0;
    const sevenDaysAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = nowMs - 30 * 24 * 60 * 60 * 1000;
    for (const record of source?.records ?? []) {
      if (record.inUse) inUse += 1;
      if (record.lastActivityMs === null) {
        unknownActivity += 1;
        continue;
      }
      if (record.inUse) continue;
      if (record.lastActivityMs >= sevenDaysAgo) recent7 += 1;
      if (record.lastActivityMs >= thirtyDaysAgo) recent30 += 1;
    }
    return { inUseCount: inUse, unknownActivityCount: unknownActivity, recentAge7Count: recent7, recentAge30Count: recent30 };
  }, [source?.records, nowMs]);
  const ageEligibilityId = `${sourceKey}-age-removal-eligibility`;
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Input disabled={removing} type="search" aria-label={`搜索 ${label} 会话记录`} placeholder="搜索标题或工作目录" value={filter.query} onChange={(event) => onFilterChange({ query: event.target.value })} className="min-w-40 flex-1" />
        <ToggleGroup disabled={removing} type="single" value={filter.usage} onValueChange={(usage) => { if (usage) onFilterChange({ usage: usage as SessionUsageFilter }); }} aria-label={`${label} 使用状态`}>
          <ToggleGroupItem value="all">全部</ToggleGroupItem><ToggleGroupItem value="inUse">使用中</ToggleGroupItem><ToggleGroupItem value="notInUse">未使用中</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-muted-foreground" role="status">{view ? `匹配 ${view.count} / 已读取 ${view.totalCount} 条` : "尚未读取会话记录"}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
        <div className="grid min-w-0 basis-48 grow gap-0.5">
          <ObservationState
            item={coverageItem}
            showNote={coverageItem.status !== "failed" && coverageItem.status !== "partial"}
            variant="strip"
          />
          <p className="break-all text-xs text-muted-foreground">
            {source ? formatHomePath(source.directory, homeDirectory) : fallbackPath}
          </p>
        </div>
        <span className="flex max-w-full flex-wrap gap-2">
          <span aria-label="排序" className="flex gap-1" role="group">
            <Button aria-pressed={sort === "time"} onClick={() => onSortChange("time")} size="sm" type="button" variant={sort === "time" ? "secondary" : "outline"}>
              按时间
            </Button>
            <Button aria-pressed={sort === "project"} onClick={() => onSortChange("project")} size="sm" type="button" variant={sort === "project" ? "secondary" : "outline"}>
              按项目
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
            const request = ageRemovalRequest(source?.ageEligible, days);
            return (
              <Button
                aria-describedby={`${sourceKey}-age-removal-help ${ageEligibilityId}`}
                disabled={scanning || mutationBlocked || request === null}
                key={days}
                onClick={() => {
                  if (request) onRequestAgeRemoval(request.days, request.count);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {`移除 ${days} 天前的记录`}
              </Button>
            );
          })}
        </span>
      </div>
      {grok ? (
        <div className="space-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
          <p id={`${sourceKey}-removal-blocked`} role="status">{blockedReason ?? (source ? "移除前会逐条复核 Grok Build 已退出及记录未被其他进程打开。" : "读取后检查 Grok Build 的运行状态。")}</p>
          <p>移除只把本机会话目录移入废纸篓；外部搜索索引、远端副本及未选中的独立关联记录保留。</p>
        </div>
      ) : null}
      {qoder ? (
        <div className="space-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
          <p>移除会把一条记录的转写与配套目录一起移入废纸篓；使用中的记录会跳过，CLI 运行中未被进程打开的记录仍可移除。</p>
        </div>
      ) : null}
      {openError ? <Alert variant="destructive"><AlertTitle>无法继续 {label} 会话</AlertTitle><AlertDescription>{openError}</AlertDescription></Alert> : null}
      <CardContent className="flex flex-col gap-2 p-3">
        <p className="text-xs text-muted-foreground" id={`${sourceKey}-age-removal-help`}>按天数移除以最后活动时间为准，作用于整个 {label} 来源，不受搜索和状态筛选限制。使用中的记录会跳过。</p>
        <p className="text-xs text-muted-foreground" id={ageEligibilityId} role="status">{!source ? "读取会话记录后显示当前符合年龄条件的数量。" : eligibleAge7 === 0 && eligibleAge30 === 0 ? `当前没有符合 7 天或 30 天门槛的记录；近 7 天 ${recentAge7Count} 条、近 30 天 ${recentAge30Count} 条未达门槛` : eligibleAge7 === 0 ? `当前没有符合 7 天门槛的记录；近 7 天 ${recentAge7Count} 条未达门槛` : eligibleAge30 === 0 ? `当前没有符合 30 天门槛的记录；近 30 天 ${recentAge30Count} 条未达门槛` : `当前符合年龄门槛：7 天 ${eligibleAge7} 条、30 天 ${eligibleAge30} 条`}{inUseCount ? `；${inUseCount} 条使用中的记录会跳过` : ""}{unknownActivityCount ? `；${unknownActivityCount} 条缺少最后活动时间，无法按年龄判断` : ""}。</p>
        <div className="stat-grid grid-cols-2">
          <StatCard label={`${label} 会话记录`} value={view ? `${view.count} 条` : "—"} />
          <StatCard label="当前结果的记录占用" value={view ? `${records.some((record) => record.grok?.bytesComplete === false) ? "已测 " : ""}${formatBytes(view.bytes)}` : "—"} />
        </div>
      </CardContent>
      {source?.status === "Failed" && source.message ? (
        <Alert variant="destructive">
          <AlertTitle>{label} 会话记录读取失败</AlertTitle>
          <AlertDescription>{source.message}。请根据错误信息检查目录，再刷新重试。</AlertDescription>
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
              disabled={mutationBlocked || removable.length === 0 || selectedCount === removable.length}
              onClick={onSelectAll}
              size="sm"
              type="button"
              variant="outline"
            >
              全选当前结果中可移除记录
            </Button>
            <Button disabled={removing || selectedCount === 0} onClick={onClearSelection} size="sm" type="button" variant="outline">
              取消选择
            </Button>
            <Button
              disabled={mutationBlocked || selected === null}
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
            const projectMode = sort === "project";
            const isCollapsed = collapsed[collapseKey] ?? (projectMode && !filter.query.trim());
            const groupPath = projectMode && group.path ? formatHomePath(group.path, homeDirectory) : null;
            const groupAccessibleLabel = projectMode
              ? `选择${group.label}${groupPath ? `（${groupPath}）` : ""}的可移除会话记录`
              : `选择${group.label}的可移除会话记录`;
            const groupRemovable = removableSessionRecords(group.records);
            const groupAllSelected = groupRemovable.length > 0 && groupRemovable.every((record) => selectedSet.has(record.id));
            return (
              <section key={collapseKey}>
                <div className="flex items-center gap-3 border-b px-4 py-2">
                  <Checkbox
                    aria-label={groupAccessibleLabel}
                    aria-describedby={groupRemovable.length === 0 ? ageEligibilityId : undefined}
                    checked={groupAllSelected}
                    disabled={mutationBlocked || groupRemovable.length === 0}
                    onCheckedChange={(checked) => onSetGroupSelected(group.records, checked === true)}
                  />
                  <button
                    aria-expanded={!isCollapsed}
                    className="flex min-h-6 min-w-0 flex-1 items-center justify-between gap-3 text-left"
                    onClick={() => onToggle(group.key, !isCollapsed)}
                    type="button"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {isCollapsed ? <CaretRight aria-hidden="true" /> : <CaretDown aria-hidden="true" />}
                      {projectMode ? (
                        <span className="grid min-w-0 gap-0.5">
                          <span className="truncate text-sm font-medium">{group.label}</span>
                          {groupPath ? <span className="truncate text-xs font-normal text-muted-foreground">{groupPath}</span> : null}
                        </span>
                      ) : <span className="text-sm font-medium">{group.label}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {group.count} 条 · {group.records.some((record) => record.grok?.bytesComplete === false) ? "已测 " : ""}{formatBytes(group.bytes)}
                      {projectMode ? ` · ${group.lastActivityMs == null ? "没有最后活动时间" : relativeObservationTime(group.lastActivityMs, nowMs)}` : ""}
                    </span>
                  </button>
                </div>
                {isCollapsed ? null : (
                  <ul className="divide-y">
                    {group.records.map((record) => (
                      <li className={`grid items-center gap-3 py-3 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_auto] ${projectMode ? "pl-10 pr-4" : "px-4"}`} key={record.id}>
                        <Checkbox
                          aria-label={`选择 ${record.title}`}
                          aria-describedby={record.inUse ? `${sourceKey}-in-use-${encodeURIComponent(record.id)}` : undefined}
                          checked={!record.inUse && selectedSet.has(record.id)}
                          disabled={mutationBlocked || record.inUse}
                          onCheckedChange={(checked) => onSetRecordSelected(record.id, checked === true)}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{record.title}</span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {record.workingDirectory
                              ? formatHomePath(record.workingDirectory, homeDirectory)
                              : "没有工作目录"}
                          </span>
                          {record.grok?.parentSessionId ? <span className="mt-1 block break-all text-xs text-muted-foreground">来源记录：{record.grok.parentSessionId}</span> : null}
                          {record.grok?.relatedSessionIds.length ? <span className="mt-1 block text-xs text-muted-foreground">关联 {record.grok.relatedSessionIds.length} 条记录，移除不自动连带</span> : null}
                          {record.grok?.resumeError ? <span className="mt-1 block text-xs text-muted-foreground" id={`grok-resume-${encodeURIComponent(record.id)}`}>{record.grok.resumeError}</span> : null}
                        </span>
                        <span className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                          <span>{record.lastActivityMs === null ? "没有最后活动时间" : formatSessionActivity(record.lastActivityMs)}</span>
                          <span className="font-medium tabular-nums text-foreground">{record.grok?.bytesComplete === false ? record.bytes ? `已测 ${formatBytes(record.bytes)}` : "大小未知" : formatBytes(record.bytes)}</span>
                        </span>
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          {onOpen ? <Button
                            aria-label={`在 ${label} 中继续 ${record.title}`}
                            aria-describedby={record.grok?.resumeError ? `grok-resume-${encodeURIComponent(record.id)}` : undefined}
                            disabled={removing || scanning || source?.status === "Failed" || Boolean(record.grok?.resumeError)}
                            onClick={async () => { setOpenError(null); setOpenError(await onOpen(record)); }}
                            size="sm" type="button" variant="outline"
                          ><ArrowSquareOut aria-hidden="true" />{openingId === record.id ? "打开中" : "继续会话"}</Button> : null}
                          {record.inUse ? <span className="text-xs text-muted-foreground" id={`${sourceKey}-in-use-${encodeURIComponent(record.id)}`}>使用中，暂不移除</span> : (
                            <Button
                              aria-label={`将 ${record.title || record.id} 移入废纸篓`}
                              disabled={mutationBlocked}
                              aria-describedby={blockedReason ? `${sourceKey}-removal-blocked` : undefined}
                              onClick={() => onRequestRemoval(record)}
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
      ) : <EmptyState message={scanning ? `正在读取 ${label} 会话记录…` : `尚未读取 ${label} 会话记录，请刷新后查看`} />}
    </Panel>
  );
}
