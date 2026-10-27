import { Button } from "../../components/ui/button";
import {
  buildCommandLocationSummary,
  commandLocationTargetId,
  isAssociableCandidate,
  type CandidateLocationAssociation,
  type CommandLocationDescriptor,
  type CommandLocationScope,
  type CommandLocationSummary,
} from "../commandLocationAssociation";
import { managerLabels } from "../constants";
import { resolutionLabels } from "../environmentInspection";
import { useCommandLocationAssociations } from "../hooks/useCommandLocationAssociations";
import type { ObservationToolsState } from "../hooks/useObservationTools";
import type { ManagerScanState } from "../managerScanning";
import type { ObservationRecord } from "../observationLedger";
import type { ObservationItemId } from "../observationItems";
import type { ManagerId, ManagerSnapshot } from "../types";
import { pathLabel } from "../utils/format";
import { Notice } from "./ui";

const time = (value: number) => new Date(value).toLocaleString();

export function EnvironmentPanel({
  state,
  enabledManagers,
  managerSnapshots,
  scanStates,
  ledgerRecords,
  onCopy,
  onOpenManager,
}: {
  state: ObservationToolsState;
  enabledManagers: ManagerId[];
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  scanStates: Partial<Record<ManagerId, ManagerScanState>>;
  ledgerRecords: Partial<Record<ObservationItemId, ObservationRecord>>;
  onCopy: (value: string) => void;
  onOpenManager: (manager: ManagerId) => void;
}) {
  const data = state.environment;
  const associations = useCommandLocationAssociations(
    data,
    enabledManagers,
    managerSnapshots,
    scanStates,
    ledgerRecords,
  );
  const executableCount = data?.commands.reduce(
    (count, command) => count + command.candidates.filter(isAssociableCandidate).length,
    0,
  ) ?? 0;
  const indeterminate = executableCount > 0
    && associations.resultAvailable
    && !associations.error
    && !associations.hasUsableLocations;

  return <main className="grid gap-4" aria-label="环境诊断">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold">应用中的命令来源</h2>
        <p className="mt-1 text-sm text-muted-foreground">按应用 PATH 顺序观察文件；Shell 函数和别名不在此范围，nvm 查看 Node 来源。</p>
        <p className="mt-1 text-sm text-muted-foreground">关联只说明候选的目标路径位于某次观察到的安装位置内；不代表该管理器或包安装了它，也不比较版本或选择正确来源。</p>
      </div>
      <Button variant="outline" disabled={state.environmentBusy} onClick={() => void state.refreshEnvironment()}>刷新诊断</Button>
    </div>
    {state.environmentError ? <Notice title="环境诊断未完成" message={state.environmentError} /> : null}
    {associations.error ? <Notice title="命令位置关联计算失败" message={associations.error} /> : null}
    {indeterminate ? <Notice title="无法判断命令位置关联" message="尚无已观察命令位置。请先启用并扫描管理器。" /> : null}
    {state.environmentBusy ? <p role="status" className="text-sm text-muted-foreground">正在读取 PATH 与命令候选…{data ? "以下暂为上次观察。" : ""}</p> : null}
    {associations.busy ? <p role="status" className="text-sm text-muted-foreground">{associations.resultAvailable ? "正在更新命令位置关联…" : "正在计算命令位置关联…"}</p> : null}
    {data ? <>
      <p className="text-xs text-muted-foreground">观察时间 {time(data.capturedAt)} · {data.commands.length} 个命令 · 多个安装来源供复核使用</p>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-medium">关联范围（{associations.scope.observedCount} 个已观察管理器）</summary>
        <AssociationScope scope={associations.scope} />
      </details>
      <div className="overflow-hidden rounded-xl border bg-card">
        {data.commands.map((command) => {
          const targetIds = command.candidates
            .filter(isAssociableCandidate)
            .map((candidate) => commandLocationTargetId(command.program, candidate.pathIndex));
          const summary = associations.resultAvailable && !associations.error
            ? buildCommandLocationSummary(targetIds, associations.byTarget)
            : null;
          const label = summaryLabel(summary);
          return <details className="border-b last:border-b-0" key={command.program}>
            <summary className="cursor-pointer p-4 focus-visible:outline-2 focus-visible:outline-ring"><span className="ml-1 inline-flex max-w-[90%] flex-col gap-1 align-top"><span className="flex flex-wrap items-baseline gap-x-4 gap-y-1"><strong className="font-mono text-sm">{command.program}</strong><span className="text-xs text-muted-foreground">{resolutionLabels[command.status] ?? command.status}</span>{label ? <span className="text-xs text-muted-foreground">{label}</span> : null}</span><code className="break-all text-xs text-muted-foreground">{command.selectedPath ?? "未找到可执行候选"}</code></span></summary>
            <div className="grid gap-3 border-t bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">相关管理器</span>{command.managers.map((manager) => <Button key={manager} variant="outline" size="sm" onClick={() => onOpenManager(manager)}>查看 {managerLabels[manager]}</Button>)}</div>
              {command.candidates.length ? command.candidates.map((candidate, index) => {
                const targetId = commandLocationTargetId(command.program, candidate.pathIndex);
                const association = isAssociableCandidate(candidate)
                  && associations.resultAvailable
                  && !associations.error
                  ? associations.byTarget.get(targetId) ?? null
                  : null;
                return <div key={index} className="grid gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">PATH 第 {candidate.pathIndex + 1} 项{candidate.path === command.selectedPath ? " · 首个可执行候选" : ""}</span><Button variant="ghost" size="sm" onClick={() => onCopy(candidate.path)}>复制路径</Button></div>
                  <code className="break-all text-xs">{candidate.path}</code>
                  {candidate.target && candidate.target !== candidate.path ? <code className="break-all text-xs text-muted-foreground">文件目标：{candidate.target}</code> : null}
                  {candidate.message ? <p className="break-words text-xs text-muted-foreground">{candidate.message}</p> : null}
                  {association ? <CandidateAssociation association={association} scope={associations.scope} onCopy={onCopy} onOpenManager={onOpenManager} /> : null}
                </div>;
              }) : <p className="text-sm text-muted-foreground">应用 PATH 中没有此命令；这不代表机器上未安装它。</p>}
            </div>
          </details>;
        })}
      </div>
      <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">查看应用 PATH（{data.pathEntries.length} 项）</summary><ol className="mt-3 grid list-inside list-decimal gap-2 text-xs">{data.pathEntries.map((entry, index) => <li key={index}><code className="break-all">{entry.path}</code>{entry.original !== entry.path ? <span className="text-muted-foreground"> · 原值：{entry.original || "空项（应用工作目录）"}</span> : null}{entry.issue ? <p className="mt-1 text-muted-foreground">{entry.issue}</p> : null}</li>)}</ol></details>
    </> : !state.environmentBusy && !state.environmentError ? <p className="text-sm text-muted-foreground">刷新诊断以查看应用命令来源。</p> : null}
  </main>;
}

