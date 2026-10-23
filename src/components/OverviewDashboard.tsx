import type { DevelopmentHealthSummary } from "../developmentHealth";
import type { ManagerId, ManagerSnapshot } from "../types";
import { scanStateLabel, type ManagerScanState } from "../managerScanning";
import { formatBytes, formatHomePath, managerLabel } from "../utils/format";
import { DevelopmentHealthPage } from "./DevelopmentHealthPage";
import { StatCard, StatusBadge, EmptyState } from "./ui";
import { Button } from "../../components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";

export function OverviewDashboard({ health, homeDirectory, managerSnapshots, scanStates, scanningAll, maintenanceBusy, onRefreshAll, onOpenManager, onOpenView }: {
  health: DevelopmentHealthSummary;
  homeDirectory: string | null;
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  scanStates: Partial<Record<ManagerId, ManagerScanState>>;
  scanningAll: boolean;
  maintenanceBusy: boolean;
  onRefreshAll: () => void;
  onOpenManager: (manager: ManagerId) => void;
  onOpenView: (view: "cleanup" | "vscode" | "sessions" | "history") => void;
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
          <CardHeader className="px-4"><CardTitle aria-level={3} role="heading">管理器状态</CardTitle><CardDescription>未扫描不代表没有占用；最近扫描失败时保留上次结果。</CardDescription></CardHeader>
          <CardContent className="overview-manager-grid px-4">
            {health.managerStatuses.map(({ managerId }) => {
              const manager = managerSnapshots[managerId];
              const state = scanStates[managerId];
              return <div className="overview-manager-row" key={managerId}>
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2"><strong>{managerLabel(managerId)}</strong><StatusBadge status={state?.error && manager?.status === "Ready" ? "Partial" : manager?.status ?? (state?.error ? "Failed" : "Not scanned")} /></div>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{scanStateLabel(state, manager)}{state?.scannedAt ? ` · 数据时间 ${new Date(state.scannedAt).toLocaleString()}` : ""}</p>
                  {state?.error ? <p className="text-xs text-destructive [overflow-wrap:anywhere]">{state.error}</p> : null}
                </div>
                <Button onClick={() => onOpenManager(managerId)} size="sm" type="button" variant="outline" aria-label={`查看 ${managerLabel(managerId)}`}>查看</Button>
              </div>;
            })}
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
