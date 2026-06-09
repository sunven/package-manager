import { Copy, ExternalLink, Info, Trash2 } from "lucide-react";
import { pathKindLabels } from "../constants";
import type { HomebrewMaintenance, ManagerSnapshot, PathInfo } from "../types";
import type { NpmMaintenanceRequest } from "../state";
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
const hiddenPathKinds: PathInfo["kind"][] = ["GlobalModules", "GlobalDir"];
const npmPathNotes: Partial<Record<PathInfo["kind"], string>> = {
  Cache: "npm 缓存已包含 npx 缓存；总占用只统计 npm 缓存，避免重复计算。",
};

export function PathPanel({
  homeDirectory,
  manager,
  onCopyCleanupCommand,
  onCopyPath,
  onRequestCacheClean,
  onOpenPath,
  pendingMaintenance,
  pendingHomebrewCleanup,
  scanning,
}: {
  homeDirectory: string | null;
  manager: ManagerSnapshot | null;
  onCopyCleanupCommand: () => void;
  onCopyPath: (path: string) => void;
  onRequestCacheClean: () => void;
  onOpenPath: (path: string) => void;
  pendingMaintenance: NpmMaintenanceRequest | null;
  pendingHomebrewCleanup: boolean;
  scanning: boolean;
}) {
  if (!manager) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState message={scanning ? "正在扫描路径..." : "尚未扫描"} />
      </div>
    );
  }

  const { inlinePaths, stackedPaths } = splitPaths(manager);

  return (
    <div className="flex flex-col gap-3">
      {manager.id === "Homebrew" ? (
        <HomebrewCleanupCard homeDirectory={homeDirectory} maintenance={manager.homebrew} onCopyCleanupCommand={onCopyCleanupCommand} pending={pendingHomebrewCleanup} />
      ) : null}
      {inlinePaths.length || stackedPaths.length ? (
        <>
          {inlinePaths.length ? (
            <InlinePathCard
              homeDirectory={homeDirectory}
              managerId={manager.id}
              onCopyPath={onCopyPath}
              onOpenPath={onOpenPath}
              onRequestCacheClean={onRequestCacheClean}
              pathNotes={manager.id === "Npm" ? npmPathNotes : undefined}
              paths={inlinePaths}
              pendingMaintenance={pendingMaintenance}
            />
          ) : null}
          {stackedPaths.map((path) => <PathCard homeDirectory={homeDirectory} key={`${path.kind}-${path.path}`} onCopyPath={onCopyPath} onOpenPath={onOpenPath} path={path} />)}
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
  homeDirectory,
  managerId,
  onCopyPath,
  onOpenPath,
  onRequestCacheClean,
  pathNotes,
  paths,
  pendingMaintenance,
}: {
  homeDirectory: string | null;
  managerId: ManagerSnapshot["id"];
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  onRequestCacheClean: () => void;
  pathNotes?: Partial<Record<PathInfo["kind"], string>>;
  paths: PathInfo[];
  pendingMaintenance: NpmMaintenanceRequest | null;
}) {
  const itemCount = paths.length;
  const gridClassName =
    itemCount >= 3 ? "grid grid-cols-3 gap-3" : itemCount === 2 ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-2";

  return (
    <div className={gridClassName}>
      {paths.map((path) => (
        <InlinePathCell
          homeDirectory={homeDirectory}
          key={`${path.kind}-${path.path}`}
          managerId={managerId}
          note={pathNotes?.[path.kind]}
          onCopyPath={onCopyPath}
          onOpenPath={onOpenPath}
          onRequestCacheClean={onRequestCacheClean}
          path={path}
          pendingMaintenance={pendingMaintenance}
        />
      ))}
    </div>
  );
}

function InlinePathCell({
  className = "min-w-0",
  homeDirectory,
  managerId,
  note,
  onCopyPath,
  onOpenPath,
  onRequestCacheClean,
  path,
  pendingMaintenance,
}: {
  className?: string;
  homeDirectory: string | null;
  managerId: ManagerSnapshot["id"];
  note?: string;
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  onRequestCacheClean: () => void;
  path: PathInfo;
  pendingMaintenance: NpmMaintenanceRequest | null;
}) {
  const size = path.size;
  const sizeValue = size.status === "Ready" ? (size.human ?? "0 B") : null;
  const detail = size.status === "Pending" ? "等待占用扫描" : `${size.files} 文件`;
  const canCleanNpmCache = managerId === "Npm" && path.kind === "Cache";
  const pendingCacheClean = pendingMaintenance?.kind === "cleanCache";

  return (
    <div className={`${className} rounded-md border bg-background p-2`}>
      <div className="flex min-h-10 items-start justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <p className="truncate text-xs font-medium text-foreground">{pathLabel(path.label)}</p>
          {note ? <PathNoteTooltip label={`${pathLabel(path.label)}说明`} note={note} /> : null}
        </div>
        <StatusBadge className="shrink-0 px-1.5 text-[10px]" status={size.status} />
      </div>
      <div className="mt-2 flex min-h-5 items-baseline gap-2">
        {sizeValue ? <strong className="truncate text-sm font-medium leading-5">{sizeValue}</strong> : null}
        <p className="shrink-0 truncate text-[11px] text-muted-foreground">{detail}</p>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <code className="h-6 min-w-0 flex-1 truncate rounded-md bg-muted px-1.5 text-[11px] leading-6 text-muted-foreground">{formatHomePath(path.path, homeDirectory)}</code>
        <IconButton className="size-6 shrink-0" label={`复制 ${pathLabel(path.label)}路径`} onClick={() => onCopyPath(path.path)}>
          <Copy />
        </IconButton>
        <IconButton className="size-6 shrink-0" disabled={size.status === "Missing"} label={`打开 ${pathLabel(path.label)}路径`} onClick={() => onOpenPath(path.path)}>
          <ExternalLink />
        </IconButton>
        {canCleanNpmCache ? (
          <IconButton className="size-6 shrink-0" disabled={pendingCacheClean} label="清理 npm 缓存" onClick={onRequestCacheClean}>
            <Trash2 />
          </IconButton>
        ) : null}
      </div>
      {size.message ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{formatHomePathsInText(displayMessage(size.message), homeDirectory)}</p> : null}
    </div>
  );
}

function PathNoteTooltip({ label, note }: { label: string; note: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label={label} className="size-5 rounded-full text-muted-foreground hover:text-foreground" size="icon-xs" type="button" variant="ghost">
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
  homeDirectory,
  onCopyPath,
  onOpenPath,
  path,
}: {
  homeDirectory: string | null;
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  path: PathInfo;
}) {
  const size = path.size;
  const sizeValue = size.status === "Ready" ? (size.human ?? "0 B") : null;
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
        <code className="block truncate rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{formatHomePath(path.path, homeDirectory)}</code>
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
        </div>
      </CardContent>
    </Card>
  );
}

