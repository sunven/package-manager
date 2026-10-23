import { pathObservationId } from "../globalSearch";
import { ArrowSquareOut as ExternalLink, Copy, Info, Trash as Trash2 } from "@phosphor-icons/react";
import { pathKindLabels } from "../constants";
import type { HomebrewMaintenance, ManagerSnapshot, PathInfo } from "../types";
import type { MaintenanceRequest } from "../state";
import { cleanupCopyForPath, cleanupReady, hasCleanupPlan } from "../cleanupCopy";
import { displayMessage, formatHomePath, formatHomePathsInText, pathLabel, trimTail } from "../utils/format";
import { EmptyState, IconButton, StatusBadge, TextButton } from "./ui";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";

const npmInlinePathKinds: PathInfo["kind"][] = ["Cache", "NpxCache"];
const pnpmInlinePathKinds: PathInfo["kind"][] = ["Store"];
const yarnInlinePathKinds: PathInfo["kind"][] = ["Cache"];
const nvmInlinePathKinds: PathInfo["kind"][] = ["NvmDir", "NvmNodeVersions"];
const dockerInlinePathKinds: PathInfo["kind"][] = ["DockerConfig", "DockerBuildx", "DockerDesktopData"];
const bunInlinePathKinds: PathInfo["kind"][] = ["BunInstall", "BunCache"];
const uvInlinePathKinds: PathInfo["kind"][] = ["UvTools", "UvPythonInstallations", "UvCache"];
const fvmInlinePathKinds: PathInfo["kind"][] = ["FvmVersions", "FvmGitCache"];
const hiddenPathKinds: PathInfo["kind"][] = ["GlobalModules", "GlobalDir"];
const npmPathNotes: Partial<Record<PathInfo["kind"], string>> = {
  Cache: "npm 缓存已包含 npx 缓存；总占用只统计 npm 缓存，避免重复计算。",
};

