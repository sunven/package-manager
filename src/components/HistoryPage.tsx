import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { managerLabels } from "../constants";
import { formatSessionRecordId, removalReasonLabels } from "../sessionRecords";
import { vscodeRemovalReasonLabels } from "../vscodeRemoval";
import { useObservationTools } from "../hooks/useObservationTools";
import { useMaintenanceHistory } from "../hooks/useMaintenanceHistory";
import { historyRevision as globalHistoryRevision, subscribeHistoryRevision } from "../historyRevision";
import {
  executionSummaryLabels,
  filterMaintenanceRecords,
  followUpReadLabels,
  groupMaintenanceRecords,
  maintenanceDomainLabels,
  maintenanceOperationLabels,
  maintenanceRecordState,
  maintenanceRecoveryBoundary,
  maintenanceRecordTitle,
  verificationStatusLabels,
  type ExecutionSummary,
  type MaintenanceDomain,
  type MaintenanceDetail,
  type MaintenanceRecord,
  type MaintenanceRecordSummary,
  type ProjectCleanupDetail,
  type SessionTrashDetail,
  type OpenCodeDeletionDetail,
  type VscodeStorageDetail,
  type ManagerDetail,
} from "../maintenanceHistory";
import type { ManagerId } from "../types";
import { formatBytes, formatHomePath } from "../utils/format";
import { SnapshotHistory } from "./SnapshotHistory";

const selectClass = "max-w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const PAGE_SIZE = 50;
const time = (value: number | null) => value === null ? "—" : new Date(value).toLocaleString();

export interface HistoryRequest {
  domain?: MaintenanceDomain;
  recordId?: string;
}

