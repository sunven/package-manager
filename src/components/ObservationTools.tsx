import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { managerLabels, managerOrder } from "../constants";
import { resolutionLabels } from "../environmentInspection";
import { compareSnapshots, executionLabels, verificationLabels, type ArchivedSnapshot } from "../managerHistory";
import type { ObservationToolsState } from "../hooks/useObservationTools";
import type { ManagerId } from "../types";
import { formatBytes, formatHomePath } from "../utils/format";

const selectClass = "max-w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";
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

export function HistoryPanel({ state, homeDirectory }: { state: ObservationToolsState; homeDirectory: string | null }) {
  const [mode, setMode] = useState<"snapshots" | "operations">("snapshots");
  const [selection, setSelection] = useState<{ manager: ManagerId; before: string | null; after: string | null } | null>(null);
  const data = state.history;
  const snapshots = data?.snapshots ?? [];
  const explicit = selection?.manager === state.historyManager ? selection : null;
  const beforeId = explicit ? explicit.before : snapshots[1]?.id;
  const afterId = explicit ? explicit.after : snapshots[0]?.id;
  const before = snapshots.find((s) => s.id === beforeId);
  const after = snapshots.find((s) => s.id === afterId);
  return <main className="grid gap-4" aria-label="观察与维护历史">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">观察与维护历史</h2><p className="mt-1 text-sm text-muted-foreground">每个管理器保留最近 20 份快照，全局保留最近 200 条维护记录。</p></div><Button variant="outline" disabled={state.historyBusy} onClick={() => void state.refreshHistory()}>重新读取历史</Button></div>
    <div className="flex gap-2" role="group" aria-label="历史类型"><Button variant={mode === "snapshots" ? "secondary" : "ghost"} aria-pressed={mode === "snapshots"} onClick={() => setMode("snapshots")}>快照对比</Button><Button variant={mode === "operations" ? "secondary" : "ghost"} aria-pressed={mode === "operations"} onClick={() => setMode("operations")}>维护记录</Button></div>
    {state.historyError ? <Notice title="历史读取失败" message={state.historyError} /> : null}
    {data?.warnings.map((warning) => <Notice key={warning} title="部分历史无法读取" message={warning} />)}
    {state.historyBusy ? <p role="status" className="text-sm text-muted-foreground">正在读取历史…</p> : null}
    {mode === "snapshots" ? <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">管理器<select className={selectClass} value={state.historyManager} onChange={(event) => { setSelection(null); state.setHistoryManager(event.target.value as ManagerId); }}>{managerOrder.map((id) => <option key={id} value={id}>{managerLabels[id]}</option>)}</select></label>
        <SnapshotSelect label="之前" value={beforeId} snapshots={snapshots} onChange={(before) => setSelection({ manager: state.historyManager, before, after: afterId ?? null })} />
        <SnapshotSelect label="之后" value={afterId} snapshots={snapshots} onChange={(after) => setSelection({ manager: state.historyManager, before: beforeId ?? null, after })} />
      </div>
      {explicit && (!before || !after) && data ? <Notice title="关联快照不可用" message="至少一端快照未保存或已超出保留范围；维护记录中的执行结果仍保留。" /> : null}
      {before && after ? <SnapshotComparison key={`${before.id}:${after.id}`} before={before} after={after} homeDirectory={homeDirectory} /> : !state.historyBusy && data ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">{snapshots.length ? "再完成一轮扫描后，即可比较两次观察。" : "此管理器尚无历史。完整扫描流程结束后会自动留存快照。"}</p> : null}
      {after ? <SnapshotDetails snapshot={after} homeDirectory={homeDirectory} /> : null}
      {before && before.id !== after?.id ? <SnapshotDetails snapshot={before} homeDirectory={homeDirectory} /> : null}
    </> : <div className="overflow-hidden rounded-xl border bg-card">
      {!data?.operations.length ? <p className="p-5 text-sm text-muted-foreground">{state.historyBusy ? "正在读取维护记录…" : "尚无维护记录。确认执行管理器缓存清理或全局包卸载后，会在这里保留结果。"}</p> : data.operations.map((record) => <details key={record.id} className="border-b last:border-b-0">
        <summary className="cursor-pointer p-4"><span className="ml-1 inline-flex max-w-[90%] flex-col gap-1 align-top"><strong className="break-all text-sm">{managerLabels[record.managerId]} · {record.operation === "cleanupCache" ? "缓存清理" : `卸载 ${record.target}`}</strong><span className="text-xs text-muted-foreground">{time(record.startedAt)} · {executionLabels[record.execution] ?? "结果未确认"} · {verificationLabels[record.verification] ?? "尚未核对"}</span></span></summary>
        <div className="grid gap-3 border-t bg-muted/30 p-4 text-sm"><p className="whitespace-pre-wrap break-words">{record.message}</p>{record.finishedAt ? <p className="text-xs text-muted-foreground">执行结束 {time(record.finishedAt)}</p> : null}{record.verificationMessage ? <p className="break-words text-muted-foreground">核对：{record.verificationMessage}</p> : null}<Button className="w-fit" variant="outline" size="sm" onClick={() => { state.setHistoryManager(record.managerId); setSelection({ manager: record.managerId, before: record.beforeSnapshotId, after: record.afterSnapshotId }); setMode("snapshots"); }}>查看关联快照</Button></div>
      </details>)}
    </div>}
  </main>;
}

function SnapshotSelect({ label, value, snapshots, onChange }: { label: string; value: string | null | undefined; snapshots: ArchivedSnapshot[]; onChange: (id: string) => void }) {
  return <label className="grid gap-1 text-xs text-muted-foreground">{label}<select className={selectClass} value={snapshots.some((s) => s.id === value) ? value! : ""} onChange={(event) => onChange(event.target.value)}><option value="" disabled>选择快照</option>{snapshots.map((s) => <option key={s.id} value={s.id}>{time(s.capturedAt)} · {s.complete ? "清单完整" : "清单不完整"}</option>)}</select></label>;
}

function SnapshotComparison({ before, after, homeDirectory }: { before: ArchivedSnapshot; after: ArchivedSnapshot; homeDirectory: string | null }) {
  const diff = compareSnapshots(before, after);
  const [limit, setLimit] = useState(50);
  return <>
    {diff.issue ? <Notice title="条目差异无法判定" message={diff.issue} /> : <section className="overflow-hidden rounded-xl border bg-card" aria-label="条目变化"><h3 className="border-b p-4 text-sm font-semibold">条目变化 · {diff.packages.length} 项</h3>{!diff.packages.length ? <p className="p-4 text-sm text-muted-foreground">两次清单没有条目增减或版本／资源信息变化。</p> : diff.packages.slice(0, limit).map((change) => <div key={change.id} className="grid gap-1 border-b p-4 text-sm last:border-b-0"><p className="flex flex-wrap justify-between gap-2"><strong className="break-all">{change.name}</strong><span className="text-xs text-muted-foreground">{change.label}</span></p><p className="break-all text-xs text-muted-foreground">{change.before ?? "未出现在清单中"} → {change.after ?? "未出现在清单中"}</p></div>)}{diff.packages.length > limit ? <Button className="m-3" variant="outline" onClick={() => setLimit(limit + 50)}>继续加载条目变化</Button> : null}</section>}
    <section className="overflow-hidden rounded-xl border bg-card" aria-label="目录占用变化"><div className="border-b p-4"><h3 className="text-sm font-semibold">目录占用变化</h3><p className="mt-1 text-xs text-muted-foreground">仅完整测量计算差值；占用减少不等于实际释放空间。</p></div>{diff.paths.map((path) => <div key={path.key} className="grid gap-1 border-b p-4 last:border-b-0"><p className="flex flex-wrap justify-between gap-2 text-sm"><strong>{path.label}</strong><span>{path.delta === null ? "无法计算变化" : `${path.delta > 0 ? "+" : path.delta < 0 ? "−" : ""}${formatBytes(Math.abs(path.delta))}`}</span></p><code className="break-all text-xs text-muted-foreground">{formatHomePath(path.path, homeDirectory)}</code><p className="text-xs text-muted-foreground">{path.before === null ? "未测得" : formatBytes(path.before)} → {path.after === null ? "未测得" : formatBytes(path.after)}</p></div>)}{!diff.paths.length ? <p className="p-4 text-sm text-muted-foreground">两次观察均未提供目录测量。</p> : null}</section>
  </>;
}

function SnapshotDetails({ snapshot, homeDirectory }: { snapshot: ArchivedSnapshot; homeDirectory: string | null }) {
  return <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm">观察详情 · {time(snapshot.capturedAt)} · {snapshot.packages.length} 项 · {snapshot.complete ? "清单完整" : "清单不完整"}</summary><div className="mt-3 grid gap-3 text-xs text-muted-foreground">{snapshot.message ? <p className="break-words">{snapshot.message}</p> : null}<p>管理器版本：{snapshot.version ?? "未知"} · 状态：{snapshot.status}</p>{snapshot.packages.slice(0, 100).map((row, index) => <div key={index}><p className="break-all text-foreground">{row.name} · {row.observedVersions?.join("、") ?? row.version}</p>{row.path ? <code className="break-all">{formatHomePath(row.path, homeDirectory)}</code> : null}</div>)}{snapshot.packages.length > 100 ? <p>详情显示前 100 项；差异比较使用全部已保存条目。</p> : null}</div></details>;
}

function Notice({ title, message }: { title: string; message: string }) {
  return <Alert><AlertTitle>{title}</AlertTitle><AlertDescription className="break-words">{message}</AlertDescription></Alert>;
}
