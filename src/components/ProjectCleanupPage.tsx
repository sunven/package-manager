import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from "../../components/ui/dropdown-menu";
import { ArrowClockwise as RefreshCw, ArrowDown, ArrowSquareOut as ExternalLink, ArrowUp, CaretUpDown, ClockCounterClockwise, Copy, FolderOpen, Square, Trash as Trash2, X } from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import {
  projectName,
  defaultSortDir,
  filterAndSortProjectData,
  type ProjectDataSort,
  type ProjectDataSortDir,
} from "../projectCleanup";
import type { ProjectDataKind } from "../types";
import type { ObservationCoverageItem } from "../observationCoverage";
import type {
  CleanupBatchView,
  ProjectCleanupCandidateView,
  ProjectCleanupView,
  ProjectCleanupWorkflow,
  WorkflowFailure,
  WorkflowOutcome,
} from "../projectCleanupWorkflow";
import {
  formatScanTime,
  latestRecordForDepth,
  otherDepthRecordCount,
  projectDelta,
  scanChangeCounts,
} from "../projectScanHistory";
import type { ProjectCleanupResult, ProjectScanRecord, UiMessage } from "../types";
import { formatBytes, formatHomePath } from "../utils/format";
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
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { ObservationState } from "./ObservationState";
import { EmptyState, IconButton, Panel, PanelHead } from "./ui";
import { ProjectScanHistoryDialog } from "./ProjectScanHistoryDialog";