function summaryLabel(summary: CommandLocationSummary | null) {
  if (!summary) return null;
  if (summary.state === "associated") return `已关联 ${summary.managerCount} 个管理器`;
  if (summary.state === "notFound") return "当前已观察位置中未找到";
  if (summary.state === "indeterminate") return "无法判断";
  return null;
}

function CandidateAssociation({
  association,
  scope,
  onCopy,
  onOpenManager,
}: {
  association: CandidateLocationAssociation;
  scope: CommandLocationScope;
  onCopy: (value: string) => void;
  onOpenManager: (manager: ManagerId) => void;
}) {
  if (association.state === "notFound") {
    return <p className="text-xs text-muted-foreground">当前已观察位置中未找到</p>;
  }
  if (association.state !== "associated") return null;
  return <div className="grid gap-3 pt-1">
    {association.groups.map((group) => {
      const entry = scope.enabled.find((item) => item.managerId === group.managerId);
      return <section key={group.managerId} className="grid gap-2 rounded-lg border bg-background/60 p-3" aria-label={`${managerLabels[group.managerId]} 已观察位置`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <strong className="text-sm">{managerLabels[group.managerId]}</strong>
            <span className="text-xs text-muted-foreground">{entry?.scannedAt ? `观察于 ${time(entry.scannedAt)}` : "观察时间未知"}</span>
            {entry?.notes.map((note) => <span key={note} className="text-xs text-muted-foreground" title={note === "观察已失效" ? entry.invalidationReason ?? undefined : undefined}>· {note}</span>)}
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenManager(group.managerId)}>查看 {managerLabels[group.managerId]}</Button>
        </div>
        <div className="grid gap-2">
          {group.source ? <LocationRow label="管理范围" detail={pathLabel(group.source.label)} location={group.source} onCopy={onCopy} /> : null}
          {group.packages.map((pkg) => <LocationRow key={pkg.id} label="包" detail={pkg.label} location={pkg} onCopy={onCopy} />)}
          {group.interpreters.map((item) => <LocationRow key={item.id} label="解释器" detail="Pip 观察使用的解释器" location={item} onCopy={onCopy} />)}
        </div>
      </section>;
    })}
    {association.suppressed.length ? <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-xs font-medium">其他更宽的包含位置（{association.suppressed.length}）</summary>
      <p className="mt-2 text-xs text-muted-foreground">这些观察范围也包含该文件，但存在更具体的已观察位置；不代表安装归属。</p>
      <div className="mt-2 grid gap-2">
        {association.suppressed.map((item) => <LocationRow
          key={`${item.managerId}:${item.location.id}`}
          label={managerLabels[item.managerId]}
          detail={`${locationKindLabel(item.location)} · ${locationDetail(item.location)}`}
          location={item.location}
          onCopy={onCopy}
        />)}
      </div>
    </details> : null}
  </div>;
}

