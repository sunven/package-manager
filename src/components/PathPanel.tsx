import { Copy, ExternalLink } from "lucide-react";
import { pathKindLabels } from "../constants";
import type { HomebrewMaintenance, ManagerSnapshot, PathInfo } from "../types";
import { displayMessage, pathLabel, trimTail } from "../utils/format";
import { EmptyState, IconButton, Panel, PanelHead, StatusBadge, TextButton } from "./ui";

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
  return (
    <Panel>
      <PanelHead eyebrow="路径" title="缓存 / 存储" />
      <div className="space-y-3 p-4">
        {!manager ? (
          <EmptyState message={scanning ? "正在扫描路径..." : "尚未扫描"} />
        ) : (
          <>
            {manager.id === "Homebrew" ? (
              <HomebrewCleanupCard maintenance={manager.homebrew} onCopyCleanupCommand={onCopyCleanupCommand} pending={pendingHomebrewCleanup} />
            ) : null}
            {manager.paths.length ? (
              manager.paths.map((path) => <PathCard key={`${path.kind}-${path.path}`} onCopyPath={onCopyPath} onOpenPath={onOpenPath} path={path} />)
            ) : (
              <EmptyState message="未解析到缓存或存储路径" />
            )}
            <CommandList manager={manager} onCopyCommand={onCopyCommand} />
          </>
        )}
      </div>
    </Panel>
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
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800">{pathLabel(path.label)}</p>
          <p className="mt-1 text-xs font-medium text-slate-500">{pathKindLabels[path.kind]}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {sizeValue ? <strong className="text-sm font-extrabold leading-5 text-slate-900">{sizeValue}</strong> : null}
          <StatusBadge status={size.status} />
        </div>
      </div>
      <code className="mt-3 block overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">{path.path}</code>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">{detail}</div>
      {size.message ? <p className="mt-2 text-xs text-slate-500">{displayMessage(size.message)}</p> : null}
      <div className="mt-3 flex gap-2">
        <TextButton onClick={() => onCopyPath(path.path)}>
          <Copy className="h-3.5 w-3.5" />
          复制路径
        </TextButton>
        <IconButton disabled={size.status === "Missing"} label="打开路径" onClick={() => onOpenPath(path.path)}>
          <ExternalLink className="h-4 w-4" />
        </IconButton>
      </div>
    </article>
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
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">清理预演</p>
          <p className="mt-1 text-xs font-medium text-slate-500">仅预览，不会删除文件</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <code className="mt-3 block overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">{cleanup.command.preview}</code>
      <CleanupBody cleanup={cleanup} />
      <div className="mt-3">
        <TextButton onClick={onCopyCleanupCommand}>
          <Copy className="h-3.5 w-3.5" />
          复制预演命令
        </TextButton>
      </div>
    </article>
  );
}

function CleanupBody({ cleanup }: { cleanup: HomebrewMaintenance["cleanup"] }) {
  if (cleanup.status === "Ready") {
    return cleanup.rawOutput ? (
      <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">{trimTail(cleanup.rawOutput, 10)}</pre>
    ) : (
      <p className="mt-2 text-xs text-slate-500">清理预演已完成，没有输出。</p>
    );
  }

  if (cleanup.status === "Failed") {
    return (
      <>
        <p className="mt-2 text-xs text-slate-500">{displayMessage(cleanup.message ?? "清理预演失败")}</p>
        {cleanup.rawOutput ? <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">{trimTail(cleanup.rawOutput, 10)}</pre> : null}
      </>
    );
  }

  return <p className="mt-2 text-xs text-slate-500">清理预演正在后台加载，以便 Homebrew 页签先快速显示。</p>;
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
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-sm font-bold text-slate-800">扫描命令</p>
      {manager.commands.map((command, index) => {
        const payload = JSON.stringify({ preview: command.preview, envelope: command }, null, 2);
        return (
          <div className="flex items-center gap-2" key={`${command.preview}-${index}`}>
            <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">{command.preview}</code>
            <IconButton label="复制命令详情" onClick={() => onCopyCommand(payload)}>
              <Copy className="h-4 w-4" />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
