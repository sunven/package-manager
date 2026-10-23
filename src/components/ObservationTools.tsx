import { Button } from "../../components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { managerLabels } from "../constants";
import { resolutionLabels } from "../environmentInspection";
import type { ObservationToolsState } from "../hooks/useObservationTools";
import type { ManagerId } from "../types";

const time = (value: number) => new Date(value).toLocaleString();

export function EnvironmentPanel({ state, onCopy, onOpenManager }: { state: ObservationToolsState; onCopy: (value: string) => void; onOpenManager: (manager: ManagerId) => void }) {
  const data = state.environment;
  return <main className="grid gap-4" aria-label="环境诊断">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">应用中的命令来源</h2><p className="mt-1 text-sm text-muted-foreground">按应用 PATH 顺序观察文件；Shell 函数和别名不在此范围，nvm 查看 Node 来源。</p></div><Button variant="outline" disabled={state.environmentBusy} onClick={() => void state.refreshEnvironment()}>刷新诊断</Button></div>
    {state.environmentError ? <Notice title="环境诊断未完成" message={state.environmentError} /> : null}
    {state.environmentBusy ? <p role="status" className="text-sm text-muted-foreground">正在读取 PATH 与命令候选…{data ? "以下暂为上次观察。" : ""}</p> : null}
    {data ? <>
      <p className="text-xs text-muted-foreground">观察时间 {time(data.capturedAt)} · {data.commands.length} 个命令 · 多个安装来源供复核使用</p>
      <div className="overflow-hidden rounded-xl border bg-card">
        {data.commands.map((command) => <details className="border-b last:border-b-0" key={command.program}>
          <summary className="cursor-pointer p-4 focus-visible:outline-2 focus-visible:outline-ring"><span className="ml-1 inline-flex max-w-[90%] flex-col gap-1 align-top"><span className="flex flex-wrap items-baseline gap-x-4 gap-y-1"><strong className="font-mono text-sm">{command.program}</strong><span className="text-xs text-muted-foreground">{resolutionLabels[command.status] ?? command.status}</span></span><code className="break-all text-xs text-muted-foreground">{command.selectedPath ?? "未找到可执行候选"}</code></span></summary>
          <div className="grid gap-3 border-t bg-muted/30 p-4">
            <div className="flex flex-wrap gap-2">{command.managers.map((manager) => <Button key={manager} variant="outline" size="sm" onClick={() => onOpenManager(manager)}>查看 {managerLabels[manager]}</Button>)}</div>
            {command.candidates.length ? command.candidates.map((candidate, index) => <div key={index} className="grid gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">PATH 第 {candidate.pathIndex + 1} 项{candidate.path === command.selectedPath ? " · 首个可执行候选" : ""}</span><Button variant="ghost" size="sm" onClick={() => onCopy(candidate.path)}>复制路径</Button></div>
              <code className="break-all text-xs">{candidate.path}</code>
              {candidate.target && candidate.target !== candidate.path ? <code className="break-all text-xs text-muted-foreground">文件目标：{candidate.target}</code> : null}
              {candidate.message ? <p className="break-words text-xs text-muted-foreground">{candidate.message}</p> : null}
            </div>) : <p className="text-sm text-muted-foreground">应用 PATH 中没有此命令；这不代表机器上未安装它。</p>}
          </div>
        </details>)}
      </div>
      <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">查看应用 PATH（{data.pathEntries.length} 项）</summary><ol className="mt-3 grid list-inside list-decimal gap-2 text-xs">{data.pathEntries.map((entry, index) => <li key={index}><code className="break-all">{entry.path}</code>{entry.original !== entry.path ? <span className="text-muted-foreground"> · 原值：{entry.original || "空项（应用工作目录）"}</span> : null}{entry.issue ? <p className="mt-1 text-muted-foreground">{entry.issue}</p> : null}</li>)}</ol></details>
    </> : !state.environmentBusy && !state.environmentError ? <p className="text-sm text-muted-foreground">刷新诊断以查看应用命令来源。</p> : null}
  </main>;
}

function Notice({ title, message }: { title: string; message: string }) {
  return <Alert><AlertTitle>{title}</AlertTitle><AlertDescription className="break-words">{message}</AlertDescription></Alert>;
}
