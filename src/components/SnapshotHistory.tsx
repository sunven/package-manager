import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { managerLabels, managerOrder } from "../constants";
import { compareSnapshots, type ArchivedSnapshot } from "../managerHistory";
import type { ObservationToolsState } from "../hooks/useObservationTools";
import type { ManagerId } from "../types";
import { formatBytes, formatHomePath } from "../utils/format";
import { Notice } from "./ui";

const selectClass = "select-control";
const time = (value: number) => new Date(value).toLocaleString();

export function SnapshotHistory({ state, homeDirectory, selectionRequest }: { state: ObservationToolsState; homeDirectory: string | null; selectionRequest?: { manager: ManagerId; before: string | null; after: string | null } | null }) {
  const [selection, setSelection] = useState<{ manager: ManagerId; before: string | null; after: string | null } | null>(null);
  useEffect(() => {
    if (selectionRequest) setSelection(selectionRequest);
  }, [selectionRequest]);
  const data = state.history;
  const snapshots = data?.snapshots ?? [];
  const explicit = selection?.manager === state.historyManager ? selection : null;
  const beforeId = explicit ? explicit.before : snapshots[1]?.id;
  const afterId = explicit ? explicit.after : snapshots[0]?.id;
  const before = snapshots.find((snapshot) => snapshot.id === beforeId);
  const after = snapshots.find((snapshot) => snapshot.id === afterId);

  return <div className="grid gap-4" aria-label="快照对比">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">每个管理器保留最近 20 份快照；只在同来源、两份清单均完整时比较条目变化。</p>
      <Button variant="outline" disabled={state.historyBusy} onClick={() => void state.refreshHistory()}>重新读取快照</Button>
    </div>
    {state.historyError ? <Notice title="历史读取失败" message={state.historyError} /> : null}
    {data?.warnings.map((warning) => <Notice key={warning} title="部分历史无法读取" message={warning} />)}
    {state.historyBusy ? <p role="status" className="text-sm text-muted-foreground">正在读取历史…</p> : null}
    <div className="flex flex-wrap items-end gap-3">
      <label className="filter-label">管理器<select className={selectClass} value={state.historyManager} onChange={(event) => { setSelection(null); state.setHistoryManager(event.target.value as ManagerId); }}>{managerOrder.map((id) => <option key={id} value={id}>{managerLabels[id]}</option>)}</select></label>
      <SnapshotSelect label="之前" value={beforeId} snapshots={snapshots} onChange={(before) => setSelection({ manager: state.historyManager, before, after: afterId ?? null })} />
      <SnapshotSelect label="之后" value={afterId} snapshots={snapshots} onChange={(after) => setSelection({ manager: state.historyManager, before: beforeId ?? null, after })} />
    </div>
    {explicit && (!before || !after) && data ? <Notice title="关联快照不可用" message="至少一端快照未保存或已超出保留范围；维护记录中的执行结果仍保留。" /> : null}
    {before && after ? <SnapshotComparison key={`${before.id}:${after.id}`} before={before} after={after} homeDirectory={homeDirectory} /> : !state.historyBusy && data ? <p className="rounded-lg border p-5 text-sm text-muted-foreground">{snapshots.length ? "再完成一轮扫描后，即可比较两次观察。" : "此管理器尚无历史。完整扫描流程结束后会自动留存快照。"}</p> : null}
    {after ? <SnapshotDetails snapshot={after} homeDirectory={homeDirectory} /> : null}
    {before && before.id !== after?.id ? <SnapshotDetails snapshot={before} homeDirectory={homeDirectory} /> : null}
  </div>;
}

function SnapshotSelect({ label, value, snapshots, onChange }: { label: string; value: string | null | undefined; snapshots: ArchivedSnapshot[]; onChange: (id: string) => void }) {
  return <label className="filter-label">{label}<select className={selectClass} value={snapshots.some((snapshot) => snapshot.id === value) ? value! : ""} onChange={(event) => onChange(event.target.value)}><option value="" disabled>选择快照</option>{snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{time(snapshot.capturedAt)} · {snapshot.complete ? "清单完整" : "清单不完整"}</option>)}</select></label>;
}

function SnapshotComparison({ before, after, homeDirectory }: { before: ArchivedSnapshot; after: ArchivedSnapshot; homeDirectory: string | null }) {
  const diff = compareSnapshots(before, after);
  const [limit, setLimit] = useState(50);
  return <>
    {diff.issue ? <Notice title="条目差异无法判定" message={diff.issue} /> : <section className="overflow-hidden rounded-lg border bg-card" aria-label="条目变化"><h3 className="border-b p-4 text-sm font-semibold">条目变化 · {diff.packages.length} 项</h3>{!diff.packages.length ? <p className="p-4 text-sm text-muted-foreground">两次清单没有条目增减或版本／资源信息变化。</p> : diff.packages.slice(0, limit).map((change) => <div key={change.id} className="grid gap-1 border-b p-4 text-sm last:border-b-0"><p className="flex flex-wrap justify-between gap-2"><strong className="break-all">{change.name}</strong><span className="text-xs text-muted-foreground">{change.label}</span></p><p className="break-all text-xs text-muted-foreground">{change.before ?? "未出现在清单中"} → {change.after ?? "未出现在清单中"}</p></div>)}{diff.packages.length > limit ? <Button className="m-3" variant="outline" onClick={() => setLimit(limit + 50)}>继续加载条目变化</Button> : null}</section>}
    <section className="overflow-hidden rounded-lg border bg-card" aria-label="目录占用变化"><div className="border-b p-4"><h3 className="text-sm font-semibold">目录占用变化</h3><p className="mt-1 text-xs text-muted-foreground">仅完整测量计算差值；占用减少不等于实际释放空间。</p></div>{diff.paths.map((path) => <div key={path.key} className="grid gap-1 border-b p-4 last:border-b-0"><p className="flex flex-wrap justify-between gap-2 text-sm"><strong>{path.label}</strong><span>{path.delta === null ? "无法计算变化" : `${path.delta > 0 ? "+" : path.delta < 0 ? "−" : ""}${formatBytes(Math.abs(path.delta))}`}</span></p><code className="break-all text-xs text-muted-foreground">{formatHomePath(path.path, homeDirectory)}</code><p className="text-xs text-muted-foreground">{path.before === null ? "未测得" : formatBytes(path.before)} → {path.after === null ? "未测得" : formatBytes(path.after)}</p></div>)}{!diff.paths.length ? <p className="p-4 text-sm text-muted-foreground">两次观察均未提供目录测量。</p> : null}</section>
  </>;
}

function SnapshotDetails({ snapshot, homeDirectory }: { snapshot: ArchivedSnapshot; homeDirectory: string | null }) {
  return <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm">观察详情 · {time(snapshot.capturedAt)} · {snapshot.packages.length} 项 · {snapshot.complete ? "清单完整" : "清单不完整"}</summary><div className="mt-3 grid gap-3 text-xs text-muted-foreground">{snapshot.message ? <p className="break-words">{snapshot.message}</p> : null}<p>管理器版本：{snapshot.version ?? "未知"} · 状态：{snapshot.status}</p>{snapshot.packages.slice(0, 100).map((row, index) => <div key={index}><p className="break-all text-foreground">{row.name} · {row.observedVersions?.join("、") ?? row.version}</p>{row.path ? <code className="break-all">{formatHomePath(row.path, homeDirectory)}</code> : null}</div>)}{snapshot.packages.length > 100 ? <p>详情显示前 100 项；差异比较使用全部已保存条目。</p> : null}</div></details>;
}
