import { Copy } from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  candidateKindLabel,
  formatScanTime,
  groupCandidateKeys,
  projectDelta,
  relativeScanPath,
  scanChangeCounts,
} from "../projectScanHistory";
import type { ProjectScanCandidateKey, ProjectScanRecord } from "../types";
import { formatHomePath } from "../utils/format";
import { EmptyState, IconButton } from "./ui";

export function ProjectScanHistoryDialog({
  homeDirectory,
  onCopyPath,
  onOpenChange,
  open,
  presetDepth,
  presetPath,
  records,
  warning,
}: {
  homeDirectory: string | null;
  onCopyPath: (path: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  presetDepth: number;
  presetPath: string;
  records: ProjectScanRecord[];
  warning: string | null;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>扫描记录</DialogTitle>
          <DialogDescription>
            {formatHomePath(presetPath, homeDirectory)} · 当前深度 {presetDepth}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            历史记录只描述扫描时的观察，不代表当前磁盘状态，也不授权清理。
          </p>
          {warning ? (
            <Alert>
              <AlertTitle>扫描记录不可用</AlertTitle>
              <AlertDescription>{warning}。扫描和清理仍可正常使用。</AlertDescription>
            </Alert>
          ) : null}
          {records.length ? (
            <div className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1">
              {records.map((record) => (
                <ScanRecordCard
                  baselineVisible={record.baseline
                    ? records.some(
                        (candidate) =>
                          candidate.finishedAt === record.baseline!.finishedAt
                          && candidate.maxDepth === record.maxDepth
                          && candidate.rootPath === record.rootPath,
                      )
                    : false}
                  homeDirectory={homeDirectory}
                  key={record.id}
                  onCopyPath={onCopyPath}
                  record={record}
                />
              ))}
            </div>
          ) : (
            <EmptyState message="尚无扫描记录。完成一次扫描后，这里会显示发现项目数、候选数和与上次的变化。" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScanRecordCard({
  baselineVisible,
  homeDirectory,
  onCopyPath,
  record,
}: {
  baselineVisible: boolean;
  homeDirectory: string | null;
  onCopyPath: (path: string) => void;
  record: ProjectScanRecord;
}) {
  const changes = scanChangeCounts(record);
  const delta = projectDelta(record);
  const projectTypeSum = record.projects.rust + record.projects.node + record.projects.maven;
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{formatScanTime(record.finishedAt)}</span>
          <Badge variant="outline">深度 {record.maxDepth}</Badge>
          {record.discovery.complete ? null : (
            <Badge variant="destructive">发现不完整</Badge>
          )}
          {record.measurement === "stopped" ? (
            <Badge variant="outline">测量已取消</Badge>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          项目 {record.projects.total} · 候选 {record.candidates.total}
        </span>
      </div>

      <div className="grid gap-1 text-xs text-muted-foreground">
        <span>
          发现项目 {record.projects.total}
          {record.projects.total
            ? `（Rust ${record.projects.rust} · Node ${record.projects.node} · Maven ${record.projects.maven}）`
            : ""}
          {projectTypeSum > record.projects.total ? "；部分目录同时包含多种项目标记" : ""}
        </span>
        <span>
          候选 {record.candidates.total}
          {record.candidates.total
            ? `（Rust ${record.candidates.rustTarget} · Maven ${record.candidates.mavenTarget} · Node ${record.candidates.nodeModules}）`
            : ""}
        </span>
        {record.discovery.skipped > 0 ? (
          <span>发现阶段跳过 {record.discovery.skipped} 个目录，项目数和候选数只是下限。</span>
        ) : null}
      </div>

      {record.baseline ? (
        <div className="grid gap-1 rounded-md border bg-background/60 p-2 text-xs">
          <span className="text-muted-foreground">
            比较基线 {formatScanTime(record.baseline.finishedAt)} · 项目{" "}
            {record.baseline.projects.total} · 候选 {record.baseline.candidates.total}
            {baselineVisible ? "" : "（基线记录已不在列表中）"}
          </span>
          {record.changes === null ? (
            <span className="text-muted-foreground">
              {record.discovery.complete
                ? "未比较变化。"
                : "本次发现不完整，未比较变化。"}
            </span>
          ) : (
            <>
              <span className="text-muted-foreground">
                {delta === null || delta === 0
                  ? "发现项目较基线无变化。"
                  : `发现项目较基线 ${delta > 0 ? "+" : ""}${delta}。`}
              </span>
              <span className="text-muted-foreground">
                候选较基线新增 {changes.added}、消失 {changes.removed}。
              </span>
              <ChangeList
                homeDirectory={homeDirectory}
                keys={record.changes.added}
                label="新增"
                onCopyPath={onCopyPath}
                rootPath={record.rootPath}
              />
              <ChangeList
                homeDirectory={homeDirectory}
                keys={record.changes.removed}
                label="消失"
                onCopyPath={onCopyPath}
                rootPath={record.rootPath}
              />
            </>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">
          {record.discovery.complete
            ? "首次可比较扫描，暂无比较基线。"
            : "本次发现不完整，未比较变化。"}
        </span>
      )}
    </div>
  );
}

function ChangeList({
  homeDirectory,
  keys,
  label,
  onCopyPath,
  rootPath,
}: {
  homeDirectory: string | null;
  keys: ProjectScanCandidateKey[];
  label: string;
  onCopyPath: (path: string) => void;
  rootPath: string;
}) {
  if (!keys.length) return null;
  return (
    <div className="grid gap-1">
      <span className="font-medium text-foreground">
        {label} {keys.length}
      </span>
      {groupCandidateKeys(keys).map((group) => (
        <div className="grid gap-1" key={group.kind}>
          <span className="text-muted-foreground">{candidateKindLabel(group.kind)}</span>
          {group.keys.map((key) => (
            <div
              className="flex min-w-0 items-center gap-1"
              key={`${key.kind}\n${key.directoryPath}`}
            >
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs"
                title={formatHomePath(key.directoryPath, homeDirectory)}
              >
                {relativeScanPath(rootPath, key.directoryPath)}
              </span>
              <IconButton
                label={`复制 ${relativeScanPath(rootPath, key.directoryPath)} 路径`}
                onClick={() => onCopyPath(key.directoryPath)}
              >
                <Copy />
              </IconButton>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
