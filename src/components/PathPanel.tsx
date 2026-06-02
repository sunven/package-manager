import { Copy, ExternalLink } from "lucide-react";
import { pathKindLabels } from "../constants";
import type { HomebrewMaintenance, ManagerSnapshot, PathInfo } from "../types";
import { displayMessage, pathLabel, trimTail } from "../utils/format";
import { EmptyState, IconButton, Panel, PanelHead, StatusBadge, TextButton } from "./ui";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

const npmInlinePathKinds: PathInfo["kind"][] = ["Cache", "NpxCache"];
const hiddenPathKinds: PathInfo["kind"][] = ["GlobalModules"];

export function PathPanel({
  manager,
  onCopyCleanupCommand,
  onCopyCommand,
  onCopyPath,
  onOpenPath,
  pendingHomebrewCleanup,
  scanning,
}: {
  manager: ManagerSnapshot | null;
  onCopyCleanupCommand: () => void;
  onCopyCommand: (payload: string) => void;
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  pendingHomebrewCleanup: boolean;
  scanning: boolean;
}) {
  const { inlinePaths, stackedPaths } = splitPaths(manager);
  const showCommandsInInlineCard = Boolean(inlinePaths.length && manager?.commands.length);

  return (
    <Panel>
      <PanelHead eyebrow="路径" title="缓存 / 存储" />
      <div className="flex flex-col gap-3 p-4">
        {!manager ? (
          <EmptyState message={scanning ? "正在扫描路径..." : "尚未扫描"} />
        ) : (
          <>
            {manager.id === "Homebrew" ? (
              <HomebrewCleanupCard maintenance={manager.homebrew} onCopyCleanupCommand={onCopyCleanupCommand} pending={pendingHomebrewCleanup} />
            ) : null}
            {inlinePaths.length || stackedPaths.length ? (
              <>
                {inlinePaths.length ? (
                  <InlinePathCard commands={showCommandsInInlineCard ? manager.commands : []} onCopyCommand={onCopyCommand} onCopyPath={onCopyPath} onOpenPath={onOpenPath} paths={inlinePaths} />
                ) : null}
                {stackedPaths.map((path) => <PathCard key={`${path.kind}-${path.path}`} onCopyPath={onCopyPath} onOpenPath={onOpenPath} path={path} />)}
              </>
            ) : (
              <EmptyState message="未解析到缓存或存储路径" />
            )}
            {showCommandsInInlineCard ? null : <CommandList manager={manager} onCopyCommand={onCopyCommand} />}
          </>
        )}
      </div>
    </Panel>
  );
}

function splitPaths(manager: ManagerSnapshot | null) {
  if (!manager || manager.id !== "Npm") {
    return { inlinePaths: [], stackedPaths: manager?.paths.filter((path) => !hiddenPathKinds.includes(path.kind)) ?? [] };
  }

  const inlinePaths = npmInlinePathKinds
    .map((kind) => manager.paths.find((path) => path.kind === kind))
    .filter((path): path is PathInfo => Boolean(path));
  const stackedPaths = manager.paths.filter((path) => !npmInlinePathKinds.includes(path.kind) && !hiddenPathKinds.includes(path.kind));

  return { inlinePaths, stackedPaths };
}

