import type { DevelopmentHealthSummary } from "../developmentHealth";
import type { ManagerId } from "../types";
import type { ObservationCoverage } from "../observationCoverage";
import { formatBytes, formatHomePath, managerLabel } from "../utils/format";
import { DevelopmentHealthPage } from "./DevelopmentHealthPage";
import { StatCard, EmptyState } from "./ui";
import { Button } from "../../components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";

export function OverviewDashboard({ health, coverage, homeDirectory, scanningAll, maintenanceBusy, onRefreshAll, onOpenManager, onOpenView, onOpenCoverage }: {
  health: DevelopmentHealthSummary;
  coverage: ObservationCoverage;
  homeDirectory: string | null;
  scanningAll: boolean;
  maintenanceBusy: boolean;
  onRefreshAll: () => void;
  onOpenManager: (manager: ManagerId) => void;
  onOpenView: (view: "cleanup" | "vscode" | "sessions" | "history") => void;
  onOpenCoverage: () => void;
}) {
  return (
    <main className="view-grid overview-dashboard" aria-label="开发环境总览">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1"><h2 className="text-xl font-medium">开发环境总览</h2><p className="text-sm text-muted-foreground">按需检查本机环境，维护前先查看范围和依据。</p></div>
        <Button disabled={scanningAll || maintenanceBusy} onClick={onRefreshAll} type="button">{scanningAll ? "正在扫描已启用管理器" : "扫描已启用管理器"}</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="已扫描／已启用管理器" value={`${health.scannedManagerCount} / ${health.enabledManagerCount}`} tone="info" />
        <StatCard label="包、版本与资源条目" value={health.scannedManagerCount ? String(health.totalPackages) : "—"} tone="measurement" />
        <StatCard label="未扫描管理器" value={String(health.enabledManagerCount - health.scannedManagerCount)} />
      </div>
      <div className="overview-columns">
        <Card className="min-w-0 gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle aria-level={3} role="heading">观察覆盖度</CardTitle>
            <CardDescription>未观察不代表没有内容；这里只陈述读取时间、范围与完整性。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 px-4">
            <div className="grid gap-2 text-sm">
              <p><strong>{coverage.summary.attention}</strong> 项需注意</p>
              <p className="text-muted-foreground">
                已观察 {coverage.summary.observed}
                {coverage.summary.partial ? `（含部分 ${coverage.summary.partial}）` : ""}
                {" · "}未观察 {coverage.summary.notObserved}
                {coverage.summary.disabled ? ` · 已停用 ${coverage.summary.disabled}` : ""}
              </p>
              {(coverage.summary.failed || coverage.summary.unavailable || coverage.summary.invalidated || coverage.summary.scopeChanged)
                ? <p className="text-xs text-muted-foreground">
                  {[
                    coverage.summary.failed ? `读取失败 ${coverage.summary.failed}` : null,
                    coverage.summary.unavailable ? `不可用 ${coverage.summary.unavailable}` : null,
                    coverage.summary.invalidated ? `已失效 ${coverage.summary.invalidated}` : null,
                    coverage.summary.scopeChanged ? `范围变化 ${coverage.summary.scopeChanged}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                : null}
            </div>
            <Button className="justify-self-start" onClick={onOpenCoverage} size="sm" type="button" variant="outline">查看观察覆盖度</Button>
          </CardContent>
        </Card>
        <div className="grid min-w-0 gap-4">
          <DevelopmentHealthPage health={health} homeDirectory={homeDirectory} onOpenManager={onOpenManager} />
          <Card className="gap-4 py-4">
            <CardHeader className="px-4"><CardTitle aria-level={3} role="heading">目录占用 Top 5</CardTitle><CardDescription>按已测值排列；共享文件可能被不同目录持有，目录占用不等于可回收空间。</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-3 px-4">
              {health.topStorage.length ? health.topStorage.map((item) => <div className="flex items-start justify-between gap-2" key={`${item.managerId}:${item.path}`}>
                <div className="min-w-0"><p className="text-sm">{managerLabel(item.managerId)} · {item.label}</p><p className="break-all text-xs text-muted-foreground">{formatHomePath(item.path, homeDirectory)}</p><p className="overview-storage-value text-sm">{item.incomplete ? "已测下限 ≥ " : "目录占用 "}{formatBytes(item.bytes)}</p></div>
                <Button aria-label={`查看 ${managerLabel(item.managerId)}：${item.label}`} size="sm" variant="outline" onClick={() => onOpenManager(item.managerId)} type="button">查看</Button>
              </div>) : <EmptyState message="尚无目录占用测量，请扫描管理器后查看" />}
            </CardContent>
          </Card>
          <Card className="gap-4 py-4">
            <CardHeader className="px-4"><CardTitle aria-level={3} role="heading">其他本机数据</CardTitle><CardDescription>进入对应页面后查看，统计范围各自独立。</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2 px-4">
              <Button variant="outline" onClick={() => onOpenView("cleanup")} type="button">项目清理</Button>
              <Button variant="outline" onClick={() => onOpenView("vscode")} type="button">VS Code 占用</Button>
              <Button variant="outline" onClick={() => onOpenView("sessions")} type="button">会话记录</Button>
              <Button variant="outline" onClick={() => onOpenView("history")} type="button">历史</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

export function ManagerMark({ id }: { id: ManagerId }) {
  return (
    <span aria-hidden="true" className="studio-mark" data-manager={id}>
      {markGlyph[id]}
    </span>
  );
}

const markGlyph: Record<ManagerId, string> = {
  Npm: "n",
  Pnpm: "pn",
  Yarn: "y",
  Nvm: "nv",
  Homebrew: "b",
  Maven: "m",
  Pip: "py",
  Cargo: "c",
  Docker: "d",
  Bun: "bu",
  Uv: "uv",
  Fvm: "fv",
};
