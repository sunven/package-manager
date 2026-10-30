import ReactMarkdown from "react-markdown";
import { Button } from "../../components/ui/button";
import { appUpdateDevNotice } from "../appUpdateErrors";
import type { AppUpdateView } from "../appUpdateWorkflow";
import { Panel, PanelHead } from "./ui";

export interface AppUpdatePanelProps {
  view: AppUpdateView;
  onCheck(): void;
  onDownload(): void;
  onSkip(): void;
}

function statusText(view: AppUpdateView): string {
  if (view.devMode) return appUpdateDevNotice;

  switch (view.phase) {
    case "checking":
      return "正在检查更新…";
    case "upToDate":
      return "当前已是最新版本。";
    case "available":
      return `发现新版本 v${view.availableVersion}。`;
    case "downloading":
      return view.progress === null ? "正在下载更新…" : `正在下载更新… ${view.progress}%`;
    case "installing":
      return "更新已安装，正在重新启动…";
    case "failed":
      return view.error ?? "更新失败。";
    case "idle":
      return "尚未检查更新。";
  }
}

function primaryLabel(view: AppUpdateView): string {
  switch (view.phase) {
    case "checking":
      return "正在检查…";
    case "downloading":
      return "正在下载…";
    case "installing":
      return "正在安装…";
    case "available":
      return `更新到 ${view.availableVersion}`;
    case "failed":
      return view.availableVersion ? `重试更新到 ${view.availableVersion}` : "重试检查";
    default:
      return "检查更新";
  }
}

export function AppUpdatePanel({ view, onCheck, onDownload, onSkip }: AppUpdatePanelProps) {
  const busy = view.phase === "checking" || view.phase === "downloading" || view.phase === "installing";
  const canDownload = view.phase === "available" && view.availableVersion !== null;
  const canSkip = canDownload && view.availableVersion !== view.dismissedVersion;
  const primary = canDownload ? onDownload : onCheck;

  return (
    <Panel className="overflow-hidden">
      <PanelHead
        action={
          <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
            {view.currentVersion ? `当前版本 v${view.currentVersion}` : "版本未知"}
          </span>
        }
        title="软件更新"
      />
      <div className="grid gap-3 px-4 py-4">
        <p
          aria-live="polite"
          className={view.phase === "failed" ? "break-words text-sm text-destructive" : "break-words text-sm text-muted-foreground"}
          role="status"
        >
          {statusText(view)}
        </p>
        {view.phase === "downloading" ? (
          <div
            aria-label="更新下载进度"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={view.progress ?? undefined}
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div
              className={view.progress === null ? "h-full w-1/3 animate-pulse rounded-full bg-primary" : "h-full rounded-full bg-primary transition-[width]"}
              style={view.progress === null ? undefined : { width: `${view.progress}%` }}
            />
          </div>
        ) : null}
        {view.availableVersion && view.notes ? (
          <div className="max-h-56 overflow-auto rounded-lg border bg-muted/40 px-3 py-2 text-sm leading-6 text-muted-foreground [&_a]:underline [&_h1]:mt-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mt-2">
            <ReactMarkdown>{view.notes}</ReactMarkdown>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || view.devMode} onClick={primary} size="sm" type="button">
            {primaryLabel(view)}
          </Button>
          {canSkip ? (
            <Button onClick={onSkip} size="sm" type="button" variant="outline">
              跳过此版本
            </Button>
          ) : null}
          {view.phase === "failed" ? (
            <Button disabled={view.devMode} onClick={onCheck} size="sm" type="button" variant="outline">
              重新检查
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