function HomebrewCleanupCard({
  homeDirectory,
  maintenance,
  onCopyCleanupCommand,
  pending,
}: {
  homeDirectory: string | null;
  maintenance: HomebrewMaintenance | null;
  onCopyCleanupCommand: () => void;
  pending: boolean;
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
        <code className="block truncate rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{formatHomePathsInText(cleanup.command.preview, homeDirectory)}</code>
        <CleanupBody cleanup={cleanup} homeDirectory={homeDirectory} />
        <div className="mt-3">
          <TextButton onClick={onCopyCleanupCommand}>
            <Copy data-icon="inline-start" />
            复制预演命令
          </TextButton>
        </div>
      </CardContent>
    </Card>
  );
}

function CleanupBody({ cleanup, homeDirectory }: { cleanup: HomebrewMaintenance["cleanup"]; homeDirectory: string | null }) {
  if (cleanup.status === "Ready") {
    return cleanup.rawOutput ? (
      <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-foreground p-3 text-xs leading-5 text-background">{formatHomePathsInText(trimTail(cleanup.rawOutput, 10), homeDirectory)}</pre>
    ) : (
      <p className="mt-2 text-xs text-muted-foreground">清理预演已完成，没有输出。</p>
    );
  }

  if (cleanup.status === "Failed") {
    return (
      <>
        <p className="mt-2 text-xs text-muted-foreground">{formatHomePathsInText(displayMessage(cleanup.message ?? "清理预演失败"), homeDirectory)}</p>
        {cleanup.rawOutput ? <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-foreground p-3 text-xs leading-5 text-background">{formatHomePathsInText(trimTail(cleanup.rawOutput, 10), homeDirectory)}</pre> : null}
      </>
    );
  }

  return <p className="mt-2 text-xs text-muted-foreground">清理预演正在后台加载，以便 Homebrew 页签先快速显示。</p>;
}