export function PathPanel({
  focusedPath,
  homeDirectory,
  manager,
  onCopyCleanupCommand,
  onCopyPath,
  onRequestCacheCleanup,
  onOpenPath,
  pendingMaintenance,
  pendingHomebrewCleanup,
  scanning,
}: {
  focusedPath?: string;
  homeDirectory: string | null;
  manager: ManagerSnapshot | null;
  onCopyCleanupCommand: () => void;
  onCopyPath: (path: string) => void;
  onRequestCacheCleanup: () => void;
  onOpenPath: (path: string) => void;
  pendingMaintenance: MaintenanceRequest | null;
  pendingHomebrewCleanup: boolean;
  scanning: boolean;
}) {
  if (!manager) {
    return (
      <section className="studio-card studio-side-card">
        <EmptyState message={scanning ? "正在扫描路径..." : "尚未扫描"} />
      </section>
    );
  }

  const { inlinePaths, stackedPaths } = splitPaths(manager);
  const cleanupAvailable = hasCleanupPlan(manager.id);
  const cleanupBlockReason = scanning
    ? "管理器正在扫描；扫描完成后可准备清理。"
    : manager.status === "Missing"
      ? `${manager.label} 尚未安装，无法执行清理。`
      : manager.status === "Failed"
        ? manager.unsupportedReason ?? "管理器状态不可用；请刷新并核对状态后重试。"
        : manager.id === "Homebrew" && manager.homebrew?.cleanup.status !== "Ready"
          ? manager.homebrew?.cleanup.message ?? "清理预演尚未就绪；预演完成后可执行清理。"
          : null;

  return (
    <div className="@container flex flex-col gap-2">
      {manager.paths.filter((path) => pathObservationId(path.kind, path.path) === focusedPath).map((path) => <div key={path.path} data-path-observation={focusedPath} tabIndex={-1} className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">已定位：{path.label}</h3><code className="mt-2 block break-all text-xs">{formatHomePath(path.path, homeDirectory)}</code>
        <div className="mt-3 flex gap-2"><Button variant="outline" size="sm" onClick={() => onCopyPath(path.path)}>复制路径</Button><Button variant="outline" size="sm" onClick={() => onOpenPath(path.path)}>打开目录</Button></div>
      </div>)}
      {manager.id === "Homebrew" ? (
        <HomebrewCleanupCard
          cleanupReady={cleanupReady(manager) && !scanning}
          cleanupBlockReason={cleanupBlockReason}
          homeDirectory={homeDirectory}
          maintenance={manager.homebrew}
          onCopyCleanupCommand={onCopyCleanupCommand}
          onRequestCacheCleanup={onRequestCacheCleanup}
          pending={pendingHomebrewCleanup}
          pendingCleanup={pendingMaintenance?.kind === "cleanupCache" && pendingMaintenance.managerId === "Homebrew"}
        />
      ) : null}
      {inlinePaths.length || stackedPaths.length ? (
        <>
          {inlinePaths.length ? (
            <InlinePathCard
              cleanupAvailable={cleanupAvailable}
              cleanupBlockReason={cleanupBlockReason}
              homeDirectory={homeDirectory}
              managerId={manager.id}
              onCopyPath={onCopyPath}
              onOpenPath={onOpenPath}
              onRequestCacheCleanup={onRequestCacheCleanup}
              pathNotes={manager.id === "Npm" ? npmPathNotes : undefined}
              paths={inlinePaths}
              pendingMaintenance={pendingMaintenance}
            />
          ) : null}
          {stackedPaths.length ? (
            <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
              {stackedPaths.map((path) => (
                <PathCard
                  cleanupAvailable={cleanupAvailable}
                  cleanupBlockReason={cleanupBlockReason}
                  homeDirectory={homeDirectory}
                  key={`${path.kind}-${path.path}`}
                  managerId={manager.id}
                  onCopyPath={onCopyPath}
                  onOpenPath={onOpenPath}
                  onRequestCacheCleanup={onRequestCacheCleanup}
                  path={path}
                  pendingMaintenance={pendingMaintenance}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState message="未解析到缓存或存储路径" />
      )}
    </div>
  );
}

function splitPaths(manager: ManagerSnapshot | null): { inlinePaths: PathInfo[]; stackedPaths: PathInfo[] } {
  if (!manager) {
    return { inlinePaths: [], stackedPaths: [] };
  }

  const inlinePathKinds =
    manager.id === "Npm"
      ? npmInlinePathKinds
      : manager.id === "Pnpm"
        ? pnpmInlinePathKinds
        : manager.id === "Yarn"
          ? yarnInlinePathKinds
          : manager.id === "Nvm"
            ? nvmInlinePathKinds
            : manager.id === "Docker"
              ? dockerInlinePathKinds
              : manager.id === "Bun"
                ? bunInlinePathKinds
                : manager.id === "Uv"
                  ? uvInlinePathKinds
                  : manager.id === "Fvm"
                    ? fvmInlinePathKinds
                    : [];

  if (!inlinePathKinds.length) {
    return { inlinePaths: [], stackedPaths: manager.paths.filter((path) => !hiddenPathKinds.includes(path.kind)) };
  }

  const inlinePaths = inlinePathKinds
    .map((kind) => manager.paths.find((path) => path.kind === kind))
    .filter((path): path is PathInfo => Boolean(path));
  const stackedPaths = manager.paths.filter((path) => !inlinePathKinds.includes(path.kind) && !hiddenPathKinds.includes(path.kind));

  return { inlinePaths, stackedPaths };
}

function InlinePathCard({
  cleanupAvailable,
  cleanupBlockReason,
  homeDirectory,
  managerId,
  onCopyPath,
  onOpenPath,
  onRequestCacheCleanup,
  pathNotes,
  paths,
  pendingMaintenance,
}: {
  cleanupAvailable: boolean;
  cleanupBlockReason: string | null;
  homeDirectory: string | null;
  managerId: ManagerSnapshot["id"];
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  onRequestCacheCleanup: () => void;
  pathNotes?: Partial<Record<PathInfo["kind"], string>>;
  paths: PathInfo[];
  pendingMaintenance: MaintenanceRequest | null;
}) {
  const itemCount = paths.length;
  const gridClassName =
    itemCount >= 3
      ? "grid grid-cols-1 gap-px bg-border @xl:grid-cols-2 @4xl:grid-cols-3"
      : itemCount === 2
        ? "grid grid-cols-1 gap-px bg-border @xl:grid-cols-2"
        : "grid grid-cols-1 gap-px bg-border";

  return (
    <div className={gridClassName}>
      {paths.map((path) => (
        <InlinePathCell
          cleanupAvailable={cleanupAvailable}
          cleanupBlockReason={cleanupBlockReason}
          homeDirectory={homeDirectory}
          key={`${path.kind}-${path.path}`}
          managerId={managerId}
          note={pathNotes?.[path.kind]}
          onCopyPath={onCopyPath}
          onOpenPath={onOpenPath}
          onRequestCacheCleanup={onRequestCacheCleanup}
          path={path}
          pendingMaintenance={pendingMaintenance}
        />
      ))}
    </div>
  );
}

function InlinePathCell({
  className = "min-w-0",
  cleanupAvailable,
  cleanupBlockReason,
  homeDirectory,
  managerId,
  note,
  onCopyPath,
  onOpenPath,
  onRequestCacheCleanup,
  path,
  pendingMaintenance,
}: {
  className?: string;
  cleanupAvailable: boolean;
  cleanupBlockReason: string | null;
  homeDirectory: string | null;
  managerId: ManagerSnapshot["id"];
  note?: string;
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  onRequestCacheCleanup: () => void;
  path: PathInfo;
  pendingMaintenance: MaintenanceRequest | null;
}) {
  const size = path.size;
  const sizeValue = size.status === "Ready" ? (size.human ? `${size.skipped > 0 ? "≥ " : ""}${size.human}` : null) : null;
  const detail = size.status === "Pending" ? "等待占用扫描" : `${size.files} 文件${size.skipped ? " · 已测下限" : ""}`;
  const cleanupCopy = cleanupAvailable ? cleanupCopyForPath(managerId, path.kind) : null;
  const pendingCleanup = pendingMaintenance?.kind === "cleanupCache" && pendingMaintenance.managerId === managerId;
  const cleanupBlockId = `cleanup-block-${managerId.toLowerCase()}-${path.kind.toLowerCase()}`;

  return (
    <div className={`${className} telemetry-cell border bg-background p-2`}>
      <div className="flex min-h-10 items-start justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <p className="truncate text-xs font-medium text-foreground">{pathLabel(path.label)}</p>
          {note ? <PathNoteTooltip label={`${pathLabel(path.label)}说明`} note={note} /> : null}
        </div>
        <StatusBadge className="shrink-0 px-1.5 text-xs" status={size.status} />
      </div>
      <div className="mt-2 flex min-h-5 items-baseline gap-2">
        {sizeValue ? <strong className="truncate text-sm font-medium leading-5">{sizeValue}</strong> : null}
        <p className="shrink-0 truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <code className="terminal-code mt-2 block whitespace-normal break-all px-1.5 py-1 text-xs leading-5 text-muted-foreground">{formatHomePath(path.path, homeDirectory)}</code>
      <div className="mt-2 flex items-center gap-1">
        <IconButton className="size-6 shrink-0" label={`复制 ${pathLabel(path.label)}路径`} onClick={() => onCopyPath(path.path)}>
          <Copy />
        </IconButton>
        <IconButton className="size-6 shrink-0" disabled={size.status === "Missing"} label={`打开 ${pathLabel(path.label)}路径`} onClick={() => onOpenPath(path.path)}>
          <ExternalLink />
        </IconButton>
        {cleanupCopy ? (
          <IconButton ariaDescribedBy={cleanupBlockReason ? cleanupBlockId : undefined} className="size-6 shrink-0" disabled={pendingCleanup || Boolean(cleanupBlockReason)} label={pendingCleanup ? "清理中" : cleanupCopy.action} onClick={onRequestCacheCleanup}>
            <Trash2 />
          </IconButton>
        ) : null}
      </div>
      {cleanupCopy && cleanupBlockReason ? <p className="mt-1 text-xs text-muted-foreground" id={cleanupBlockId}>{cleanupBlockReason}</p> : null}
      {size.message ? <p className="mt-1 truncate text-xs text-muted-foreground">{formatHomePathsInText(displayMessage(size.message), homeDirectory)}</p> : null}
    </div>
  );
}

function PathNoteTooltip({ label, note }: { label: string; note: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label={label} className="size-5 text-muted-foreground hover:text-foreground" size="icon-xs" type="button" variant="ghost">
            <Info />
          </Button>
        </TooltipTrigger>
        <TooltipContent align="start">
          {note}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PathCard({
  cleanupAvailable,
  cleanupBlockReason,
  homeDirectory,
  managerId,
  onCopyPath,
  onOpenPath,
  onRequestCacheCleanup,
  path,
  pendingMaintenance,
}: {
  cleanupAvailable: boolean;
  cleanupBlockReason: string | null;
  homeDirectory: string | null;
  managerId: ManagerSnapshot["id"];
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  onRequestCacheCleanup: () => void;
  path: PathInfo;
  pendingMaintenance: MaintenanceRequest | null;
}) {
  const cleanupCopy = cleanupAvailable ? cleanupCopyForPath(managerId, path.kind) : null;
  const pendingCleanup = pendingMaintenance?.kind === "cleanupCache" && pendingMaintenance.managerId === managerId;
  const cleanupBlockId = `cleanup-block-${managerId.toLowerCase()}-${path.kind.toLowerCase()}`;
  const size = path.size;
  const sizeValue = size.status === "Ready" ? (size.human ? `${size.skipped > 0 ? "≥ " : ""}${size.human}` : null) : null;
  const detail =
    size.status === "Pending" ? (
      <span>等待占用扫描</span>
    ) : (
      <>
        <span>{size.files} 个文件</span>
        <span>{size.directories} 个目录</span>
        <span>跳过 {size.skipped} 项</span>
      </>
    );

  return (
    <Card size="sm">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="truncate text-sm">{pathLabel(path.label)}</CardTitle>
          <p className="mt-1 text-xs font-medium text-muted-foreground">{pathKindLabels[path.kind]}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {sizeValue ? <strong className="text-sm font-medium leading-5">{sizeValue}</strong> : null}
          <StatusBadge status={size.status} />
        </div>
      </CardHeader>
      <CardContent>
        <code className="terminal-code block whitespace-normal break-all px-2 py-1.5 text-xs text-muted-foreground">{formatHomePath(path.path, homeDirectory)}</code>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{detail}</div>
        {size.message ? <p className="mt-2 text-xs text-muted-foreground">{formatHomePathsInText(displayMessage(size.message), homeDirectory)}</p> : null}
        <div className="mt-3 flex gap-2">
          <TextButton onClick={() => onCopyPath(path.path)}>
            <Copy data-icon="inline-start" />
            复制路径
          </TextButton>
          <IconButton disabled={size.status === "Missing"} label="打开路径" onClick={() => onOpenPath(path.path)}>
            <ExternalLink />
          </IconButton>
          {cleanupCopy ? (
            <IconButton ariaDescribedBy={cleanupBlockReason ? cleanupBlockId : undefined} disabled={pendingCleanup || Boolean(cleanupBlockReason)} label={pendingCleanup ? "清理中" : cleanupCopy.action} onClick={onRequestCacheCleanup}>
              <Trash2 />
            </IconButton>
          ) : null}
        </div>
        {cleanupCopy && cleanupBlockReason ? <p className="mt-2 text-xs text-muted-foreground" id={cleanupBlockId}>{cleanupBlockReason}</p> : null}
      </CardContent>
    </Card>
  );
}

function HomebrewCleanupCard({
  cleanupReady,
  cleanupBlockReason,
  homeDirectory,
  maintenance,
  onCopyCleanupCommand,
  onRequestCacheCleanup,
  pending,
  pendingCleanup,
}: {
  cleanupReady: boolean;
  cleanupBlockReason: string | null;
  homeDirectory: string | null;
  maintenance: HomebrewMaintenance | null;
  onCopyCleanupCommand: () => void;
  onRequestCacheCleanup: () => void;
  pending: boolean;
  pendingCleanup: boolean;
}) {
  if (!maintenance) return null;

  const cleanup = maintenance.cleanup;
  const status = pending && cleanup.status === "Pending" ? "Pending" : cleanup.status;

  return (
    <Card size="sm">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="text-sm">清理预演</CardTitle>
          <p className="mt-1 text-xs font-medium text-muted-foreground">仅预览，不会删除文件</p>
        </div>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent>
        <code className="terminal-code block truncate px-2 py-1.5 text-xs text-muted-foreground">{formatHomePathsInText(cleanup.command.preview, homeDirectory)}</code>
        <CleanupBody cleanup={cleanup} homeDirectory={homeDirectory} />
        <div className="mt-3 flex items-center gap-2">
          <TextButton onClick={onCopyCleanupCommand}>
            <Copy data-icon="inline-start" />
            复制预演命令
          </TextButton>
          {/* Keep the action visible, but disabled until its itemised preview is ready. */}
          <IconButton
            ariaDescribedBy={!cleanupReady ? "homebrew-cleanup-block" : undefined}
            disabled={pendingCleanup || !cleanupReady}
            label={pendingCleanup ? "清理中" : "执行 Homebrew 清理"}
            onClick={onRequestCacheCleanup}
          >
            <Trash2 />
          </IconButton>
        </div>
        {!cleanupReady ? <p className="mt-2 text-xs text-muted-foreground" id="homebrew-cleanup-block">{cleanupBlockReason ?? "清理预演尚未就绪。"}</p> : null}
      </CardContent>
    </Card>
  );
}

function CleanupBody({ cleanup, homeDirectory }: { cleanup: HomebrewMaintenance["cleanup"]; homeDirectory: string | null }) {
  if (cleanup.status === "Ready") {
    return cleanup.rawOutput ? (
      <pre className="terminal-code mt-3 max-h-40 overflow-auto p-3 text-xs leading-5">{formatHomePathsInText(trimTail(cleanup.rawOutput, 10), homeDirectory)}</pre>
    ) : (
      <p className="mt-2 text-xs text-muted-foreground">清理预演已完成，没有输出。</p>
    );
  }

  if (cleanup.status === "Failed") {
    return (
      <>
        <p className="mt-2 text-xs text-muted-foreground">{formatHomePathsInText(displayMessage(cleanup.message ?? "清理预演失败"), homeDirectory)}</p>
        {cleanup.rawOutput ? <pre className="terminal-code mt-3 max-h-40 overflow-auto p-3 text-xs leading-5">{formatHomePathsInText(trimTail(cleanup.rawOutput, 10), homeDirectory)}</pre> : null}
      </>
    );
  }

  return <p className="mt-2 text-xs text-muted-foreground">清理预演正在后台加载，以便 Homebrew 页签先快速显示。</p>;
}
