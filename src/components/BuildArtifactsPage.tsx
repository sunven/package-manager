import { Copy, ExternalLink, FolderOpen, RefreshCw, Square, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildArtifactMetrics,
  buildArtifactProjectName,
  buildArtifactSelectable,
  filterAndSortBuildArtifacts,
  type BuildArtifactSort,
} from "../buildArtifacts";
import type { BuildArtifactsController } from "../hooks/useBuildArtifacts";
import type { BuildArtifactCandidate, BuildArtifactCleanupResult } from "../types";
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

export function BuildArtifactsPage({
  controller,
  homeDirectory,
}: {
  controller: BuildArtifactsController;
  homeDirectory: string | null;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<BuildArtifactSort>("size");
  const visibleCandidates = useMemo(
    () => filterAndSortBuildArtifacts(controller.scan?.candidates ?? [], query, sort),
    [controller.scan?.candidates, query, sort],
  );
  const selectableVisibleIds = visibleCandidates
    .filter((candidate) =>
      buildArtifactSelectable(
        candidate,
        controller.scan?.cargoAvailable ?? false,
        controller.cleanupResults.get(candidate.candidateId),
      ),
    )
    .filter((candidate) => !controller.cleanupErrors.has(candidate.candidateId))
    .filter((candidate) => !controller.cancelledCleanupIds.has(candidate.candidateId))
    .map((candidate) => candidate.candidateId);
  const allVisibleSelected = Boolean(selectableVisibleIds.length) && selectableVisibleIds.every((id) => controller.selectedIds.has(id));
  const metrics = buildArtifactMetrics(controller.scan, controller.selectedIds, controller.cleanupResults);
  const scanBusy = controller.discovering || controller.pendingMeasurements > 0;

  return (
    <main className="mt-5 grid gap-4">
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
          title="Rust 项目根目录"
        />
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_120px_auto] lg:items-end">
          <label className="grid min-w-0 gap-1.5" htmlFor="build-artifact-root">
            <span className="text-xs font-medium text-muted-foreground">扫描根目录</span>
            {controller.settingsLoading ? (
              <Skeleton className="h-9 w-full rounded-md" />
            ) : (
              <Input
                id="build-artifact-root"
                readOnly
                title={controller.settings.rootPath ?? undefined}
                value={controller.settings.rootPath ? formatHomePath(controller.settings.rootPath, homeDirectory) : "尚未选择"}
              />
            )}
          </label>
          <label className="grid gap-1.5" htmlFor="build-artifact-depth">
            <span className="text-xs font-medium text-muted-foreground">最大深度</span>
            <Input
              aria-describedby="build-artifact-depth-range"
              disabled={scanBusy || controller.cleaning}
              id="build-artifact-depth"
              max={32}
              min={0}
              onChange={(event) => controller.setMaxDepth(event.currentTarget.valueAsNumber)}
              type="number"
              value={controller.maxDepth}
            />
            <span className="sr-only" id="build-artifact-depth-range">范围 0 到 32</span>
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="已验证构建产物" value={formatBytes(metrics.verifiedBytes)} />
        <StatCard label={`待复核 ${metrics.reviewCount} 项`} value={formatBytes(metrics.reviewBytes)} />
        <StatCard label={`已选择 ${controller.selectedIds.size} 项`} value={formatBytes(metrics.selectedBytes)} />
        <StatCard label="本轮实际释放" value={formatBytes(metrics.releasedBytes)} />
      </section>

      <BuildArtifactScanNotice controller={controller} />

      <Panel className="overflow-hidden">
        <PanelHead
          action={<span className="text-xs font-medium text-muted-foreground">{visibleCandidates.length} 项</span>}
          eyebrow="构建产物"
          title="扫描结果"
        />
        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          <Input
            aria-label="搜索项目或 target 路径"
            className="min-w-56 flex-1"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索项目或 target 路径"
            type="search"
            value={query}
          />
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
          <div className="grid gap-2 p-5">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
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
                      else controller.clearSelection();
                    }}
                  />
                </TableHead>
                <TableHead>项目</TableHead>
                <TableHead>target 路径</TableHead>
                <TableHead className="text-right">占用</TableHead>
                <TableHead>最近活跃</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCandidates.map((candidate) => (
                <BuildArtifactRow
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
                ? "没有匹配的构建目录"
                : controller.scan
                  ? "扫描范围内没有发现 target 候选"
                  : "选择根目录后开始扫描"
            }
          />
        )}
      </Panel>

      <BuildArtifactCleanupDialog controller={controller} homeDirectory={homeDirectory} />
    </main>
  );
}

