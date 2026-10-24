import { ArrowClockwise as RefreshCw } from "@phosphor-icons/react";
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
import { useSessionSelection } from "../hooks/useSessionSelection";
import type { VscodeStorageWorkflow } from "../hooks/useVscodeStorage";
import type { SessionRefresh } from "../sessionRecords";
import { formatBytes, formatHomePath } from "../utils/format";
import {
  filterVscodeWorkspaces,
  summarizeVscodeStorage,
  type VscodeWorkspace,
} from "../vscodeStorage";
import {
  selectedVscodeRemovalConfirmText,
  summarizeVscodeRemoval,
  vscodeEditorBlocked,
  vscodeRemovalProgressDetail,
  vscodeRemovalProgressPercent,
  vscodeRemovalProgressText,
  vscodeRemovalProgressValue,
  vscodeRemovalReasonLabels,
  vscodeRemovalResultText,
} from "../vscodeRemoval";
import type { ObservationCoverageItem } from "../observationCoverage";
import { ObservationState } from "./ObservationState";
import { EmptyState, Panel, PanelHead, StatCard } from "./ui";

const projectStatusLabels: Record<VscodeWorkspace["projectStatus"], string> = {
  Available: "路径存在",
  Missing: "路径不存在",
  Remote: "远程工作区",
  Unknown: "未识别工作区",
  Unavailable: "路径无法访问",
};

const workspaceKindLabels: Record<VscodeWorkspace["kind"], string> = {
  Folder: "文件夹",
  Workspace: "多文件夹工作区",
  Unknown: "未知",
};

