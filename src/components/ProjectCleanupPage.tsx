import { Copy, ExternalLink, FolderOpen, RefreshCw, Square, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import {
  projectName,
  filterAndSortProjectData,
  type ProjectDataFilter,
  type ProjectDataSort,
} from "../projectCleanup";
import type {
  CleanupBatchView,
  ProjectCleanupCandidateView,
  ProjectCleanupView,
  ProjectCleanupWorkflow,
  WorkflowFailure,
  WorkflowOutcome,
} from "../projectCleanupWorkflow";
import type { ProjectCleanupResult, UiMessage } from "../types";
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
import { EmptyState, IconButton, Panel, PanelHead, StatCard } from "./ui";

export function ProjectCleanupPage({
  homeDirectory,
  view,
  workflow,
}: {
  homeDirectory: string | null;
  view: ProjectCleanupView;
  workflow: ProjectCleanupWorkflow;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectDataSort>("size");
  const [kind, setKind] = useState<ProjectDataFilter>("all");
  const [message, setMessage] = useState<UiMessage | null>(null);
  const candidates = view.scan.session?.candidates ?? [];
  const orderedCandidates = useMemo(
    () => filterAndSortProjectData(candidates, "", sort, "all"),
    [candidates, sort],
  );
  const visibleCandidates = useMemo(
    () => filterAndSortProjectData(candidates, query, sort, kind),
    [candidates, kind, query, sort],
  );
  const selectableVisibleIds = visibleCandidates
    .filter((candidate) => candidate.cleanability.kind === "cleanable")
    .map((candidate) => candidate.candidateId);
  const allVisibleSelected = Boolean(selectableVisibleIds.length)
    && selectableVisibleIds.every((candidateId) =>
      candidates.find((candidate) => candidate.candidateId === candidateId)?.selected,
    );
  const scanBusy = view.scan.phase === "discovering" || view.scan.phase === "measuring";
  const batchRunning = view.batch?.phase === "running";
  const workflowFailure = view.settings.failure ?? view.scan.failure;
  const displayedMessage = message ?? (workflowFailure ? failureMessage(workflowFailure) : null);

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

  return (
    <main className="view-grid">
      {displayedMessage ? (
        <Alert variant="destructive">
          <AlertTitle>{displayedMessage.title}</AlertTitle>
          <AlertDescription>{displayedMessage.message}</AlertDescription>
        </Alert>
      ) : null}

      <Panel>
        <PanelHead
          action={
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                disabled={!view.settings.rootId || scanBusy || batchRunning}
                onClick={() => void workflow.openRoot().then((outcome) => report(outcome, "打开扫描根目录失败"))}
                size="sm"
                type="button"
                variant="outline"
              >
                <ExternalLink data-icon="inline-start" />
                打开
              </Button>
              <Button
                disabled={scanBusy || Boolean(view.batch)}
                onClick={() => void workflow.chooseRoot().then((outcome) => report(outcome, "无法选择扫描根目录"))}
                size="sm"
                type="button"
                variant="outline"
              >
                <FolderOpen data-icon="inline-start" />
                选择目录
              </Button>
            </div>
          }
          eyebrow="扫描范围"
          title="项目派生数据"
        />
        <div className="grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_100px_auto] md:items-end">
          <label className="grid min-w-0 gap-1.5" htmlFor="project-cleanup-root">
            <span className="text-xs font-medium text-muted-foreground">扫描根目录</span>
            {view.settings.phase === "loading" ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Input
                id="project-cleanup-root"
                readOnly
                title={view.settings.rootPath ?? undefined}
                value={view.settings.rootPath ? formatHomePath(view.settings.rootPath, homeDirectory) : "尚未选择"}
              />
            )}
          </label>
          <label className="grid gap-1.5" htmlFor="project-cleanup-depth">
            <span className="text-xs font-medium text-muted-foreground">最大深度</span>
            <Input
              aria-describedby="project-cleanup-depth-range"
              disabled={scanBusy || Boolean(view.batch)}
              id="project-cleanup-depth"
              max={32}
              min={0}
              onChange={(event) => report(workflow.setMaxDepth(event.currentTarget.valueAsNumber), "无法更新扫描深度")}
              type="number"
              value={view.settings.maxDepth}
            />
            <span className="sr-only" id="project-cleanup-depth-range">范围 0 到 32</span>
          </label>
          <div className="flex gap-2">
            {scanBusy ? (
              <Button
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
              disabled={!view.settings.rootId || scanBusy || Boolean(view.batch)}
              onClick={() => void workflow.startScan().then((outcome) => report(outcome, "项目派生数据扫描失败"))}
              size="sm"
              type="button"
            >
              <RefreshCw data-icon="inline-start" />
              扫描
            </Button>
          </div>
        </div>
      </Panel>

      <section aria-label="项目清理指标" className="stat-grid grid-cols-2 md:grid-cols-4">
        <StatCard label="已验证目录占用" value={formatBytes(view.totals.verifiedBytes)} />
        <StatCard label={`待复核 ${view.totals.reviewCount} 项`} value={formatBytes(view.totals.reviewBytes)} />
        <StatCard label={`已选择 ${view.totals.selectedCount} 项`} value={formatBytes(view.totals.selectedBytes)} />
        <StatCard label="本轮已清理" value={formatBytes(view.totals.cleanedBytes)} />
      </section>

      <ProjectDataScanNotice view={view} />

      <Panel className="overflow-hidden">
        <PanelHead
          action={<span className="text-xs font-medium text-muted-foreground">{visibleCandidates.length} 项</span>}
          eyebrow="项目派生数据"
          title="扫描结果"
        />
        <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 p-2">
          <Input
            aria-label="搜索项目或目录路径"
            className="min-w-56 flex-1"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索项目或目录路径"
            type="search"
            value={query}
          />
          <ToggleGroup
            aria-label="候选类型"
            onValueChange={(value) => {
              if (value === "all" || value === "RustTarget" || value === "NodeModules") {
                setKind(value);
              }
            }}
            spacing={0}
            type="single"
            value={kind}
            variant="outline"
          >
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
            <ToggleGroupItem value="RustTarget">Rust target</ToggleGroupItem>
            <ToggleGroupItem value="NodeModules">Node node_modules</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            aria-label="结果排序"
            onValueChange={(value) => {
              if (value === "size" || value === "modified" || value === "path") setSort(value);
            }}
            spacing={0}
            type="single"
            value={sort}
            variant="outline"
          >
            <ToggleGroupItem value="size">占用</ToggleGroupItem>
            <ToggleGroupItem value="modified">活跃</ToggleGroupItem>
            <ToggleGroupItem value="path">路径</ToggleGroupItem>
          </ToggleGroup>
          <Button
            disabled={!selectableVisibleIds.length || allVisibleSelected || Boolean(view.batch)}
            onClick={() => report(workflow.setSelected(selectableVisibleIds, true), "无法选择可清理候选")}
            size="sm"
            type="button"
            variant="outline"
          >
            <Square data-icon="inline-start" />
            全选可清理项
          </Button>
          <Button
            disabled={!view.totals.selectedCount || Boolean(view.batch)}
            onClick={() => report(workflow.clearSelection(), "无法清空选择")}
            size="sm"
            type="button"
            variant="outline"
          >
            清空
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
                <TableHead>项目</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>目录路径</TableHead>
                <TableHead className="text-right">占用</TableHead>
                <TableHead>最近活跃</TableHead>
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
                ? "没有匹配的项目派生数据"
                : view.scan.session
                  ? "扫描范围内没有发现项目派生数据"
                  : "选择根目录后开始扫描"
            }
          />
        )}
      </Panel>

      <ProjectCleanupDialog
        batch={view.batch}
        homeDirectory={homeDirectory}
        report={report}
        workflow={workflow}
      />
    </main>
  );
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
          <AlertDescription>{session.cargoMessage ?? "Rust target 不可清理；node_modules 不受影响。"}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  ) : null;
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
  const active = batch?.phase === "running"
    && batch.candidates.some(
      (item) => item.candidateId === candidate.candidateId && item.state.kind === "running",
    );

  return (
    <TableRow data-state={candidate.selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          aria-label={`选择 ${projectName(candidate.projectPath)}`}
          checked={candidate.selected}
          disabled={!selectable || Boolean(batch)}
          onCheckedChange={(checked) => report(
            workflow.setSelected([candidate.candidateId], checked === true),
            "无法更新选择",
          )}
        />
      </TableCell>
      <TableCell className="max-w-56 whitespace-normal">
        <span className="block truncate font-medium" title={candidate.projectPath}>
          {projectName(candidate.projectPath)}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground" title={candidate.projectPath}>
          {formatHomePath(candidate.projectPath, homeDirectory)}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{candidateTypeLabel(candidate)}</Badge>
      </TableCell>
      <TableCell className="max-w-80 whitespace-normal">
        <span className="block truncate text-xs text-muted-foreground" title={candidate.directoryPath}>
          {formatHomePath(candidate.directoryPath, homeDirectory)}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {measurementSize(candidate)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatModified(candidate.measurement.latestModifiedMs)}
      </TableCell>
      <TableCell>
        <CandidateStatusBadge
          active={active}
          candidate={candidate}
        />
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
    return <Badge variant="outline">Cargo 不可用</Badge>;
  }
  if (candidate.cleanability.kind === "cleanable") return <Badge>可清理</Badge>;
  return <Badge variant="outline">需要重新扫描</Badge>;
}

