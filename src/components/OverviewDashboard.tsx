import type { DevelopmentHealthSummary } from "../developmentHealth";
import type { ManagerId } from "../types";
import type { ObservationCoverage } from "../observationCoverage";
import { formatBytes, formatHomePath, managerLabel } from "../utils/format";
import { statusLabels } from "../constants";
import { DevelopmentHealthPage } from "./DevelopmentHealthPage";
import { EmptyState, PageHeader, StatCard } from "./ui";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { ArrowUpRight } from "@phosphor-icons/react";

export function OverviewDashboard({ health, coverage, homeDirectory, scanningAll, maintenanceBusy, onRefreshAll, onOpenManager, onOpenView, onOpenCoverage }: {
  health: DevelopmentHealthSummary;
  coverage: ObservationCoverage;
  homeDirectory: string | null;
  scanningAll: boolean;
  maintenanceBusy: boolean;
  onRefreshAll: () => void;
  onOpenManager: (managerId: ManagerId) => void;
  onOpenView: (view: "cleanup" | "vscode" | "sessions" | "history" | "environment") => void;
  onOpenCoverage: () => void;
}) {
  return (
    <main className="view-grid overview-dashboard" aria-label="开发环境总览">
      <PageHeader
        title="开发环境总览"
        description="按需检查本机环境；未扫描不代表没有内容，维护前先查看范围和依据。"
        actions={
          <Button disabled={scanningAll || maintenanceBusy} onClick={onRefreshAll} type="button">
            {scanningAll ? "正在扫描已启用管理器" : "扫描已启用管理器"}
          </Button>
        }
      />
      <div className="stat-grid grid-cols-1 sm:grid-cols-3">
        <StatCard label="已扫描／已启用管理器" value={`${health.scannedManagerCount} / ${health.enabledManagerCount}`} />
        <StatCard label="包、版本与资源条目" value={health.scannedManagerCount ? String(health.totalPackages) : "—"} />
        <StatCard label="未扫描管理器" value={String(health.enabledManagerCount - health.scannedManagerCount)} />
      </div>
      <section aria-label="已启用管理器" className="manager-inventory">
        <span className="manager-inventory-label">已启用管理器</span>
        <div className="manager-inventory-grid">
          {health.managerStatuses.map((status) => (
            <button
              className="manager-token"
              key={status.managerId}
              onClick={() => onOpenManager(status.managerId)}
              title={`${managerLabel(status.managerId)} · ${statusLabels[status.status]}${status.status === "Not scanned" ? "" : ` · ${status.packageCount} 项`}`}
              type="button"
            >
              <ManagerMark id={status.managerId} />
              <span>{managerLabel(status.managerId)}</span>
              <span aria-hidden="true" className="status-dot size-2" data-status={status.status} />
            </button>
          ))}
        </div>
      </section>
      <Card className="gap-0 py-0">
        <div className="overview-board">
          <DevelopmentHealthPage health={health} homeDirectory={homeDirectory} onOpenManager={onOpenManager} />
          <StorageSection health={health} homeDirectory={homeDirectory} onOpenManager={onOpenManager} />
        </div>
      </Card>
      <div className="overview-lower">
        <Card className="gap-0 py-0">
          <div className="overview-section-head">
            <h2>观察覆盖度</h2>
            <Button aria-label="查看观察覆盖度" size="sm" variant="ghost" onClick={onOpenCoverage} type="button">查看详情<ArrowUpRight data-icon="inline-end" /></Button>
          </div>
          <CardContent className="overview-section-body">
            <dl className="fact-list">
              <div className="fact-row fact-row--lead"><dt>需注意</dt><dd>{coverage.summary.attention} 项</dd></div>
              <div className="fact-row"><dt>已观察</dt><dd>{coverage.summary.observed}{coverage.summary.partial ? `（含部分 ${coverage.summary.partial}）` : ""}</dd></div>
              <div className="fact-row"><dt>未观察</dt><dd>{coverage.summary.notObserved}</dd></div>
              <div className="fact-row"><dt>已停用</dt><dd>{coverage.summary.disabled}</dd></div>
            </dl>
            {coverage.summary.failed || coverage.summary.unavailable || coverage.summary.invalidated || coverage.summary.scopeChanged
              ? <p className="text-xs text-muted-foreground">
                {[
                  coverage.summary.failed ? `读取失败 ${coverage.summary.failed}` : null,
                  coverage.summary.unavailable ? `不可用 ${coverage.summary.unavailable}` : null,
                  coverage.summary.invalidated ? `已失效 ${coverage.summary.invalidated}` : null,
                  coverage.summary.scopeChanged ? `范围变化 ${coverage.summary.scopeChanged}` : null,
                ].filter(Boolean).join(" · ")}
              </p>
              : null}
            <p className="text-xs text-muted-foreground">未观察的来源不会被当作空清单，也不代表没有内容。</p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <div className="overview-section-head">
            <h2>其他本机数据</h2>
            <span>统计范围各自独立</span>
          </div>
          <CardContent className="px-4 py-2">
            <ul className="link-list">
              <li><button className="link-row" onClick={() => onOpenView("cleanup")} type="button">项目清理<span>构建产物</span></button></li>
              <li><button className="link-row" onClick={() => onOpenView("vscode")} type="button">VS Code 占用<span>工作区存储</span></button></li>
              <li><button className="link-row" onClick={() => onOpenView("sessions")} type="button">会话记录<span>本机会话</span></button></li>
              <li><button className="link-row" onClick={() => onOpenView("history")} type="button">历史<span>记录与快照</span></button></li>
              <li><button className="link-row" onClick={() => onOpenView("environment")} type="button">环境诊断<span>PATH 与命令来源</span></button></li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function StorageSection({ health, homeDirectory, onOpenManager }: {
  health: DevelopmentHealthSummary;
  homeDirectory: string | null;
  onOpenManager: (managerId: ManagerId) => void;
}) {
  const items = health.topStorage;
  const topTotal = items.reduce((sum, item) => sum + item.bytes, 0);
  const opacities = [1, 0.8, 0.62, 0.46, 0.32];

  return (
    <section className="overview-board-section" aria-labelledby="overview-storage-title">
      <div className="overview-section-head">
        <h2 id="overview-storage-title">存储测量</h2>
        <span>{health.scannedManagerCount ? `已测合计 ${formatBytes(health.totalBytes)}` : "尚未测量"}</span>
      </div>
      <div className="overview-section-body">
        {items.length ? (
          <>
            <div aria-hidden="true" className="storage-ruler">
              {items.map((item, index) => (
                <span
                  key={`${item.managerId}:${item.path}`}
                  style={{ opacity: opacities[index] ?? 0.3, width: `${Math.max(4, (item.bytes / topTotal) * 100)}%` }}
                />
              ))}
            </div>
            <ul className="storage-list">
              {items.map((item, index) => (
                <li key={`${item.managerId}:${item.path}`}>
                  <button className="storage-row w-full text-left" onClick={() => onOpenManager(item.managerId)} type="button">
                    <span aria-hidden="true" className="storage-swatch" style={{ opacity: opacities[index] ?? 0.3 }} />
                    <span className="storage-row-copy">
                      <strong>{managerLabel(item.managerId)} · {item.label}</strong>
                      <code>{formatHomePath(item.path, homeDirectory)}</code>
                    </span>
                    <span className="storage-row-value">{item.incomplete ? "已测下限 ≥ " : ""}{formatBytes(item.bytes)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">按已测值排列；共享文件可能被不同目录持有，目录占用不等于可回收空间。</p>
          </>
        ) : (
          <EmptyState message="尚无目录占用测量，请扫描管理器后查看" />
        )}
      </div>
    </section>
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
  AndroidSdk: "as",
};