function BuildArtifactScanNotice({ controller }: { controller: BuildArtifactsController }) {
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
        <AlertTitle>正在测量构建目录</AlertTitle>
        <AlertDescription>还有 {controller.pendingMeasurements} 项等待完成。</AlertDescription>
      </Alert>
    );
  }
  const first = controller.scan?.errors[0];
  return controller.scan ? (
    <div className="grid gap-2">
      {controller.scan.status === "Partial" ? (
        <Alert>
          <AlertTitle>扫描部分完成</AlertTitle>
          <AlertDescription>
            已跳过 {controller.scan.skipped} 个无法读取的目录{first ? `；${first.path}：${first.message}` : ""}。
          </AlertDescription>
        </Alert>
      ) : null}
      {!controller.scan.cargoAvailable ? (
        <Alert variant="destructive">
          <AlertTitle>Cargo 不可用</AlertTitle>
          <AlertDescription>{controller.scan.cargoMessage ?? "仍可查看构建产物，但不能执行清理。"}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  ) : null;
}

function BuildArtifactRow({
  candidate,
  cleanupError,
  cleanupResult,
  controller,
  homeDirectory,
  selected,
}: {
  candidate: BuildArtifactCandidate;
  cleanupError: string | undefined;
  cleanupResult: BuildArtifactCleanupResult | undefined;
  controller: BuildArtifactsController;
  homeDirectory: string | null;
  selected: boolean;
}) {
  const selectable = buildArtifactSelectable(candidate, controller.scan?.cargoAvailable ?? false, cleanupResult)
    && !cleanupError
    && !controller.cancelledCleanupIds.has(candidate.candidateId);
  const active = controller.activeCleanupId === candidate.candidateId;

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          aria-label={`选择 ${buildArtifactProjectName(candidate.projectPath)}`}
          checked={selected}
          disabled={!selectable || controller.cleaning}
          onCheckedChange={(checked) => controller.toggleSelected(candidate.candidateId, checked === true)}
        />
      </TableCell>
      <TableCell className="max-w-56 whitespace-normal">
        <span className="block truncate font-medium" title={candidate.projectPath}>
          {buildArtifactProjectName(candidate.projectPath)}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground" title={candidate.projectPath}>
          {formatHomePath(candidate.projectPath, homeDirectory)}
        </span>
      </TableCell>
      <TableCell className="max-w-80 whitespace-normal">
        <span className="block truncate text-xs text-muted-foreground" title={candidate.targetPath}>
          {formatHomePath(candidate.targetPath, homeDirectory)}
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
          cleanupError={cleanupError}
          cleanupResult={cleanupResult}
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <IconButton label="复制 target 路径" onClick={() => void controller.copyPath(candidate.targetPath)}>
            <Copy />
          </IconButton>
          <IconButton label="打开项目目录" onClick={() => void controller.openCandidatePath(candidate.candidateId, "Project")}>
            <FolderOpen />
          </IconButton>
          <IconButton
            disabled={candidate.measurement.status === "Missing"}
            label="打开 target 目录"
            onClick={() => void controller.openCandidatePath(candidate.candidateId, "Target")}
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
  cleanupError,
  cleanupResult,
}: {
  active: boolean;
  cancelled: boolean;
  candidate: BuildArtifactCandidate;
  cleanupError: string | undefined;
  cleanupResult: BuildArtifactCleanupResult | undefined;
}) {
  if (active) return <Badge variant="secondary">清理中</Badge>;
  if (cancelled) return <Badge variant="outline">已取消</Badge>;
  if (cleanupError) return <Badge title={cleanupError} variant="destructive">调用失败</Badge>;
  if (cleanupResult) {
    const labels: Record<BuildArtifactCleanupResult["status"], string> = {
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
  return <Badge>可清理</Badge>;
}

function BuildArtifactCleanupDialog({
  controller,
  homeDirectory,
}: {
  controller: BuildArtifactsController;
  homeDirectory: string | null;
}) {
  const candidates = controller.confirmationCandidates;
  const selectedBytes = candidates.reduce((sum, candidate) => sum + (candidate.measurement.bytes ?? 0), 0);
  const results = candidates.flatMap((candidate) => {
    const result = controller.cleanupResults.get(candidate.candidateId);
    return result ? [result] : [];
  });
  const released = results.reduce((sum, result) => sum + result.releasedBytes, 0);
  const failed = results.filter((result) => result.status === "Failed" || result.status === "Rejected" || result.status === "PartiallyCompleted").length
    + candidates.filter((candidate) => controller.cleanupErrors.has(candidate.candidateId)).length;

  return (
    <AlertDialog open={Boolean(controller.confirmationIds)} onOpenChange={(open) => {
      if (!open) controller.closeCleanup();
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {controller.cleanupFinished ? "构建目录清理结果" : controller.cleaning ? "正在清理构建目录" : "确认清理构建目录"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {controller.cleanupFinished
              ? `已处理 ${controller.cleanupCompletedCount}/${candidates.length} 项，实际释放 ${formatBytes(released)}。`
              : controller.cleaning
                ? `正在处理 ${controller.cleanupCompletedCount + 1}/${candidates.length}；取消将在当前项目完成后生效。`
                : `将通过 cargo clean --offline 永久清理 ${candidates.length} 个 target，预计回收 ${formatBytes(selectedBytes)}。`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-64 overflow-y-auto rounded-md border">
          {candidates.map((candidate) => {
            const result = controller.cleanupResults.get(candidate.candidateId);
            const error = controller.cleanupErrors.get(candidate.candidateId);
            const cancelled = controller.cancelledCleanupIds.has(candidate.candidateId);
            return (
              <div className="grid gap-1 border-b px-3 py-2 last:border-b-0" key={candidate.candidateId}>
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">{buildArtifactProjectName(candidate.projectPath)}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {result ? formatBytes(result.releasedBytes) : candidate.measurement.human ?? "-"}
                  </span>
                </div>
                <span className="truncate text-xs text-muted-foreground" title={candidate.targetPath}>
                  {formatHomePath(candidate.targetPath, homeDirectory)}
                </span>
                {error ? <span className="text-xs text-destructive">{error}</span> : null}
                {cancelled ? <span className="text-xs text-muted-foreground">未执行</span> : null}
              </div>
            );
          })}
        </div>

        {!controller.cleaning && !controller.cleanupFinished ? (
          <Alert>
            <AlertTitle>清理后需要重新编译</AlertTitle>
            <AlertDescription>构建产物不会进入废纸篓，也不能撤销。</AlertDescription>
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

function measurementSize(candidate: BuildArtifactCandidate) {
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