function AssociationScope({ scope }: { scope: CommandLocationScope }) {
  return <div className="mt-3 grid gap-2 text-xs">
    <p className="text-muted-foreground">只使用当前会话中的管理器快照，不使用历史快照。关联不代表安装归属。</p>
    <ul className="grid list-none gap-2">
      {scope.enabled.map((entry) => <li key={entry.managerId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="text-sm">{managerLabels[entry.managerId]}</strong>
        <span className="text-muted-foreground">{entry.scannedAt ? `观察于 ${time(entry.scannedAt)}` : entry.observed ? "观察时间未知" : "未观察"}</span>
        {entry.notes.filter((note) => entry.observed || note !== "未扫描").map((note) => <span key={note} className="text-muted-foreground" title={note === "观察已失效" ? entry.invalidationReason ?? undefined : undefined}>· {note}</span>)}
        {entry.observed ? <span className="text-muted-foreground">· {entry.locationCount} 个位置</span> : null}
      </li>)}
    </ul>
    {scope.disabled.length ? <p className="text-muted-foreground">已停用，不参与关联：{scope.disabled.map((managerId) => managerLabels[managerId]).join("、")}</p> : null}
  </div>;
}

function LocationRow({
  label,
  detail,
  location,
  onCopy,
}: {
  label: string;
  detail: string;
  location: CommandLocationDescriptor;
  onCopy: (value: string) => void;
}) {
  return <div className="grid gap-1">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {detail ? <span className="text-xs">{detail}</span> : null}
      <Button variant="ghost" size="sm" onClick={() => onCopy(location.path)} aria-label={`复制${label}路径`}>复制位置</Button>
    </div>
    <code className="break-all text-xs">{location.path}</code>
  </div>;
}

function locationKindLabel(location: CommandLocationDescriptor) {
  if (location.kind === "package") return "包";
  if (location.kind === "interpreter") return "解释器";
  return "管理范围";
}

function locationDetail(location: CommandLocationDescriptor) {
  if (location.kind === "package") return location.label;
  if (location.kind === "interpreter") return "Pip 观察使用的解释器";
  return pathLabel(location.label);
}