export function HistoryPage({
  active,
  managers,
  historyRevision,
  homeDirectory,
  request,
  onRequestConsumed,
  onOpenDomain,
}: {
  active: boolean;
  managers: ManagerId[];
  historyRevision: number;
  homeDirectory: string | null;
  request: HistoryRequest | null;
  onRequestConsumed?: () => void;
  onOpenDomain?: (domain: MaintenanceDomain) => void;
}) {
  const domainRevision = useSyncExternalStore(subscribeHistoryRevision, globalHistoryRevision, globalHistoryRevision);
  const snapshots = useObservationTools(active ? "history" : null, managers, historyRevision);
  const maintenance = useMaintenanceHistory(active, historyRevision + domainRevision);
  const [tab, setTab] = useState<"records" | "snapshots">("records");
  const [domain, setDomain] = useState<MaintenanceDomain | "all">("all");
  const [execution, setExecution] = useState<ExecutionSummary | "all">("all");
  const [page, setPage] = useState(0);
  const [snapshotRequest, setSnapshotRequest] = useState<{ manager: ManagerId; before: string | null; after: string | null } | null>(null);

  useEffect(() => {
    if (!request?.recordId) return;
    setTab("records");
    setDomain(request.domain ?? "all");
    setExecution("all");
    void maintenance.select(request.recordId);
    onRequestConsumed?.();
  }, [request?.recordId, request?.domain]);

  useEffect(() => { setPage(0); }, [domain, execution]);

  const filtered = useMemo(
    () => filterMaintenanceRecords(maintenance.records, domain, execution),
    [maintenance.records, domain, execution],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const groups = groupMaintenanceRecords(paged);
  // Only re-evaluate on filter changes; the initial list load must not clear a deep-linked selection.
  useEffect(() => {
    if (maintenance.selectedId && !filtered.some((record) => record.id === maintenance.selectedId)) {
      void maintenance.select(null);
    }
  }, [domain, execution]);

  return <main className="grid gap-4" aria-label="维护历史">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">历史</h2>
        <p className="mt-1 text-sm text-muted-foreground">回看已确认的维护操作、逐目标结果和后续读取或核对。历史只读，不构成撤销或维护授权。</p>
      </div>
      <Button variant="outline" disabled={maintenance.loading} onClick={() => { void maintenance.refresh(); if (tab === "snapshots") void snapshots.refreshHistory(); }}>
        重新读取历史
      </Button>
    </div>
    <div className="flex gap-2" role="group" aria-label="历史类型">
      <Button variant={tab === "records" ? "secondary" : "ghost"} aria-pressed={tab === "records"} onClick={() => setTab("records")}>维护记录</Button>
      <Button variant={tab === "snapshots" ? "secondary" : "ghost"} aria-pressed={tab === "snapshots"} onClick={() => setTab("snapshots")}>快照对比</Button>
    </div>

    {tab === "snapshots" ? <SnapshotHistory state={snapshots} homeDirectory={homeDirectory} selectionRequest={snapshotRequest} /> : <>
      {maintenance.error ? <Notice title="历史读取失败" message={maintenance.error} /> : null}
      {maintenance.warnings.map((warning) => <Notice key={warning} title="部分历史无法读取" message={warning} />)}
      {maintenance.loading ? <p role="status" className="text-sm text-muted-foreground">正在读取维护记录…</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">领域
          <select className={selectClass} value={domain} onChange={(event) => setDomain(event.target.value as MaintenanceDomain | "all")}>
            <option value="all">全部领域</option>
            {Object.entries(maintenanceDomainLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">执行结果
          <select className={selectClass} value={execution} onChange={(event) => setExecution(event.target.value as ExecutionSummary | "all")}>
            <option value="all">全部状态</option>
            {Object.entries(executionSummaryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">{filtered.length} 条记录</span>
      </div>

      {!filtered.length ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">{maintenance.records.length ? "当前筛选没有匹配记录。" : "还没有维护记录。确认执行维护操作后，这里会保留范围、结果和后续读取。"}</p> : (
        <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] min-[1100px]:items-start">
          <div className="grid gap-4">
            {groups.map((group) => <section className="grid gap-2" key={group.key} aria-label={group.label}>
              <h3 className="text-xs font-medium text-muted-foreground">{group.label}</h3>
              <div className="overflow-hidden rounded-xl border bg-card">
                {group.records.map((record) => <button
                  className={`grid w-full gap-1 border-b p-4 text-left last:border-b-0 focus-visible:outline-2 focus-visible:outline-ring ${maintenance.selectedId === record.id ? "bg-muted/60" : ""}`}
                  key={record.id}
                  onClick={() => void maintenance.select(record.id)}
                  type="button"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-2"><strong className="break-all text-sm">{maintenanceRecordTitle(record)}</strong><span className="text-xs text-muted-foreground">{maintenanceRecordState(record)}</span></span>
                  <span className="text-xs text-muted-foreground">{time(record.startedAt)} · {maintenanceDomainLabels[record.domain]} · {maintenanceOperationLabels[record.operation]}</span>
                  <span className="text-xs text-muted-foreground">{countsText(record)}</span>
                  <span className="text-xs text-muted-foreground">{record.followUpReadStatus ? followUpReadLabels[record.followUpReadStatus] : record.verificationStatus ? verificationStatusLabels[record.verificationStatus] : "无后续读取或核对步骤"}</span>
                </button>)}
              </div>
            </section>)}
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</Button>
              <span className="text-xs text-muted-foreground">第 {page + 1} / {pageCount} 页</span>
              <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</Button>
            </div>
          </div>
          <section className={`rounded-xl border bg-card p-4 min-[1100px]:sticky min-[1100px]:top-2 ${maintenance.selectedId ? "max-[1099px]:fixed max-[1099px]:inset-3 max-[1099px]:z-50 max-[1099px]:overflow-y-auto max-[1099px]:bg-background max-[1099px]:shadow-xl" : "max-[1099px]:hidden"}`} aria-label="维护记录详情">
            {maintenance.selectedId ? <div className="mb-2 flex justify-end min-[1100px]:hidden"><Button onClick={() => void maintenance.select(null)} size="sm" type="button" variant="outline">关闭详情</Button></div> : null}
            {!maintenance.selectedId ? <p className="text-sm text-muted-foreground">选择一条记录查看确认范围、执行结果和后续读取或核对。</p> : maintenance.detailLoading ? <p className="text-sm text-muted-foreground">正在读取记录详情…</p> : maintenance.detailError ? <Notice title="记录详情无法读取" message={maintenance.detailError} /> : maintenance.detail ? <RecordDetail detail={maintenance.detail} homeDirectory={homeDirectory} onShowSnapshots={(manager, before, after) => { snapshots.setHistoryManager(manager); setSnapshotRequest({ manager, before, after }); setTab("snapshots"); }} onOpenDomain={onOpenDomain} /> : null}
          </section>
        </div>
      )}
    </>}
  </main>;
}

function RecordDetail({ detail, homeDirectory, onShowSnapshots, onOpenDomain }: {
  detail: MaintenanceRecord;
  homeDirectory: string | null;
  onShowSnapshots: (manager: ManagerId, before: string | null, after: string | null) => void;
  onOpenDomain?: (domain: MaintenanceDomain) => void;
}) {
  return <div className="grid gap-4">
    <div className="grid gap-1">
      <h3 className="break-all text-base font-semibold">{maintenanceRecordTitle({ domain: detail.domain, operation: detail.operation, subject: subjectFor(detail.detail) })}</h3>
      <p className="text-xs text-muted-foreground">{maintenanceDomainLabels[detail.domain]} · {maintenanceOperationLabels[detail.operation]} · {maintenanceRecordState(detail)}</p>
      <p className="text-xs text-muted-foreground">开始 {time(detail.startedAt)} · 结束 {time(detail.finishedAt)}</p>
    </div>
    <Alert><AlertTitle>恢复边界</AlertTitle><AlertDescription className="break-words">{maintenanceRecoveryBoundary(detail)}</AlertDescription></Alert>
    {detail.message ? <p className="whitespace-pre-wrap break-words text-sm">{detail.message}</p> : null}
    <DetailSection title="确认范围"><Scope detail={detail.detail} homeDirectory={homeDirectory} /></DetailSection>
    <DetailSection title="执行结果"><Results detail={detail.detail} /></DetailSection>
    <DetailSection title="后续读取或核对"><FollowUp detail={detail} onShowSnapshots={onShowSnapshots} /></DetailSection>
    <div className="flex flex-wrap gap-2">
      {onOpenDomain ? <Button variant="outline" size="sm" onClick={() => onOpenDomain(detail.domain)}>打开对应页面</Button> : null}
    </div>
  </div>;
}

function Scope({ detail, homeDirectory }: { detail: MaintenanceDetail; homeDirectory: string | null }) {
  if (detail.kind === "manager") return <ManagerScope detail={detail} />;
  if (detail.kind === "projectCleanup") return <ProjectScope detail={detail} homeDirectory={homeDirectory} />;
  if (detail.kind === "vscodeStorage") return <VscodeScope detail={detail} homeDirectory={homeDirectory} />;
  if (detail.kind === "sessionTrash") return <SessionScope detail={detail} />;
  return <OpenCodeScope detail={detail} />;
}

function ManagerScope({ detail }: { detail: ManagerDetail }) {
  return <dl className="grid gap-1 text-sm">
    <Row label="管理器" value={managerLabels[detail.managerId]} />
    <Row label="目标" value={detail.target ?? "缓存清理"} />
  </dl>;
}

function ProjectScope({ detail, homeDirectory }: { detail: ProjectCleanupDetail; homeDirectory: string | null }) {
  return <div className="grid gap-2 text-sm">
    <Row label="扫描根目录" value={formatHomePath(detail.scope.scanRootPath, homeDirectory)} />
    <Row label="扫描会话" value={detail.scope.scanId} />
    <Row label="批次" value={detail.scope.batchId} />
    <Row label="结束方式" value={detail.finish === "stopped" ? "用户停止" : "完成"} />
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">确认候选 {detail.scope.candidates.length} 项</p>
      {detail.scope.candidates.map((candidate) => <div className="rounded-lg border p-2 text-xs" key={candidate.candidateId}>
        <p className="break-all font-medium">{candidate.order + 1}. {candidate.kind} · {formatHomePath(candidate.directoryPath, homeDirectory)}</p>
        <p className="text-muted-foreground">确认时占用 {candidate.confirmedBytes === null ? "未测得" : formatBytes(candidate.confirmedBytes)}{candidate.confirmedComplete ? "" : " · 测量不完整"}</p>
      </div>)}
    </div>
  </div>;
}

function VscodeScope({ detail, homeDirectory }: { detail: VscodeStorageDetail; homeDirectory: string | null }) {
  return <div className="grid gap-2 text-sm">
    <p className="text-xs text-muted-foreground">确认记录 {detail.scope.workspaces.length} 项</p>
    {detail.scope.workspaces.map((workspace) => <div className="rounded-lg border p-2 text-xs" key={workspace.id}>
      <p className="break-all font-medium">{workspace.name}</p>
      <p className="break-all text-muted-foreground">{workspace.projectPath ? formatHomePath(workspace.projectPath, homeDirectory) : "项目位置未识别"} · {workspace.projectStatus}</p>
      <p className="text-muted-foreground">确认时占用 {workspace.bytes === null ? "未测得" : formatBytes(workspace.bytes)}{workspace.usageComplete ? "" : " · 测量不完整"}</p>
    </div>)}
  </div>;
}

function SessionScope({ detail }: { detail: SessionTrashDetail }) {
  const source = detail.scope.source === "grok" ? "Grok Build" : detail.scope.source === "codex" ? "Codex" : "Claude Code";
  return <div className="grid gap-2 text-sm">
    <Row label="来源" value={source} />
    {detail.scope.directory ? <Row label="确认来源目录" value={detail.scope.directory} /> : null}
    {detail.scope.cutoffMs != null ? <Row label="确认年龄门槛" value={time(detail.scope.cutoffMs)} /> : null}
    {detail.scope.source === "grok" ? <p className="text-xs text-muted-foreground">移入废纸篓仅作用于本机会话目录，外部搜索索引与远端副本保留，独立关联记录不自动连带移除。</p> : null}
    <Row label="模式" value={detail.scope.mode === "olderThan" ? `按年龄 · ${detail.scope.days} 天` : detail.scope.mode === "selected" ? "明确选择" : "单条"} />
    {detail.scope.confirmedCount !== null ? <Row label="确认时条数" value={String(detail.scope.confirmedCount)} /> : null}
    {detail.executionTotal !== null ? <Row label="执行时目标总数" value={String(detail.executionTotal)} /> : null}
    {detail.scope.confirmedRecords ? <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">确认时记录</p>
      {detail.scope.confirmedRecords.map((record) => <div className="rounded-lg border p-2 text-xs" key={record.id}>
        <p className="break-all font-medium">{record.title}</p>
        <p className="break-all text-muted-foreground">{record.workingDirectory ?? "没有工作目录"} · {record.lastActivityMs === null ? "最后活动时间未知" : time(record.lastActivityMs)}</p>
      </div>)}
    </div> : null}
  </div>;
}

function OpenCodeScope({ detail }: { detail: OpenCodeDeletionDetail }) {
  const planned = new Set([...detail.scope.confirmedAffected.map((record) => record.id), ...detail.scope.confirmedRoots.map((record) => record.id)]);
  const drift = detail.completedIds.filter((id) => !planned.has(id));
  return <div className="grid gap-2 text-sm">
    <Row label="来源" value="OpenCode" />
    <Row label="模式" value={detail.scope.mode === "olderThan" ? `按年龄 · ${detail.scope.days} 天` : detail.scope.mode === "selected" ? "明确选择" : "单条"} />
    <Row label="删除计划" value={detail.scope.planId} />
    <Row label="冻结根会话" value={String(detail.scope.confirmedRoots.length)} />
    <Row label="冻结级联范围" value={String(detail.scope.confirmedAffected.length)} />
    {detail.scope.confirmedRoots.map((record) => <div className="rounded-lg border p-2 text-xs" key={record.id}>
      <p className="break-all font-medium">{record.title}</p>
      <p className="break-all text-muted-foreground">{record.workingDirectory ?? "没有工作目录"} · {time(record.lastActivityMs)}{record.archived ? " · 已归档" : ""}</p>
    </div>)}
    {drift.length ? <Notice title="计划外新增后代" message={`实际完成集合包含 ${drift.length} 条不在确认计划中的会话：${drift.join("、")}`} /> : null}
  </div>;
}

function Results({ detail }: { detail: MaintenanceDetail }) {
  if (detail.kind === "manager") return <ManagerResults detail={detail} />;
  if (detail.kind === "projectCleanup") return <ProjectResults detail={detail} />;
  if (detail.kind === "vscodeStorage") return <SimpleResults items={detail.results.map((item) => ({ id: item.id, status: item.status, reason: item.reason, message: item.message }))} reasonLabels={vscodeRemovalReasonLabels as Record<string, string>} />;
  if (detail.kind === "sessionTrash") return <SimpleResults items={detail.results.map((item) => ({ id: item.id, label: formatSessionRecordId(detail.scope.source, item.id), status: item.status, reason: item.reason, message: item.message }))} reasonLabels={removalReasonLabels as Record<string, string>} />;
  return <OpenCodeResults detail={detail} />;
}

function ManagerResults({ detail }: { detail: ManagerDetail }) {
  if (!detail.steps) return <p className="text-sm text-muted-foreground">此记录没有逐步骤数据。</p>;
  return <div className="grid gap-1 text-sm">{detail.steps.map((step, index) => <div className="rounded-lg border p-2 text-xs" key={`${index}:${step.label}`}>
    <p className="font-medium">{step.label} · {step.state === "succeeded" ? "已完成" : step.state === "failed" ? "失败" : "跳过"}</p>
    {step.failureMessage ? <p className="break-words text-muted-foreground">{step.failureMessage}</p> : null}
  </div>)}</div>;
}

function ProjectResults({ detail }: { detail: ProjectCleanupDetail }) {
  const byId = new Map(detail.results.map((result) => [result.candidateId, result]));
  return <div className="grid gap-1 text-sm">{detail.scope.candidates.map((candidate) => {
    const result = byId.get(candidate.candidateId);
    const cleaned = result?.cleanedBytes;
    return <div className="rounded-lg border p-2 text-xs" key={candidate.candidateId}>
      <p className="break-all font-medium">{candidate.order + 1}. {candidate.directoryPath}</p>
      <p className="text-muted-foreground">{result ? projectStatusLabel(result.status) : detail.finish === "stopped" ? "未执行（批次停止）" : "未确认"}{cleaned !== null && cleaned !== undefined ? ` · 清理 ${formatBytes(cleaned)}` : ""}</p>
      {result?.failureMessage ? <p className="break-words text-muted-foreground">{result.failureMessage}</p> : null}
      {result?.effectFailureMessage ? <p className="break-words text-muted-foreground">调用失败：{result.effectFailureMessage}</p> : null}
      {result?.message ? <p className="break-words text-muted-foreground">{result.message}</p> : null}
    </div>;
  })}</div>;
}

function SimpleResults({ items, reasonLabels }: { items: { id: string; label?: string; status: string; reason: string | null; message: string | null }[]; reasonLabels: Record<string, string> }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">没有逐目标结果。</p>;
  return <div className="grid gap-1 text-sm">{items.map((item) => <div className="rounded-lg border p-2 text-xs" key={item.id}>
    <p className="break-all font-medium">{item.label ?? item.id} · {statusLabel(item.status)}</p>
    {item.reason ? <p className="text-muted-foreground">{reasonLabels[item.reason] ?? item.reason}</p> : null}
    {item.message ? <p className="break-words text-muted-foreground">{item.message}</p> : null}
  </div>)}</div>;
}

function OpenCodeResults({ detail }: { detail: OpenCodeDeletionDetail }) {
  if (!detail.results.length) return <p className="text-sm text-muted-foreground">没有逐根结果。</p>;
  return <div className="grid gap-1 text-sm">{detail.results.map((item) => <div className="rounded-lg border p-2 text-xs" key={item.id}>
    <p className="break-all font-medium">{item.id} · {item.status === "Deleted" ? "已删除" : item.status === "Failed" ? "失败" : "未尝试"}</p>
    {item.message ? <p className="break-words text-muted-foreground">{item.message}</p> : null}
  </div>)}</div>;
}

function FollowUp({ detail, onShowSnapshots }: { detail: MaintenanceRecord; onShowSnapshots: (manager: ManagerId, before: string | null, after: string | null) => void }) {
  const verification = detail.verification;
  const followUpRead = detail.followUpRead;
  if (verification) {
    const manager = detail.detail.kind === "manager" ? detail.detail.managerId : null;
    return <div className="grid gap-2 text-sm">
      <Row label="核对结果" value={verificationStatusLabels[verification.status]} />
      <Row label="核对时间" value={time(verification.recordedAt)} />
      {verification.message ? <p className="break-words text-muted-foreground">{verification.message}</p> : null}
      <p className="break-all text-xs text-muted-foreground">之前快照：{verification.beforeSnapshotId ?? "未关联"} · 之后快照：{verification.afterSnapshotId ?? "未关联"}</p>
      {manager ? <Button className="w-fit" variant="outline" size="sm" onClick={() => onShowSnapshots(manager, verification.beforeSnapshotId, verification.afterSnapshotId)}>在快照对比中查看</Button> : null}
    </div>;
  }
  if (followUpRead) {
    return <div className="grid gap-2 text-sm">
      <Row label="后续读取" value={followUpReadLabels[followUpRead.status]} />
      <Row label="读取时间" value={time(followUpRead.recordedAt)} />
      {followUpRead.message ? <p className="break-words text-muted-foreground">{followUpRead.message}</p> : null}
    </div>;
  }
  return <p className="text-sm text-muted-foreground">{detail.domain === "projectCleanup" ? "项目清理没有后续读取或核对步骤。" : "没有后续读取或核对步骤。"}</p>;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid gap-2"><h4 className="text-sm font-semibold">{title}</h4>{children}</section>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap justify-between gap-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="break-all text-right">{value}</span></div>;
}

function subjectFor(detail: MaintenanceDetail): MaintenanceRecordSummary["subject"] {
  if (detail.kind === "manager") return { managerId: detail.managerId, target: detail.target ?? undefined, targetCount: detail.steps?.length ?? 0 };
  if (detail.kind === "projectCleanup") return { rootPath: detail.scope.scanRootPath, targetCount: detail.scope.candidates.length };
  if (detail.kind === "vscodeStorage") return { source: "vscode", targetCount: detail.scope.workspaces.length };
  if (detail.kind === "sessionTrash") return { source: detail.scope.source, mode: detail.scope.mode, targetCount: detail.executionTotal ?? detail.scope.confirmedCount ?? detail.results.length };
  return { source: "opencode", mode: detail.scope.mode, targetCount: detail.scope.confirmedRoots.length };
}

function countsText(record: MaintenanceRecordSummary) {
  const { counts } = record;
  if (!counts.total) return "无逐目标计数";
  return `完成 ${counts.succeeded} · 跳过 ${counts.skipped} · 失败 ${counts.failed} · 未执行 ${counts.notAttempted}`;
}

function statusLabel(status: string) {
  if (status === "Moved") return "已移入废纸篓";
  if (status === "Skipped") return "跳过";
  if (status === "Failed") return "失败";
  return status;
}

function projectStatusLabel(status: string) {
  if (status === "Succeeded") return "已完成";
  if (status === "PartiallyCompleted") return "部分完成";
  if (status === "Failed") return "失败";
  if (status === "Skipped") return "跳过";
  if (status === "Rejected") return "拒绝执行";
  return status;
}

function Notice({ title, message }: { title: string; message: string }) {
  return <Alert><AlertTitle>{title}</AlertTitle><AlertDescription className="break-words">{message}</AlertDescription></Alert>;
}