function ProjectCleanupDialog({
  batch,
  homeDirectory,
  report,
  workflow,
}: {
  batch: CleanupBatchView | null;
  homeDirectory: string | null;
  report: (outcome: WorkflowOutcome<unknown>, title: string) => void;
  workflow: ProjectCleanupWorkflow;
}) {
  const candidates = batch?.candidates ?? [];
  const rustCount = candidates.filter((candidate) => candidate.kind === "RustTarget").length;
  const nodeCount = candidates.length - rustCount;
  const candidateSummary = [
    rustCount ? `${rustCount} 个 Rust target` : null,
    nodeCount ? `${nodeCount} 个 Node node_modules` : null,
  ].filter(Boolean).join("、");
  const failed = candidates.filter((candidate) => {
    if (candidate.state.kind !== "finished") return false;
    return candidate.state.outcome.kind === "effect-failed"
      || !["Succeeded", "Skipped"].includes(candidate.state.outcome.result.status);
  }).length;

  const runCleanup = async () => {
    const outcome = await workflow.runCleanupBatch();
    report(outcome, "项目清理失败");
    if (outcome.kind !== "succeeded") return;
    const summary = outcome.value;
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
                ? `正在处理 ${Math.min(batch.completedCount + 1, candidates.length)}/${candidates.length}；取消将在当前项目完成后生效。`
                : `将永久清理 ${candidateSummary}，目录占用 ${formatBytes(batch?.selectedBytes ?? 0)}。`}
          </AlertDialogDescription>
        </AlertDialogHeader>

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
                    <span className="truncate text-sm font-medium">{projectName(candidate.projectPath)}</span>
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
            <AlertDescription>{cleanupWarning(rustCount, nodeCount)}</AlertDescription>
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
  return candidate.kind === "RustTarget" ? "target" : "node_modules";
}

function candidateTypeLabel(candidate: Pick<ProjectCleanupCandidateView, "kind">) {
  return candidate.kind === "RustTarget" ? "Rust target" : "Node node_modules";
}

function cleanupWarning(rustCount: number, nodeCount: number) {
  const recovery = [
    rustCount ? "Rust target 需要重新构建" : null,
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
