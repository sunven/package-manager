import { ArrowClockwise as RefreshCw } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { CardContent } from "../../components/ui/card";
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
import { formatBytes, formatHomePath } from "../utils/format";
import {
  filterVscodeWorkspaces,
  summarizeVscodeStorage,
  type VscodeStorageScan,
  type VscodeWorkspace,
} from "../vscodeStorage";
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
  scan,
  scanning,
  error,
  onRefresh,
  homeDirectory,
}: {
  scan: VscodeStorageScan | null;
  scanning: boolean;
  error: string | null;
  onRefresh: () => void;
  homeDirectory: string | null;
}) {
  const [query, setQuery] = useState("");
  const workspaces = useMemo(
    () => filterVscodeWorkspaces(scan?.workspaces ?? [], query),
    [scan, query],
  );
  const summary = scan ? summarizeVscodeStorage(scan) : null;

  return (
    <main className="view-grid" aria-busy={scanning}>
      <Panel>
        <PanelHead
          eyebrow="VS CODE / WORKSPACE STORAGE"
          title="VS Code 占用"
          action={
            <Button disabled={scanning} onClick={onRefresh} size="sm" type="button" variant="outline">
              <RefreshCw className={scanning ? "animate-spin" : undefined} data-icon="inline-start" />
              {scanning ? "扫描中" : "刷新"}
            </Button>
          }
        />
        <CardContent className="flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">只读</Badge>
            <p className="text-sm text-muted-foreground">VS Code 为工作区保留的数据，仅统计 workspaceStorage。</p>
          </div>
          <p className="break-all text-xs text-muted-foreground">
            {scan
              ? formatHomePath(scan.storagePath, homeDirectory)
              : "~/Library/Application Support/Code/User/workspaceStorage"}
          </p>
          <p className="text-xs text-muted-foreground" role="status">
            {scanning
              ? scan ? "正在扫描，暂时显示上次结果。" : "正在读取工作区记录并测量占用…"
              : "每个存储目录独立列出；切换页面保留结果，可手动刷新。"}
          </p>
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

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
          eyebrow="WORKSPACE RECORDS"
          title="工作区记录"
          action={<Badge variant="secondary">{workspaces.length} / {scan?.workspaces.length ?? 0}</Badge>}
        />
        <CardContent className="flex flex-col gap-2 p-3">
          <Input
            aria-label="搜索工作区"
            className="max-w-lg"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索项目名称、项目路径或存储目录"
            type="search"
            value={query}
          />
          <p className="text-xs text-muted-foreground">按占用从大到小排列。路径不存在或未识别的记录也计入汇总。</p>
        </CardContent>
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
                <TableHead>项目 / 工作区</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>存储目录</TableHead>
                <TableHead className="text-right" aria-sort="descending">占用</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((workspace) => (
                <TableRow key={workspace.id}>
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
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState message={
            error && !scan ? "扫描未完成，请刷新重试"
              : scan?.status === "Missing" ? "未发现 VS Code 工作区存储目录"
                : scan?.status === "Partial" && !scan.workspaces.length ? "无法读取工作区记录，请查看扫描提示"
                  : query.trim() ? "没有匹配的工作区记录"
                    : scan ? "没有工作区存储记录" : "等待扫描工作区存储"
          } />
        )}
      </Panel>
    </main>
  );
}

function formatFootprint(bytes: number | null, complete: boolean) {
  if (bytes === null) return "—";
  return `${complete ? "" : "≥ "}${formatBytes(bytes)}`;
}