export function ProjectCleanupPage({
  homeDirectory,
  view,
  workflow,
  coverageItem,
  onShowHistory,
}: {
  homeDirectory: string | null;
  view: ProjectCleanupView;
  workflow: ProjectCleanupWorkflow;
  coverageItem: ObservationCoverageItem;
  onShowHistory?: (recordId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectDataSort>("size");
  const [sortDir, setSortDir] = useState<ProjectDataSortDir>("desc");
  const [kind, setKind] = useState<ProjectDataKind>("RustTarget");
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [depthDraft, setDepthDraft] = useState(String(view.settings.maxDepth));
  useEffect(() => {
    setDepthDraft(String(view.settings.maxDepth));
  }, [view.settings.activePresetId, view.settings.maxDepth]);
  useEffect(() => {
    setHistoryOpen(false);
  }, [view.settings.activePresetId]);
  const depthChanged = depthDraft !== String(view.settings.maxDepth);
  const draftDepth = Number(depthDraft);
  const depthValid = depthDraft.trim() !== "" && Number.isInteger(draftDepth) && draftDepth >= 0 && draftDepth <= 32;
  const candidates = view.scan.session?.candidates ?? [];
  const activePreset = view.settings.presets.find(
    (preset) => preset.id === view.settings.activePresetId,
  ) ?? null;
  const activePresetRecords = activePreset
    ? view.history.byPreset[activePreset.id] ?? []
    : [];
  const latestAtDepth = activePreset
    ? latestRecordForDepth(activePresetRecords, view.settings.maxDepth)
    : null;
  const otherDepthCount = activePreset
    ? otherDepthRecordCount(activePresetRecords, view.settings.maxDepth)
    : 0;
  const rustTotal = useMemo(
    () => candidates.filter((candidate) => candidate.kind === "RustTarget").length,
    [candidates],
  );
  const nodeTotal = useMemo(
    () => candidates.filter((candidate) => candidate.kind === "NodeModules").length,
    [candidates],
  );
  const mavenTotal = useMemo(
    () => candidates.filter((candidate) => candidate.kind === "MavenTarget").length,
    [candidates],
  );
  const orderedCandidates = useMemo(
    () => filterAndSortProjectData(candidates, "", sort, "all", sortDir),
    [candidates, sort, sortDir],
  );
  const visibleCandidates = useMemo(
    () => filterAndSortProjectData(candidates, query, sort, kind, sortDir),
    [candidates, kind, query, sort, sortDir],
  );
  const selectableVisibleIds = visibleCandidates
    .filter((candidate) => candidate.cleanability.kind === "cleanable")
    .map((candidate) => candidate.candidateId);
  const noVisibleEligibleCandidates = visibleCandidates.length > 0 && selectableVisibleIds.length === 0;
  const allVisibleSelected = selectableVisibleIds.length > 0
    && visibleCandidates.every((candidate) =>
      candidate.cleanability.kind !== "cleanable" || candidate.selected,
    );
  const settingsBusy = view.settings.phase === "loading";
  const scanBusy = view.scan.phase === "discovering" || view.scan.phase === "measuring";
  const batchRunning = view.batch?.phase === "running";
  const workflowFailure = view.settings.failure ?? view.scan.failure;
  const displayedMessage = message ?? (workflowFailure ? failureMessage(workflowFailure) : null);

  const cycleSort = (key: ProjectDataSort) => {
    if (key === sort) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSort(key);
      setSortDir(defaultSortDir(key));
    }
  };

  const report = (outcome: WorkflowOutcome<unknown>, title: string) => {
    if (outcome.kind === "failed") {
      setMessage({ tone: "bad", title, message: outcome.failure.message });
    } else if (outcome.kind === "invalid") {
      setMessage({ tone: "bad", title, message: outcome.message });
    }
  };

  const copyPath = async (path: string) => {
    try {
      await writeText(path);
      toast.success("路径已复制");
    } catch (error) {
      setMessage({ tone: "bad", title: "复制路径失败", message: errorText(error) });
    }
  };

  const saveDepth = async () => {
    if (!depthChanged || !depthValid) return;
    setMessage(null);
    report(await workflow.setMaxDepth(draftDepth), "无法更新扫描深度");
  };

  return (
    <main className="view-grid">
      {displayedMessage ? (
        <Alert variant="destructive">
          <AlertTitle>{displayedMessage.title}</AlertTitle>
          <AlertDescription>{displayedMessage.message}</AlertDescription>
        </Alert>
      ) : null}
      {view.history.warning ? (
        <Alert>
          <AlertTitle>扫描记录不可用</AlertTitle>
          <AlertDescription>{view.history.warning}。扫描和清理仍可正常使用。</AlertDescription>
        </Alert>
      ) : null}
      {view.history.recordWarning ? (
        <Alert>
          <AlertTitle>本次扫描记录未保存</AlertTitle>
          <AlertDescription>{view.history.recordWarning}。扫描结果和清理不受影响；下次扫描会重新记录。</AlertDescription>
        </Alert>
      ) : null}

      <Panel>
        <div className="flex flex-wrap items-center gap-2 p-2.5">
          <span className="shrink-0 text-sm font-medium">扫描范围</span>
          {view.settings.phase === "loading" ? (
            <Skeleton className="h-9 min-w-0 flex-1" />
          ) : (
            <Input
              aria-label="扫描根目录"
              className="min-w-0 flex-1"
              id="project-cleanup-root"
              readOnly
              title={view.settings.rootPath ?? undefined}
              value={view.settings.rootPath ? formatHomePath(view.settings.rootPath, homeDirectory) : "尚未选择"}
            />
          )}
          <label className="flex shrink-0 items-center gap-1" htmlFor="project-cleanup-depth">
            <span className="shrink-0 text-xs text-muted-foreground">深度</span>
            <Input
              aria-describedby="project-cleanup-depth-range"
              aria-invalid={!depthValid}
              className="w-16"
              disabled={!view.settings.activePresetId || settingsBusy || scanBusy || Boolean(view.batch)}
              id="project-cleanup-depth"
              max={32}
              min={0}
              onChange={(event) => setDepthDraft(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void saveDepth(); }}
              type="number"
              value={depthDraft}
            />
          </label>
          {depthChanged ? <Button disabled={!depthValid || settingsBusy || scanBusy || Boolean(view.batch)} onClick={() => void saveDepth()} size="sm" type="button" variant="outline">保存深度</Button> : null}
          {scanBusy ? (
            <Button
              className="shrink-0"
              disabled={Boolean(view.batch)}
              onClick={() => report(workflow.requestScanStop(), "无法取消扫描")}
              size="sm"
              type="button"
              variant="outline"
            >
              <X data-icon="inline-start" />
              取消扫描
            </Button>
          ) : null}
          <Button
            className="shrink-0"
            disabled={settingsBusy || depthChanged || !view.settings.rootId || scanBusy || Boolean(view.batch)}
            onClick={() => void workflow.startScan().then((outcome) => report(outcome, "项目派生数据扫描失败"))}
            size="sm"
            type="button"
          >
            <RefreshCw data-icon="inline-start" />
            扫描项目目录
          </Button>
          <Button
            className="shrink-0"
            disabled={!view.settings.rootId || scanBusy || batchRunning}
            onClick={() => void workflow.openRoot().then((outcome) => report(outcome, "打开扫描根目录失败"))}
            size="sm"
            type="button"
            variant="outline"
          >
            <ExternalLink data-icon="inline-start" />
            打开根目录
          </Button>
          <Button
            className="shrink-0"
            disabled={settingsBusy || scanBusy || Boolean(view.batch)}
            onClick={() => void workflow.chooseRoot().then((outcome) => report(outcome, "无法选择扫描根目录"))}
            size="sm"
            type="button"
            variant="outline"
          >
            <FolderOpen data-icon="inline-start" />
            添加目录预设
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button disabled={settingsBusy || scanBusy || Boolean(view.batch) || !view.settings.presets.length} variant="outline" size="sm" type="button">选择目录预设（{view.settings.presets.length}）</Button></DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuGroup>
              {view.settings.presets.map((preset) => {
                const latest = latestRecordForDepth(
                  view.history.byPreset[preset.id] ?? [],
                  preset.maxDepth,
                );
                return (
                  <DropdownMenuItem key={preset.id} onSelect={() => void workflow.selectPreset(preset.id).then((outcome) => report(outcome, "无法切换目录预设"))}>
                    <div className="flex max-w-96 flex-col gap-0.5 whitespace-normal">
                      <span>{formatHomePath(preset.path, homeDirectory)} · 深度 {preset.maxDepth}{preset.id === view.settings.activePresetId ? " · 当前" : ""}</span>
                      <span className="text-xs text-muted-foreground">{presetHistoryLabel(view.history, latest)}</span>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup></DropdownMenuContent>
          </DropdownMenu>
          {view.settings.activePresetId ? <Button disabled={settingsBusy || scanBusy || Boolean(view.batch)} variant="outline" size="sm" type="button" onClick={() => void workflow.removePreset(view.settings.activePresetId!).then((outcome) => report(outcome, "无法移除目录预设"))}>移除当前预设（不删除目录）</Button> : null}
          <span className="text-xs text-muted-foreground">预设只保存扫描根目录和深度，切换后需要重新扫描。</span>
        </div>
        <ObservationState className="px-3 pb-2" item={coverageItem} showNote={false} variant="strip" />
        {activePreset ? (
          <ProjectScanSummary
            depth={view.settings.maxDepth}
            history={view.history}
            latest={latestAtDepth}
            onOpen={() => setHistoryOpen(true)}
            otherDepthCount={otherDepthCount}
          />
        ) : null}
        <p className="px-3 pb-3 text-xs text-muted-foreground" id="project-cleanup-depth-range">扫描深度为 0–32 的整数；0 只检查根目录，每增加 1 多检查一层子目录。</p>
        {!depthValid ? <p className="px-3 pb-3 text-sm text-destructive" role="alert">请输入 0 到 32 之间的整数，再保存深度。</p> : null}
        {view.settings.rootMessage ? <Alert><AlertTitle>扫描目录不可用</AlertTitle><AlertDescription>{view.settings.rootMessage}。目录恢复后可重新选择此预设验证。</AlertDescription></Alert> : null}
      </Panel>

      <ProjectDataScanNotice view={view} />

      <Panel className="overflow-hidden">
        <PanelHead
          action={
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{visibleCandidates.length} 项</span>
              <span>已验证 <strong className="font-medium tabular-nums text-foreground">{formatBytes(view.totals.verifiedBytes)}</strong></span>
              <span>待复核 {view.totals.reviewCount} 项 <strong className="font-medium tabular-nums text-foreground">{formatBytes(view.totals.reviewBytes)}</strong></span>
              <span>已选择 {view.totals.selectedCount} 项 <strong className="font-medium tabular-nums text-foreground">{formatBytes(view.totals.selectedBytes)}</strong></span>
              <span>本轮已清理 <strong className="font-medium tabular-nums text-foreground">{formatBytes(view.totals.cleanedBytes)}</strong></span>
            </div>
          }
          title="扫描结果"
        />
        <div className="flex flex-col gap-2">
          <div className="border-b p-2">
            <ToggleGroup
              aria-label="候选类型"
              onValueChange={(value) => {
                if (value === "RustTarget" || value === "MavenTarget" || value === "NodeModules") setKind(value);
              }}
              type="single"
              value={kind}
            >
              <ToggleGroupItem value="RustTarget">
                Rust target
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{rustTotal}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="MavenTarget">
                Maven target
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{mavenTotal}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="NodeModules">
                Node node_modules
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{nodeTotal}</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 p-2">
            <Input
              aria-label="搜索项目或目录路径"
              className="min-w-56 flex-1"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索项目或目录路径"
              type="search"
              value={query}
            />
            <Button
            aria-describedby={noVisibleEligibleCandidates ? "project-cleanup-selection-status" : undefined}
            disabled={!selectableVisibleIds.length || allVisibleSelected || Boolean(view.batch)}
            onClick={() => report(workflow.setSelected(selectableVisibleIds, true), "无法选择可清理候选")}
            size="sm"
            type="button"
            variant="outline"
          >
            <Square data-icon="inline-start" />
            全选当前可清理项
          </Button>
          <Button
            disabled={!view.totals.selectedCount || Boolean(view.batch)}
            onClick={() => report(workflow.clearSelection(), "无法清空选择")}
            size="sm"
            type="button"
            variant="outline"
          >
            取消选择
          </Button>
          <Button
            disabled={!view.totals.selectedCount || Boolean(view.batch)}
            onClick={() => report(
              workflow.prepareCleanupBatch(
                orderedCandidates
                  .filter((candidate) => candidate.selected)
                  .map((candidate) => candidate.candidateId),
              ),
              "无法准备清理批次",
            )}
            size="sm"
            type="button"
            variant="destructive"
          >
            <Trash2 data-icon="inline-start" />
            清理 {view.totals.selectedCount} 项
          </Button>
          {noVisibleEligibleCandidates ? <p className="basis-full text-xs text-muted-foreground" id="project-cleanup-selection-status" role="status">当前筛选中没有可清理项；请查看各行状态及资格原因。</p> : null}
        </div>

        {view.scan.phase === "discovering" && !view.scan.session ? (
          <div className="grid gap-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : visibleCandidates.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="选择当前可见的可清理项"
                    aria-describedby={noVisibleEligibleCandidates ? "project-cleanup-selection-status" : undefined}
                    checked={allVisibleSelected}
                    disabled={!selectableVisibleIds.length || Boolean(view.batch)}
                    onCheckedChange={(checked) => {
                      report(
                        workflow.setSelected(selectableVisibleIds, checked === true),
                        "无法更新选择",
                      );
                    }}
                  />
                </TableHead>
                <TableHead
                  aria-sort={sort === "path" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <Button
                    aria-label="按路径排序"
                    className="-ml-2"
                    onClick={() => cycleSort("path")}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    目录路径
                    <SortDirIcon active={sort === "path"} dir={sortDir} />
                  </Button>
                </TableHead>
                <TableHead
                  aria-sort={sort === "size" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className="text-right"
                >
                  <Button
                    aria-label="按占用排序"
                    className="ml-auto"
                    onClick={() => cycleSort("size")}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    占用
                    <SortDirIcon active={sort === "size"} dir={sortDir} />
                  </Button>
                </TableHead>
                <TableHead
                  aria-sort={sort === "modified" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <Button
                    aria-label="按最近修改时间排序"
                    className="-ml-2"
                    onClick={() => cycleSort("modified")}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    最近修改
                    <SortDirIcon active={sort === "modified"} dir={sortDir} />
                  </Button>
                </TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCandidates.map((candidate) => (
                <ProjectDataRow
                  candidate={candidate}
                  batch={view.batch}
                  copyPath={copyPath}
                  homeDirectory={homeDirectory}
                  key={candidate.candidateId}
                  report={report}
                  workflow={workflow}
                />
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            message={
              query
                ? "没有匹配的项目派生数据，请调整搜索词或切换目录类型"
                : view.scan.session
                  ? kind === "RustTarget"
                    ? "扫描范围内没有发现 Rust target"
                    : kind === "MavenTarget"
                      ? "扫描范围内没有发现 Maven target"
                      : "扫描范围内没有发现 Node node_modules"
                  : "添加或选择目录预设后，点击「扫描项目目录」"
            }
          />
        )}
        </div>
      </Panel>

      {activePreset ? (
        <ProjectScanHistoryDialog
          homeDirectory={homeDirectory}
          onCopyPath={(path) => void copyPath(path)}
          onOpenChange={setHistoryOpen}
          open={historyOpen}
          presetDepth={view.settings.maxDepth}
          presetPath={activePreset.path}
          records={activePresetRecords}
          warning={view.history.warning}
        />
      ) : null}

      <ProjectCleanupDialog
        batch={view.batch}
        homeDirectory={homeDirectory}
        report={report}
        workflow={workflow}
        onShowHistory={onShowHistory}
      />
    </main>
  );
}

function ProjectScanSummary({
  depth,
  history,
  latest,
  onOpen,
  otherDepthCount,
}: {
  depth: number;
  history: ProjectCleanupView["history"];
  latest: ProjectScanRecord | null;
  onOpen: () => void;
  otherDepthCount: number;
}) {
  const loading = history.phase === "idle" || history.phase === "loading";
  const unavailable = history.phase === "failed" || Boolean(history.warning);
  const changes = latest ? scanChangeCounts(latest) : null;
  const delta = latest ? projectDelta(latest) : null;
  let text: string;
  if (loading) {
    text = "正在读取扫描记录…";
  } else if (unavailable) {
    text = "扫描记录不可用";
  } else if (!latest) {
    text = `当前深度（${depth}）尚未扫描${otherDepthCount ? `；该预设其他深度有 ${otherDepthCount} 条记录` : ""}`;
  } else {
    const parts = [
      `上次扫描 ${formatScanTime(latest.finishedAt)}`,
      `深度 ${latest.maxDepth}`,
      `项目 ${latest.projects.total}`,
      `候选 ${latest.candidates.total}`,
    ];
    if (latest.measurement === "stopped") parts.push("测量已取消");
    if (!latest.discovery.complete) {
      parts.push(`发现不完整（跳过 ${latest.discovery.skipped} 个目录），未比较`);
    } else if (latest.changes) {
      if (changes && (changes.added > 0 || changes.removed > 0)) {
        parts.push(`较基线 +${changes.added}/−${changes.removed} 候选`);
      } else {
        parts.push("较基线候选无变化");
      }
      if (delta) parts.push(`项目 ${delta > 0 ? "+" : ""}${delta}`);
      if (latest.baseline) parts.push(`基线 ${formatScanTime(latest.baseline.finishedAt)}`);
    } else if (latest.baseline) {
      parts.push("本次记录未比较变化");
    } else {
      parts.push("首次可比较扫描，暂无基线");
    }
    text = parts.join(" · ");
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <ClockCounterClockwise aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 break-words">{text}</span>
      </span>
      <Button
        className="ml-auto shrink-0"
        disabled={loading}
        onClick={onOpen}
        size="sm"
        type="button"
        variant="ghost"
      >
        查看扫描记录
      </Button>
    </div>
  );
}

function presetHistoryLabel(
  history: ProjectCleanupView["history"],
  latest: ProjectScanRecord | null,
) {
  if (history.phase === "idle" || history.phase === "loading") return "正在读取扫描记录…";
  if (history.phase === "failed" || history.warning) return "扫描记录不可用";
  if (!latest) return "当前深度未扫描";
  const changes = latest.changes
    ? latest.changes.added.length || latest.changes.removed.length
      ? ` · +${latest.changes.added.length}/−${latest.changes.removed.length}`
      : " · 候选无变化"
    : latest.discovery.complete
      ? latest.baseline
        ? " · 未比较"
        : ""
      : " · 发现不完整";
  return `上次扫描 ${formatScanTime(latest.finishedAt)} · 项目 ${latest.projects.total} · 候选 ${latest.candidates.total}${changes}`;
}

function ProjectDataScanNotice({ view }: { view: ProjectCleanupView }) {
  if (view.scan.phase === "stopped") {
    return (
      <Alert>
        <AlertTitle>扫描已取消</AlertTitle>
        <AlertDescription>未开始的占用测量已停止；当前结果可能不完整。</AlertDescription>
      </Alert>
    );
  }
  if (view.scan.pendingMeasurements > 0) {
    return (
      <Alert>
        <AlertTitle>正在测量项目目录</AlertTitle>
        <AlertDescription>还有 {view.scan.pendingMeasurements} 项等待完成。</AlertDescription>
      </Alert>
    );
  }
  const session = view.scan.session;
  const first = session?.errors[0];
  const hasRustCandidates = session?.candidates.some(
    (candidate) => candidate.kind === "RustTarget",
  );
  const hasMavenCandidates = session?.candidates.some(
    (candidate) => candidate.kind === "MavenTarget",
  );
  return session ? (
    <div className="grid gap-2 md:grid-cols-2">
      {session.status === "Partial" ? (
        <Alert>
          <AlertTitle>扫描部分完成</AlertTitle>
          <AlertDescription>
            已跳过 {session.skipped} 个无法读取的目录{first ? `；${first.path}：${first.message}` : ""}。
          </AlertDescription>
        </Alert>
      ) : null}
      {!session.cargoAvailable && hasRustCandidates ? (
        <Alert>
          <AlertTitle>Cargo 不可用</AlertTitle>
          <AlertDescription>{session.cargoMessage ?? "Rust target 不可清理；其他类型不受影响。"}</AlertDescription>
        </Alert>
      ) : null}
      {!session.mavenAvailable && hasMavenCandidates ? (
        <Alert>
          <AlertTitle>Maven 不可用</AlertTitle>
          <AlertDescription>{session.mavenMessage ?? "Maven target 不可清理；其他类型不受影响。"}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  ) : null;
}

function SortDirIcon({ active, dir }: { active: boolean; dir: ProjectDataSortDir }) {
  if (!active) return <CaretUpDown aria-hidden="true" className="text-muted-foreground" data-icon="inline-end" />;
  return dir === "asc"
    ? <ArrowUp aria-hidden="true" data-icon="inline-end" />
    : <ArrowDown aria-hidden="true" data-icon="inline-end" />;
}

function ProjectDataRow({
  batch,
  candidate,
  copyPath,
  homeDirectory,
  report,
  workflow,
}: {
  batch: CleanupBatchView | null;
  candidate: ProjectCleanupCandidateView;
  copyPath: (path: string) => Promise<void>;
  homeDirectory: string | null;
  report: (outcome: WorkflowOutcome<unknown>, title: string) => void;
  workflow: ProjectCleanupWorkflow;
}) {
  const selectable = candidate.cleanability.kind === "cleanable";
  const displayName = rowProjectName(candidate);
  const blockedReason = candidateCleanabilityMessage(candidate);
  const blockedReasonId = `project-candidate-${encodeURIComponent(candidate.candidateId)}-eligibility`;
  const active = batch?.phase === "running"
    && batch.candidates.some(
      (item) => item.candidateId === candidate.candidateId && item.state.kind === "running",
    );

  return (
    <TableRow data-state={candidate.selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          aria-label={`选择 ${displayName}`}
          aria-describedby={!selectable ? blockedReasonId : undefined}
          checked={candidate.selected}
          disabled={!selectable || Boolean(batch)}
          onCheckedChange={(checked) => report(
            workflow.setSelected([candidate.candidateId], checked === true),
            "无法更新选择",
          )}
        />
      </TableCell>
      <TableCell className="max-w-96 whitespace-normal">
        <span className="block truncate text-xs text-muted-foreground" title={candidate.directoryPath}>
          {highlightPathName(formatHomePath(candidate.directoryPath, homeDirectory), displayName)}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {measurementSize(candidate)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatModified(candidate.measurement.latestModifiedMs)}
      </TableCell>
      <TableCell>
        <CandidateStatusBadge active={active} candidate={candidate} />
        {blockedReason ? <p className="mt-1 max-w-64 text-xs text-muted-foreground" id={blockedReasonId}>{blockedReason}</p> : null}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <IconButton label={`复制 ${candidateDirectoryName(candidate)} 路径`} onClick={() => void copyPath(candidate.directoryPath)}>
            <Copy />
          </IconButton>
          <IconButton
            label="打开项目目录"
            onClick={() => void workflow.openCandidate(candidate.candidateId, "Project").then(
              (outcome) => report(outcome, "打开项目目录失败"),
            )}
          >
            <FolderOpen />
          </IconButton>
          <IconButton
            disabled={candidate.measurement.status === "Missing"}
            label={`打开 ${candidateDirectoryName(candidate)} 目录`}
            onClick={() => void workflow.openCandidate(candidate.candidateId, "Directory").then(
              (outcome) => report(outcome, "打开项目派生数据目录失败"),
            )}
          >
            <ExternalLink />
          </IconButton>
        </div>
      </TableCell>
    </TableRow>
  );
}

function candidateCleanabilityMessage(candidate: ProjectCleanupCandidateView): string | null {
  if (candidate.cleanability.kind === "cleanable") return null;
  if (candidate.cleanability.kind === "measuring") return "正在测量目录占用，完成后可选择清理。";
  if (candidate.cleanability.kind === "requires-rescan") return "该候选已尝试清理；重新扫描后才能再次选择。";

  if (candidate.cleanability.reason === "identity-not-verified") {
    if (candidate.status === "Symlink") return candidate.message ? `目标是符号链接，未验证实际目录身份。${candidate.message}` : "目标是符号链接，未验证实际目录身份。";
    if (candidate.status === "NotDirectory") return candidate.message ? `目标不是目录，无法清理。${candidate.message}` : "目标不是目录，无法清理。";
    return candidate.message ? `目录身份尚未验证；请重新扫描复核。${candidate.message}` : "目录身份尚未验证；请重新扫描复核。";
  }

  if (candidate.cleanability.reason === "directory-footprint-incomplete") {
    const evidence = candidate.measurement.message
      ? `${candidate.measurement.message}。`
      : candidate.measurement.skipped > 0
        ? `仍有 ${candidate.measurement.skipped} 项未能测量。`
        : "目录占用尚未完整测量。";
    return `${evidence}完整测量后才能选择；可刷新扫描重试。`;
  }

  const tool = candidate.kind === "RustTarget" ? "Cargo" : "Maven";
  const target = candidate.kind === "RustTarget" ? "Rust target" : "Maven target";
  return `${target} 清理需要可用的 ${tool}；请安装或恢复 ${tool} 后重新扫描。`;
}

function CandidateStatusBadge({
  active,
  candidate,
}: {
  active: boolean;
  candidate: ProjectCleanupCandidateView;
}) {
  if (active) return <Badge variant="secondary">清理中</Badge>;
  if (candidate.cleanup.kind === "attempted" && candidate.cleanup.outcome.kind === "effect-failed") {
    return (
      <Badge title={candidate.cleanup.outcome.failure.message} variant="destructive">
        调用失败
      </Badge>
    );
  }
  if (candidate.cleanup.kind === "attempted" && candidate.cleanup.outcome.kind === "result") {
    const cleanupResult = candidate.cleanup.outcome.result;
    const labels: Record<ProjectCleanupResult["status"], string> = {
      Succeeded: "已清理",
      PartiallyCompleted: "部分完成",
      Failed: "清理失败",
      Skipped: "已不存在",
      Rejected: "已拒绝",
    };
    return (
      <Badge
        title={cleanupResult.message ?? undefined}
        variant={cleanupResult.status === "Succeeded" ? "default" : cleanupResult.status === "Skipped" ? "outline" : "destructive"}
      >
        {labels[cleanupResult.status]}
      </Badge>
    );
  }
  if (
    candidate.cleanability.kind === "blocked"
    && candidate.cleanability.reason === "identity-not-verified"
  ) {
    const labels = {
      Symlink: "符号链接",
      NotDirectory: "不是目录",
      Unrecognized: "待复核",
      Ready: "可清理",
    };
    return <Badge title={candidate.message ?? undefined} variant="outline">{labels[candidate.status]}</Badge>;
  }
  if (candidate.cleanability.kind === "measuring") {
    return <Badge variant="secondary">测量中</Badge>;
  }
  if (
    candidate.cleanability.kind === "blocked"
    && candidate.cleanability.reason === "directory-footprint-incomplete"
    && candidate.measurement.status === "Partial"
  ) {
    return <Badge title={candidate.measurement.message ?? undefined} variant="destructive">测量不完整</Badge>;
  }
  if (
    candidate.cleanability.kind === "blocked"
    && candidate.cleanability.reason === "directory-footprint-incomplete"
  ) {
    return <Badge title={candidate.measurement.message ?? undefined} variant="destructive">不可测量</Badge>;
  }
  if (
    candidate.cleanability.kind === "blocked"
    && candidate.cleanability.reason === "cleanup-mechanism-unavailable"
  ) {
    return (
      <Badge variant="outline">
        {candidate.kind === "RustTarget" ? "Cargo 不可用" : "Maven 不可用"}
      </Badge>
    );
  }
  if (candidate.cleanability.kind === "cleanable") return <Badge>可清理</Badge>;
  return <Badge variant="outline">需要重新扫描</Badge>;
}

function ProjectCleanupDialog({
  batch,
  homeDirectory,
  report,
  workflow,
  onShowHistory,
}: {
  batch: CleanupBatchView | null;
  homeDirectory: string | null;
  report: (outcome: WorkflowOutcome<unknown>, title: string) => void;
  workflow: ProjectCleanupWorkflow;
  onShowHistory?: (recordId: string) => void;
}) {
  const [batchHistory, setBatchHistory] = useState<{ id: string; warning: string | null } | null>(null);
  const candidates = batch?.candidates ?? [];
  const rustCount = candidates.filter((candidate) => candidate.kind === "RustTarget").length;
  const mavenCount = candidates.filter((candidate) => candidate.kind === "MavenTarget").length;
  const nodeCount = candidates.length - rustCount - mavenCount;
  const candidateSummary = [
    rustCount ? `${rustCount} 个 Rust target` : null,
    mavenCount ? `${mavenCount} 个 Maven target` : null,
    nodeCount ? `${nodeCount} 个 Node node_modules` : null,
  ].filter(Boolean).join("、");
  const failed = candidates.filter((candidate) => {
    if (candidate.state.kind !== "finished") return false;
    return candidate.state.outcome.kind === "effect-failed"
      || !["Succeeded", "Skipped"].includes(candidate.state.outcome.result.status);
  }).length;

  const runCleanup = async () => {
    setBatchHistory(null);
    const outcome = await workflow.runCleanupBatch();
    report(outcome, "项目清理失败");
    if (outcome.kind !== "succeeded") return;
    const summary = outcome.value;
    if (summary.historyId || summary.historyWarning) {
      setBatchHistory({ id: summary.historyId ?? "", warning: summary.historyWarning });
    }
    if (summary.finish === "stopped") {
      toast.warning("项目清理已停止", {
        description: `已处理 ${summary.completedCount}/${summary.totalCount} 项`,
      });
    } else if (summary.failedCount === 0) {
      toast.success("项目清理完成", {
        description: `已清理目录占用 ${formatBytes(summary.cleanedBytes)}`,
      });
    } else {
      toast.warning("项目清理部分完成", {
        description: `已处理 ${summary.completedCount}/${summary.totalCount} 项`,
      });
    }
  };

  return (
    <AlertDialog open={Boolean(batch)} onOpenChange={(open) => {
      if (!open) report(workflow.closeCleanupBatch(), "无法关闭清理批次");
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {batch?.phase === "result"
              ? "项目清理结果"
              : batch?.phase === "running"
                ? "正在清理项目目录"
                : "确认项目清理"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {batch?.phase === "result"
              ? `已处理 ${batch.completedCount}/${candidates.length} 项，已清理目录占用 ${formatBytes(batch.cleanedBytes)}。`
              : batch?.phase === "running"
                ? `正在处理第 ${Math.min(batch.completedCount + 1, candidates.length)}/${candidates.length} 项。停止清理会等待当前项完成，其余项不再开始。`
                : `将永久清理 ${candidateSummary}，目录占用 ${formatBytes(batch?.selectedBytes ?? 0)}。`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {batch?.phase === "result" && batchHistory ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {batchHistory.warning ? <p className="text-muted-foreground">维护历史未完整保存：{batchHistory.warning}</p> : null}
            {batchHistory.id && onShowHistory ? <Button onClick={() => { workflow.closeCleanupBatch(); onShowHistory(batchHistory.id); }} size="sm" type="button" variant="outline">已保存到维护历史</Button> : null}
          </div>
        ) : null}

        <div className="max-h-64 overflow-y-auto border bg-muted/20">
          {candidates.map((candidate) => {
            const outcome = candidate.state.kind === "finished" ? candidate.state.outcome : null;
            const result = outcome?.kind === "result" ? outcome.result : null;
            const error = outcome?.kind === "effect-failed" ? outcome.failure.message : null;
            const stopped = candidate.state.kind === "stopped";
            return (
              <div className="grid gap-1 border-b px-3 py-2 last:border-b-0" key={candidate.candidateId}>
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{rowProjectName(candidate)}</span>
                    <Badge variant="outline">{candidateTypeLabel(candidate)}</Badge>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {result ? formatBytes(result.cleanedBytes) : formatBytes(candidate.beforeBytes)}
                  </span>
                </div>
                <span className="truncate text-xs text-muted-foreground" title={candidate.directoryPath}>
                  {formatHomePath(candidate.directoryPath, homeDirectory)}
                </span>
                {error ? <span className="text-xs text-destructive">{error}</span> : null}
                {stopped ? <span className="text-xs text-muted-foreground">未执行</span> : null}
              </div>
            );
          })}
        </div>

        {batch?.phase === "confirmation" ? (
          <Alert>
            <AlertTitle>清理不可撤销</AlertTitle>
            <AlertDescription>{cleanupWarning(rustCount, mavenCount, nodeCount)}</AlertDescription>
          </Alert>
        ) : null}
        {batch?.phase === "result" && failed > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>{failed} 项未完整清理</AlertTitle>
            <AlertDescription>行内状态保留到下次扫描，可打开项目检查后再处理。</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          {batch?.phase === "result" ? (
            <AlertDialogCancel asChild>
              <Button
                onClick={() => report(workflow.closeCleanupBatch(), "无法关闭清理批次")}
                type="button"
                variant="outline"
              >
                关闭
              </Button>
            </AlertDialogCancel>
          ) : batch?.phase === "running" ? (
            <Button
              disabled={batch.stopRequested}
              onClick={() => report(workflow.requestCleanupStop(), "无法停止清理批次")}
              type="button"
              variant="outline"
            >
              {batch.stopRequested ? "等待当前项完成" : "完成当前项后停止"}
            </Button>
          ) : (
            <>
              <AlertDialogCancel asChild>
                <Button
                  onClick={() => report(workflow.closeCleanupBatch(), "无法取消清理批次")}
                  type="button"
                  variant="outline"
                >
                  取消
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  onClick={(event) => {
                    event.preventDefault();
                    void runCleanup();
                  }}
                  type="button"
                  variant="destructive"
                >
                  <Trash2 data-icon="inline-start" />
                  清理选中项
                </Button>
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function candidateDirectoryName(candidate: Pick<ProjectCleanupCandidateView, "kind">) {
  return candidate.kind === "NodeModules" ? "node_modules" : "target";
}

function candidateTypeLabel(candidate: Pick<ProjectCleanupCandidateView, "kind">) {
  if (candidate.kind === "RustTarget") return "Rust target";
  if (candidate.kind === "MavenTarget") return "Maven target";
  return "Node node_modules";
}

function highlightPathName(formattedPath: string, name: string) {
  if (!name) return formattedPath;
  const tokens = formattedPath.split(/([/\\])/);
  if (!tokens.some((token) => token === name)) return formattedPath;
  return tokens.map((token, index) =>
    token === name ? (
      <Fragment key={index}>
        <span className="font-medium text-primary">{token}</span>
      </Fragment>
    ) : (
      <Fragment key={index}>{token}</Fragment>
    ),
  );
}

function rowProjectName(candidate: Pick<ProjectCleanupCandidateView, "kind" | "projectPath">) {
  // Tauri 应用的 Rust 工程在 src-tauri 子目录里，直接显示末段会撞名；
  // 此时显示上一级目录（真正的项目名），第二行完整路径保持不变。
  if (candidate.kind === "RustTarget") {
    const parts = candidate.projectPath.split(/[\\/]/).filter(Boolean);
    if (parts.length >= 2 && parts[parts.length - 1] === "src-tauri") {
      return parts[parts.length - 2];
    }
  }
  return projectName(candidate.projectPath);
}

function cleanupWarning(rustCount: number, mavenCount: number, nodeCount: number) {
  const recovery = [
    rustCount ? "Rust target 需要重新构建" : null,
    mavenCount ? "Maven target 需要重新构建" : null,
    nodeCount ? "Node node_modules 需要重新安装依赖" : null,
  ].filter(Boolean).join("；");
  return `${recovery}。目录不会进入废纸篓，正在运行的构建、开发或测试任务可能受影响。`;
}

function measurementSize(candidate: ProjectCleanupCandidateView) {
  const measurement = candidate.measurement;
  if (candidate.status === "Symlink" || candidate.status === "NotDirectory") return "-";
  if (measurement.status === "Pending") return "测量中";
  if (measurement.bytes === null) return "-";
  return measurement.status === "Partial" ? `≥ ${measurement.human ?? formatBytes(measurement.bytes)}` : measurement.human ?? formatBytes(measurement.bytes);
}

function formatModified(milliseconds: number | null) {
  if (milliseconds === null) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(milliseconds));
}

function failureMessage(failure: WorkflowFailure): UiMessage {
  const titles: Record<WorkflowFailure["operation"], string> = {
    settings: "无法读取项目清理设置",
    root: "无法选择扫描根目录",
    scan: "项目派生数据扫描失败",
    measure: "项目派生数据测量失败",
    clean: "项目清理失败",
    open: "打开项目路径失败",
  };
  return { tone: "bad", title: titles[failure.operation], message: failure.message };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