export function VscodeStoragePage({
  workflow,
  homeDirectory,
  coverageItem,
  onShowHistory,
}: {
  workflow: VscodeStorageWorkflow;
  homeDirectory: string | null;
  coverageItem?: ObservationCoverageItem | null;
  onShowHistory?: (recordId: string) => void;
}) {
  const {
    scan,
    scanning,
    error,
    refresh,
    operation,
    outcome,
    editorStatus,
    checkingEditor,
    request,
    confirm,
    cancel,
  } = workflow;
  const [query, setQuery] = useState("");
  const workspaces = useMemo(
    () => filterVscodeWorkspaces(scan?.workspaces ?? [], query),
    [scan, query],
  );
  const summary = scan ? summarizeVscodeStorage(scan) : null;
  const selection = useSessionSelection({
    records: scan ? workspaces : null,
    isSelectable: (workspace: VscodeWorkspace) => workspace.removable,
    completedIds: outcome?.completedIds ?? null,
  });
  const selectedSet = new Set(selection.selectedIds);
  const selectedWorkspaces = workspaces.filter((workspace) => selectedSet.has(workspace.id));
  const selectedCount = selection.selectedIds.length;
  const selectableVisible = workspaces.filter((workspace) => workspace.removable);
  const allVisibleSelected = selectableVisible.length > 0
    && selectableVisible.every((workspace) => selectedSet.has(workspace.id));
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);

  const pending = operation && operation.phase !== "refreshing" ? operation.target : null;
  const removing = operation?.phase === "executing";
  const removalProgress = operation?.phase === "executing" ? operation.progress : null;
  const showRemovalProgress = removalProgress !== null
    && (removalProgress.phase === "preparing" || removalProgress.total > 0);
  const pendingSummary = pending ? summarizeVscodeRemoval(pending.workspaces) : null;
  const result = outcome?.result ?? null;
  const resultIsError = Boolean(outcome?.error || result?.operationError);
  const editorBlocked = vscodeEditorBlocked(editorStatus);
  const controlsDisabled = scanning || removing;
  const removeDisabled = controlsDisabled || checkingEditor || editorBlocked || selectedCount === 0;
  const removeTitle = checkingEditor
    ? "正在确认 VS Code 状态"
    : editorBlocked
      ? "退出 VS Code 后才能移除"
      : undefined;

  async function openRemoval() {
    if (!selectedWorkspaces.length) return;
    await request({ workspaces: selectedWorkspaces });
  }

  return (
    <main className="view-grid" aria-busy={scanning}>
      <Panel>
        <PanelHead
          title="VS Code 占用"
          action={
            <Button disabled={scanning} onClick={() => void refresh()} size="sm" type="button" variant="outline">
              <RefreshCw className={scanning ? "animate-spin" : undefined} data-icon="inline-start" />
              {scanning ? "扫描中" : "刷新"}
            </Button>
          }
        />
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">可移除</Badge>
            <p className="text-sm text-muted-foreground">仅统计 VS Code 工作区存储（workspaceStorage）中的编辑器状态和扩展数据，不包含项目源码占用。</p>
          </div>
          <p className="break-all text-xs text-muted-foreground">
            {scan
              ? formatHomePath(scan.storagePath, homeDirectory)
              : "~/Library/Application Support/Code/User/workspaceStorage"}
          </p>
          {coverageItem ? (
            <>
              <ObservationState
                extra={scanning
                  ? scan ? "正在扫描，暂时显示上次结果。" : "正在读取工作区记录并测量占用…"
                  : null}
                item={coverageItem}
                live
                showNote={coverageItem.status !== "failed" && coverageItem.status !== "partial"}
                variant="strip"
              />
              <p className="text-xs text-muted-foreground">
                每个存储目录独立列出；切换页面保留结果，可手动刷新。
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground" role="status">
              {scanning
                ? scan ? "正在扫描，暂时显示上次结果。" : "正在读取工作区记录并测量占用…"
                : "每个存储目录独立列出；切换页面保留结果，可手动刷新。"}
            </p>
          )}
        </CardContent>
      </Panel>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>VS Code 占用扫描失败</AlertTitle>
          <AlertDescription>
            {error}{scan ? "；下方保留上次扫描结果。" : ""}
          </AlertDescription>
        </Alert>
      ) : null}

      {editorStatus === "Running" ? (
        <Alert>
          <AlertTitle>VS Code 正在运行</AlertTitle>
          <AlertDescription>
            退出 VS Code 后才能移入废纸篓。运行中的扩展宿主可能在退出时回写工作区存储。
          </AlertDescription>
        </Alert>
      ) : editorStatus === "Unknown" ? (
        <Alert>
          <AlertTitle>无法确认 VS Code 是否运行</AlertTitle>
          <AlertDescription>请退出 VS Code 后刷新重试。</AlertDescription>
        </Alert>
      ) : null}

      {outcome ? (
        <>
          <Alert variant={resultIsError ? "destructive" : undefined}>
            <AlertTitle>VS Code 工作区存储移除结果</AlertTitle>
            <AlertDescription>
              <p>
                {result
                  ? vscodeRemovalResultText(result)
                  : outcome.error ? "移除未能执行" : "操作未返回结果"}
              </p>
              {result?.operationError ? <p>{result.operationError}</p> : null}
              {outcome.error ? <p>{outcome.error}</p> : null}
              {result?.message ? <p>{result.message}</p> : null}
              {result?.historyWarning ? <p>维护历史未完整保存：{result.historyWarning}</p> : null}
              {outcome.followUpWarning ? <p>后续读取未写入历史：{outcome.followUpWarning}</p> : null}
              {result?.historyId && onShowHistory ? <Button className="w-fit" onClick={() => onShowHistory(result.historyId!)} size="sm" type="button" variant="outline">已保存到维护历史</Button> : null}
              {result?.items.length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer">查看逐项结果</summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {result.items.map((item) => {
                      const name = outcome.target.workspaces.find((workspace) => workspace.id === item.id)?.name ?? item.id;
                      return (
                        <li className="wrap-anywhere" key={item.id}>
                          {name}：{item.status === "Moved" ? "已移入废纸篓" : item.status === "Skipped" ? "跳过" : "失败"}
                          {item.reason ? `（${vscodeRemovalReasonLabels[item.reason]}）` : ""}
                          {item.message ? `：${item.message}` : ""}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
            </AlertDescription>
          </Alert>
          <RefreshNotice value={outcome.refresh} onRetry={() => void refresh()} />
        </>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="工作区存储" value={scan ? `${scan.workspaces.length} 个` : "—"} />
        <StatCard label="存储占用" value={formatFootprint(summary?.bytes ?? null, summary?.complete ?? false)} />
        <StatCard label="路径不存在" value={summary ? `${summary.missingCount} 个` : "—"} />
        <StatCard label="未识别工作区" value={summary ? `${summary.unknownCount} 个` : "—"} />
      </div>

      {scan?.status === "Partial" || (summary && scan?.status === "Ready" && !summary.complete) ? (
        <Alert>
          <AlertTitle>占用统计不完整</AlertTitle>
          <AlertDescription>
            {scan?.message ?? "部分存储目录无法完整测量，合计仅包含已测得的占用。"}
          </AlertDescription>
        </Alert>
      ) : null}

      <Panel className="overflow-hidden">
        <PanelHead
          title="工作区记录"
          action={<Badge variant="secondary">{workspaces.length} / {scan?.workspaces.length ?? 0}</Badge>}
        />
        <CardContent className="flex flex-col gap-2 p-4">
          <Input
            aria-label="搜索工作区"
            className="max-w-lg"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索项目名称、项目路径或存储目录"
            type="search"
            value={query}
          />
          <p className="text-xs text-muted-foreground">按占用从大到小排列，包括路径不存在或未识别的记录。这些记录不代表当前打开的窗口或完整打开历史。</p>
        </CardContent>
        {scan?.workspaces.length ? (
          <div className="flex flex-wrap items-center gap-2 border-y px-4 py-2" role="toolbar" aria-label="工作区存储移除操作">
            <Button
              disabled={controlsDisabled || selectableVisible.length === 0 || allVisibleSelected}
              onClick={() => selection.selectAll(workspaces)}
              size="sm"
              type="button"
              variant="outline"
            >
              全选可移除
            </Button>
            <Button
              disabled={controlsDisabled || selectedCount === 0}
              onClick={() => selection.clear()}
              size="sm"
              type="button"
              variant="outline"
            >
              取消选择
            </Button>
            <Button
              disabled={removeDisabled}
              onClick={() => void openRemoval()}
              ref={selectionTrigger}
              size="sm"
              title={removeTitle}
              type="button"
              variant="destructive"
            >
              {removing ? "正在移入废纸篓" : `移除 ${selectedCount} 项`}
            </Button>
          </div>
        ) : null}
        {scanning && !scan ? (
          <div className="flex flex-col gap-2 p-3" aria-label="正在加载工作区">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : workspaces.length ? (
          <Table aria-label="VS Code 工作区存储清单">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><span className="sr-only">选择</span></TableHead>
                <TableHead>项目 / 工作区</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>存储目录</TableHead>
                <TableHead className="text-right" aria-sort="descending">占用</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((workspace) => {
                const selected = selectedSet.has(workspace.id);
                return (
                  <TableRow key={workspace.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={workspace.removable
                          ? `选择 ${workspace.name}（${workspace.id}）`
                          : `${workspace.name} 不可移除：${workspace.removalBlockReason ?? "当前记录不可移除"}`}
                        checked={workspace.removable && selected}
                        disabled={!workspace.removable || controlsDisabled}
                        onCheckedChange={(checked) => selection.toggle(workspace.id, checked === true)}
                        title={workspace.removalBlockReason ?? undefined}
                      />
                    </TableCell>
                    <TableCell className="max-w-80 whitespace-normal">
                      <span className="block truncate font-medium" title={workspace.name}>{workspace.name}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground" title={workspace.projectPath ?? undefined}>
                        {workspace.projectPath ? formatHomePath(workspace.projectPath, homeDirectory) : "项目位置未知"}
                      </span>
                    </TableCell>
                    <TableCell><Badge variant="outline">{workspaceKindLabels[workspace.kind]}</Badge></TableCell>
                    <TableCell className="max-w-72 whitespace-normal">
                      <span className="block truncate text-xs" title={workspace.storagePath}>{workspace.id}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground" title={workspace.storagePath}>
                        {formatHomePath(workspace.storagePath, homeDirectory)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFootprint(workspace.usage.bytes, workspace.usage.complete)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant="outline" title={workspace.message ?? undefined}>
                          {projectStatusLabels[workspace.projectStatus]}
                        </Badge>
                        {!workspace.usage.complete ? (
                          <Badge variant="destructive" title={workspace.usage.message ?? undefined}>
                            {workspace.usage.bytes === null ? "无法测量" : "统计不完整"}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState message={
            error && !scan ? "扫描未完成，请刷新重试"
              : scan?.status === "Missing" ? "未发现 VS Code 工作区存储目录"
                : scan?.status === "Partial" && !scan.workspaces.length ? "无法读取工作区记录，请查看扫描提示"
                  : query.trim() ? "没有匹配的工作区记录，请调整搜索词"
                    : scan ? "没有工作区存储记录" : "等待扫描工作区存储"
          } />
        )}
      </Panel>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && operation?.phase === "confirming") cancel(operation.id);
        }}
      >
        <AlertDialogContent
          className="flex max-h-[calc(100dvh-2rem)] flex-col"
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
              {pending ? selectedVscodeRemovalConfirmText(pending.workspaces.length) : ""}
              {pendingSummary ? ` 合计 ${formatFootprint(pendingSummary.bytes, pendingSummary.complete)}。` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pending ? (
            <>
              <ul
                aria-label="待移入废纸篓的工作区存储记录"
                className="min-h-0 max-h-80 divide-y overflow-y-auto overscroll-contain rounded-lg border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                role="list"
                tabIndex={0}
              >
                {pending.workspaces.map((workspace) => (
                  <li className="min-w-0 px-4 py-3" key={workspace.id}>
                    <p className="wrap-anywhere text-sm font-medium">{workspace.name || workspace.id}</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {workspace.projectPath ? formatHomePath(workspace.projectPath, homeDirectory) : "项目位置未知"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{projectStatusLabels[workspace.projectStatus]}</Badge>
                      <span className="tabular-nums">{formatFootprint(workspace.usage.bytes, workspace.usage.complete)}</span>
                      <span className="break-all">{formatHomePath(workspace.storagePath, homeDirectory)}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="shrink-0 space-y-1 text-sm text-foreground/80">
                {pending.workspaces.some((workspace) => workspace.projectStatus === "Missing") ? (
                  <p>「路径不存在」可能是外接磁盘未挂载或项目被移动。</p>
                ) : null}
                {pending.workspaces.some((workspace) => workspace.projectStatus === "Unknown") ? (
                  <p>「未识别」记录可能仍包含扩展数据。</p>
                ) : null}
                <p>执行时会重新检查；项目路径恢复或记录变化的目标会被跳过。</p>
                <p>移除期间请保持 VS Code 退出。</p>
                <p>清空废纸篓前可恢复；移入废纸篓不代表磁盘空间立即释放。</p>
              </div>
            </>
          ) : null}
          {showRemovalProgress && removalProgress ? (
            <div className="shrink-0 space-y-2">
              <p className="text-sm text-foreground/80">{vscodeRemovalProgressText(removalProgress)}</p>
              {removalProgress.phase !== "preparing" ? (
                <div
                  aria-label="工作区存储移除进度"
                  aria-valuemax={removalProgress.total}
                  aria-valuemin={0}
                  aria-valuenow={vscodeRemovalProgressValue(removalProgress)}
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150"
                    style={{ width: `${vscodeRemovalProgressPercent(removalProgress)}%` }}
                  />
                </div>
              ) : null}
              {vscodeRemovalProgressDetail(removalProgress) ? (
                <p className="text-xs text-foreground/70">{vscodeRemovalProgressDetail(removalProgress)}</p>
              ) : null}
            </div>
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
                  if (operation) void confirm(operation.id);
                }}
                type="button"
                variant="destructive"
              >
                {removing ? "正在移入废纸篓" : `移入废纸篓 ${pending?.workspaces.length ?? 0} 项`}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function RefreshNotice({ value, onRetry }: { value: SessionRefresh; onRetry: () => void }) {
  if (value.status === "notRequested") return null;
  if (value.status === "failed") return (
    <div>
      <p className="wrap-anywhere" role="status">列表刷新失败：{value.message} 执行结果已保留。</p>
      <Button className="mt-2" onClick={onRetry} size="sm" type="button" variant="outline">重试刷新</Button>
    </div>
  );
  return <p role="status">{value.status === "refreshing" ? "列表正在刷新。" : "列表已刷新。"}</p>;
}

function formatFootprint(bytes: number | null, complete: boolean) {
  if (bytes === null) return "—";
  return `${complete ? "" : "≥ "}${formatBytes(bytes)}`;
}
