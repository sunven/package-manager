import { Copy, ExternalLink, FolderOpen, RefreshCw, Square, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  projectDataMetrics,
  projectName,
  projectDataSelectable,
  filterAndSortProjectData,
  type ProjectDataFilter,
  type ProjectDataSort,
} from "../projectCleanup";
import type { ProjectCleanupController } from "../hooks/useProjectCleanup";
import type { ProjectDataCandidate, ProjectCleanupResult } from "../types";
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
  controller,
  homeDirectory,
}: {
  controller: ProjectCleanupController;
  homeDirectory: string | null;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectDataSort>("size");
  const [kind, setKind] = useState<ProjectDataFilter>("all");
  const visibleCandidates = useMemo(
    () => filterAndSortProjectData(controller.scan?.candidates ?? [], query, sort, kind),
    [controller.scan?.candidates, kind, query, sort],
  );
  const selectableVisibleIds = visibleCandidates
    .filter((candidate) =>
      projectDataSelectable(
        candidate,
        controller.scan?.cargoAvailable ?? false,
        controller.cleanupResults.get(candidate.candidateId),
      ),
    )
    .filter((candidate) => !controller.cleanupErrors.has(candidate.candidateId))
    .filter((candidate) => !controller.cancelledCleanupIds.has(candidate.candidateId))
    .map((candidate) => candidate.candidateId);
  const allVisibleSelected = Boolean(selectableVisibleIds.length) && selectableVisibleIds.every((id) => controller.selectedIds.has(id));
  const metrics = projectDataMetrics(controller.scan, controller.selectedIds, controller.cleanupResults);
  const scanBusy = controller.discovering || controller.pendingMeasurements > 0;

  return (
    <main className="view-grid">
      {controller.message ? (
        <Alert variant="destructive">
          <AlertTitle>{controller.message.title}</AlertTitle>
          <AlertDescription>{controller.message.message}</AlertDescription>
        </Alert>
      ) : null}

      <Panel>
        <PanelHead
          action={
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                disabled={!controller.settings.rootId || scanBusy || controller.cleaning}
                onClick={() => void controller.openRoot()}
                size="sm"
                type="button"
                variant="outline"
              >
                <ExternalLink data-icon="inline-start" />
                打开
              </Button>
              <Button
                disabled={scanBusy || controller.cleaning}
                onClick={() => void controller.chooseRoot()}
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
            {controller.settingsLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Input
                id="project-cleanup-root"
                readOnly
                title={controller.settings.rootPath ?? undefined}
                value={controller.settings.rootPath ? formatHomePath(controller.settings.rootPath, homeDirectory) : "尚未选择"}
              />
            )}
          </label>
          <label className="grid gap-1.5" htmlFor="project-cleanup-depth">
            <span className="text-xs font-medium text-muted-foreground">最大深度</span>
            <Input
              aria-describedby="project-cleanup-depth-range"
              disabled={scanBusy || controller.cleaning}
              id="project-cleanup-depth"
              max={32}
              min={0}
              onChange={(event) => controller.setMaxDepth(event.currentTarget.valueAsNumber)}
              type="number"
              value={controller.maxDepth}
            />
            <span className="sr-only" id="project-cleanup-depth-range">范围 0 到 32</span>
          </label>
          <div className="flex gap-2">
            {scanBusy ? (
              <Button onClick={controller.cancelScan} size="sm" type="button" variant="outline">
                <X data-icon="inline-start" />
                取消扫描
              </Button>
            ) : null}
            <Button
              disabled={!controller.settings.rootId || scanBusy || controller.cleaning}
              onClick={() => void controller.runScan()}
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
        <StatCard label="已验证目录占用" value={formatBytes(metrics.verifiedBytes)} />
        <StatCard label={`待复核 ${metrics.reviewCount} 项`} value={formatBytes(metrics.reviewBytes)} />
        <StatCard label={`已选择 ${controller.selectedIds.size} 项`} value={formatBytes(metrics.selectedBytes)} />
        <StatCard label="本轮已清理" value={formatBytes(metrics.cleanedBytes)} />
      </section>

      <ProjectDataScanNotice controller={controller} />

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
            disabled={!selectableVisibleIds.length || allVisibleSelected || controller.cleaning}
            onClick={() => controller.selectVisible(selectableVisibleIds)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Square data-icon="inline-start" />
            全选可清理项
          </Button>
          <Button
            disabled={!controller.selectedIds.size || controller.cleaning}
            onClick={controller.clearSelection}
            size="sm"
            type="button"
            variant="outline"
          >
            清空
          </Button>
          <Button
            disabled={!controller.selectedIds.size || controller.cleaning}
            onClick={controller.requestCleanup}
            size="sm"
            type="button"
            variant="destructive"
          >
            <Trash2 data-icon="inline-start" />
            清理 {controller.selectedIds.size} 项
          </Button>
        </div>

        {controller.discovering && !controller.scan ? (
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
                    disabled={!selectableVisibleIds.length || controller.cleaning}
                    onCheckedChange={(checked) => {
                      if (checked === true) controller.selectVisible(selectableVisibleIds);
                      else controller.unselectVisible(selectableVisibleIds);
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
                  cleanupError={controller.cleanupErrors.get(candidate.candidateId)}
                  cleanupResult={controller.cleanupResults.get(candidate.candidateId)}
                  controller={controller}
                  homeDirectory={homeDirectory}
                  key={candidate.candidateId}
                  selected={controller.selectedIds.has(candidate.candidateId)}
                />
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            message={
              query
                ? "没有匹配的项目派生数据"
                : controller.scan
                  ? "扫描范围内没有发现项目派生数据"
                  : "选择根目录后开始扫描"
            }
          />
        )}
      </Panel>

      <ProjectCleanupDialog controller={controller} homeDirectory={homeDirectory} />
    </main>
  );
}

function ProjectDataScanNotice({ controller }: { controller: ProjectCleanupController }) {
  if (controller.scanCancelled) {
    return (
      <Alert>
        <AlertTitle>扫描已取消</AlertTitle>
        <AlertDescription>未开始的占用测量已停止；当前结果可能不完整。</AlertDescription>
      </Alert>
    );
  }
  if (controller.pendingMeasurements > 0) {
    return (
      <Alert>
        <AlertTitle>正在测量项目目录</AlertTitle>
        <AlertDescription>还有 {controller.pendingMeasurements} 项等待完成。</AlertDescription>
      </Alert>
    );
  }
  const first = controller.scan?.errors[0];
  const hasRustCandidates = controller.scan?.candidates.some(
    (candidate) => candidate.kind === "RustTarget",
  );
  return controller.scan ? (
    <div className="grid gap-2 md:grid-cols-2">
      {controller.scan.status === "Partial" ? (
        <Alert>
          <AlertTitle>扫描部分完成</AlertTitle>
          <AlertDescription>
            已跳过 {controller.scan.skipped} 个无法读取的目录{first ? `；${first.path}：${first.message}` : ""}。
          </AlertDescription>
        </Alert>
      ) : null}
      {!controller.scan.cargoAvailable && hasRustCandidates ? (
        <Alert>
          <AlertTitle>Cargo 不可用</AlertTitle>
          <AlertDescription>{controller.scan.cargoMessage ?? "Rust target 不可清理；node_modules 不受影响。"}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  ) : null;
}

function ProjectDataRow({
  candidate,
  cleanupError,
  cleanupResult,
  controller,
  homeDirectory,
  selected,
}: {
  candidate: ProjectDataCandidate;
  cleanupError: string | undefined;
  cleanupResult: ProjectCleanupResult | undefined;
  controller: ProjectCleanupController;
  homeDirectory: string | null;
  selected: boolean;
}) {
  const selectable = projectDataSelectable(candidate, controller.scan?.cargoAvailable ?? false, cleanupResult)
    && !cleanupError
    && !controller.cancelledCleanupIds.has(candidate.candidateId);
  const active = controller.activeCleanupId === candidate.candidateId;

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          aria-label={`选择 ${projectName(candidate.projectPath)}`}
          checked={selected}
          disabled={!selectable || controller.cleaning}
          onCheckedChange={(checked) => controller.toggleSelected(candidate.candidateId, checked === true)}
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
          cancelled={controller.cancelledCleanupIds.has(candidate.candidateId)}
          candidate={candidate}
          cargoAvailable={controller.scan?.cargoAvailable ?? false}
          cleanupError={cleanupError}
          cleanupResult={cleanupResult}
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <IconButton label={`复制 ${candidateDirectoryName(candidate)} 路径`} onClick={() => void controller.copyPath(candidate.directoryPath)}>
            <Copy />
          </IconButton>
          <IconButton label="打开项目目录" onClick={() => void controller.openCandidatePath(candidate.candidateId, "Project")}>
            <FolderOpen />
          </IconButton>
          <IconButton
            disabled={candidate.measurement.status === "Missing"}
            label={`打开 ${candidateDirectoryName(candidate)} 目录`}
            onClick={() => void controller.openCandidatePath(candidate.candidateId, "Directory")}
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
  cancelled,
  candidate,
  cargoAvailable,
  cleanupError,
  cleanupResult,
}: {
  active: boolean;
  cancelled: boolean;
  candidate: ProjectDataCandidate;
  cargoAvailable: boolean;
  cleanupError: string | undefined;
  cleanupResult: ProjectCleanupResult | undefined;
}) {
  if (active) return <Badge variant="secondary">清理中</Badge>;
  if (cancelled) return <Badge variant="outline">已取消</Badge>;
  if (cleanupError) return <Badge title={cleanupError} variant="destructive">调用失败</Badge>;
  if (cleanupResult) {
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
  if (candidate.status !== "Ready") {
    const labels = {
      Symlink: "符号链接",
      NotDirectory: "不是目录",
      Unrecognized: "待复核",
      Ready: "可清理",
    };
    return <Badge title={candidate.message ?? undefined} variant="outline">{labels[candidate.status]}</Badge>;
  }
  if (candidate.measurement.status === "Pending") return <Badge variant="secondary">测量中</Badge>;
  if (candidate.measurement.status === "Partial") {
    return <Badge title={candidate.measurement.message ?? undefined} variant="destructive">测量不完整</Badge>;
  }
  if (candidate.measurement.status !== "Ready") {
    return <Badge title={candidate.measurement.message ?? undefined} variant="destructive">不可测量</Badge>;
  }
  if (candidate.kind === "RustTarget" && !cargoAvailable) {
    return <Badge variant="outline">Cargo 不可用</Badge>;
  }
  return <Badge>可清理</Badge>;
}

function ProjectCleanupDialog({
  controller,
  homeDirectory,
}: {
  controller: ProjectCleanupController;
  homeDirectory: string | null;
}) {
  const candidates = controller.confirmationCandidates;
  const selectedBytes = candidates.reduce((sum, candidate) => sum + (candidate.measurement.bytes ?? 0), 0);
  const results = candidates.flatMap((candidate) => {
    const result = controller.cleanupResults.get(candidate.candidateId);
    return result ? [result] : [];
  });
  const cleaned = results.reduce((sum, result) => sum + result.cleanedBytes, 0);
  const rustCount = candidates.filter((candidate) => candidate.kind === "RustTarget").length;
  const nodeCount = candidates.length - rustCount;
  const candidateSummary = [
    rustCount ? `${rustCount} 个 Rust target` : null,
    nodeCount ? `${nodeCount} 个 Node node_modules` : null,
  ].filter(Boolean).join("、");
  const failed = results.filter((result) => result.status === "Failed" || result.status === "Rejected" || result.status === "PartiallyCompleted").length
    + candidates.filter((candidate) => controller.cleanupErrors.has(candidate.candidateId)).length;

  return (
    <AlertDialog open={Boolean(controller.confirmationIds)} onOpenChange={(open) => {
      if (!open) controller.closeCleanup();
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {controller.cleanupFinished ? "项目清理结果" : controller.cleaning ? "正在清理项目目录" : "确认项目清理"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {controller.cleanupFinished
              ? `已处理 ${controller.cleanupCompletedCount}/${candidates.length} 项，已清理目录占用 ${formatBytes(cleaned)}。`
              : controller.cleaning
                ? `正在处理 ${controller.cleanupCompletedCount + 1}/${candidates.length}；取消将在当前项目完成后生效。`
                : `将永久清理 ${candidateSummary}，目录占用 ${formatBytes(selectedBytes)}。`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-64 overflow-y-auto border bg-muted/20">
          {candidates.map((candidate) => {
            const result = controller.cleanupResults.get(candidate.candidateId);
            const error = controller.cleanupErrors.get(candidate.candidateId);
            const cancelled = controller.cancelledCleanupIds.has(candidate.candidateId);
            return (
              <div className="grid gap-1 border-b px-3 py-2 last:border-b-0" key={candidate.candidateId}>
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{projectName(candidate.projectPath)}</span>
                    <Badge variant="outline">{candidateTypeLabel(candidate)}</Badge>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {result ? formatBytes(result.cleanedBytes) : candidate.measurement.human ?? "-"}
                  </span>
                </div>
                <span className="truncate text-xs text-muted-foreground" title={candidate.directoryPath}>
                  {formatHomePath(candidate.directoryPath, homeDirectory)}
                </span>
                {error ? <span className="text-xs text-destructive">{error}</span> : null}
                {cancelled ? <span className="text-xs text-muted-foreground">未执行</span> : null}
              </div>
            );
          })}
        </div>

        {!controller.cleaning && !controller.cleanupFinished ? (
          <Alert>
            <AlertTitle>清理不可撤销</AlertTitle>
            <AlertDescription>{cleanupWarning(rustCount, nodeCount)}</AlertDescription>
          </Alert>
        ) : null}
        {controller.cleanupFinished && failed > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>{failed} 项未完整清理</AlertTitle>
            <AlertDescription>行内状态保留到下次扫描，可打开项目检查后再处理。</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          {controller.cleanupFinished ? (
            <AlertDialogCancel asChild>
              <Button onClick={controller.closeCleanup} type="button" variant="outline">关闭</Button>
            </AlertDialogCancel>
          ) : controller.cleaning ? (
            <Button
              disabled={controller.cleanupCancelRequested}
              onClick={controller.cancelCleanup}
              type="button"
              variant="outline"
            >
              {controller.cleanupCancelRequested ? "等待当前项完成" : "完成当前项后停止"}
            </Button>
          ) : (
            <>
              <AlertDialogCancel asChild>
                <Button onClick={controller.closeCleanup} type="button" variant="outline">取消</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  onClick={(event) => {
                    event.preventDefault();
                    void controller.confirmCleanup();
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

function candidateDirectoryName(candidate: ProjectDataCandidate) {
  return candidate.kind === "RustTarget" ? "target" : "node_modules";
}

function candidateTypeLabel(candidate: ProjectDataCandidate) {
  return candidate.kind === "RustTarget" ? "Rust target" : "Node node_modules";
}

function cleanupWarning(rustCount: number, nodeCount: number) {
  const recovery = [
    rustCount ? "Rust target 需要重新构建" : null,
    nodeCount ? "Node node_modules 需要重新安装依赖" : null,
  ].filter(Boolean).join("；");
  return `${recovery}。目录不会进入废纸篓，正在运行的构建、开发或测试任务可能受影响。`;
}

function measurementSize(candidate: ProjectDataCandidate) {
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