function InlinePathCard({
  commands,
  onCopyCommand,
  onCopyPath,
  onOpenPath,
  paths,
}: {
  commands: ManagerSnapshot["commands"];
  onCopyCommand: (payload: string) => void;
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  paths: PathInfo[];
}) {
  return (
    <div className={commands.length ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-2"}>
      {paths.map((path) => (
        <InlinePathCell key={`${path.kind}-${path.path}`} onCopyPath={onCopyPath} onOpenPath={onOpenPath} path={path} />
      ))}
      {commands.length ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-md border bg-background p-2">
          {commands.map((command, index) => (
            <CommandChip command={command} index={index} key={`${command.preview}-${index}`} onCopyCommand={onCopyCommand} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InlinePathCell({
  className = "min-w-0",
  onCopyPath,
  onOpenPath,
  path,
}: {
  className?: string;
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  path: PathInfo;
}) {
  const size = path.size;
  const sizeValue = size.status === "Ready" ? (size.human ?? "0 B") : null;
  const detail = size.status === "Pending" ? "等待占用扫描" : `${size.files} 文件`;

  return (
    <div className={`${className} rounded-md border bg-background p-2`}>
      <div className="flex min-h-10 items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{pathLabel(path.label)}</p>
        </div>
        <StatusBadge className="shrink-0 px-1.5 text-[10px]" status={size.status} />
      </div>
      <div className="mt-2 min-h-8">
        {sizeValue ? <strong className="block truncate text-sm font-medium leading-5">{sizeValue}</strong> : null}
        <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
      </div>
      <code className="mt-2 block truncate rounded-md bg-muted px-1.5 py-1 text-[11px] text-muted-foreground">{path.path}</code>
      {size.message ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{displayMessage(size.message)}</p> : null}
      <div className="mt-2 flex gap-1">
        <IconButton className="size-8" label={`复制 ${pathLabel(path.label)}路径`} onClick={() => onCopyPath(path.path)}>
          <Copy />
        </IconButton>
        <IconButton className="size-8" disabled={size.status === "Missing"} label={`打开 ${pathLabel(path.label)}路径`} onClick={() => onOpenPath(path.path)}>
          <ExternalLink />
        </IconButton>
      </div>
    </div>
  );
}

function PathCard({
  onCopyPath,
  onOpenPath,
  path,
}: {
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
        <code className="block truncate rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{path.path}</code>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{detail}</div>
        {size.message ? <p className="mt-2 text-xs text-muted-foreground">{displayMessage(size.message)}</p> : null}
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
  maintenance,
  onCopyCleanupCommand,
  pending,
}: {
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
        <code className="block truncate rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{cleanup.command.preview}</code>
        <CleanupBody cleanup={cleanup} />
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

function CleanupBody({ cleanup }: { cleanup: HomebrewMaintenance["cleanup"] }) {
  if (cleanup.status === "Ready") {
    return cleanup.rawOutput ? (
      <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-foreground p-3 text-xs leading-5 text-background">{trimTail(cleanup.rawOutput, 10)}</pre>
    ) : (
      <p className="mt-2 text-xs text-muted-foreground">清理预演已完成，没有输出。</p>
    );
  }

  if (cleanup.status === "Failed") {
    return (
      <>
        <p className="mt-2 text-xs text-muted-foreground">{displayMessage(cleanup.message ?? "清理预演失败")}</p>
        {cleanup.rawOutput ? <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-foreground p-3 text-xs leading-5 text-background">{trimTail(cleanup.rawOutput, 10)}</pre> : null}
      </>
    );
  }

  return <p className="mt-2 text-xs text-muted-foreground">清理预演正在后台加载，以便 Homebrew 页签先快速显示。</p>;
}

function CommandList({
  manager,
  onCopyCommand,
}: {
  manager: ManagerSnapshot;
  onCopyCommand: (payload: string) => void;
}) {
  if (!manager.commands.length) return null;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">扫描命令</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {manager.commands.map((command, index) => (
          <CommandChip command={command} index={index} key={`${command.preview}-${index}`} onCopyCommand={onCopyCommand} />
        ))}
      </CardContent>
    </Card>
  );
}

function CommandChip({
  command,
  index,
  onCopyCommand,
}: {
  command: ManagerSnapshot["commands"][number];
  index: number;
  onCopyCommand: (payload: string) => void;
}) {
  const payload = JSON.stringify({ preview: command.preview, envelope: command }, null, 2);

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{command.preview}</code>
      <IconButton label={`复制第 ${index + 1} 条扫描命令`} onClick={() => onCopyCommand(payload)}>
        <Copy />
      </IconButton>
    </div>
  );
}
