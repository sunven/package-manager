import { Activity, List, Moon, RefreshCw, Settings, Sun, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { managerLabel } from "../utils/format";
import type { ManagerId } from "../types";

type ViewId = "health" | "managers" | "cleanup" | "settings";

const viewMeta: Record<ViewId, { code: string; label: string }> = {
  health: { code: "SYS.HEALTH / 01", label: "开发体检" },
  managers: { code: "PKG.INDEX / 02", label: "包管理器" },
  cleanup: { code: "DISK.PURGE / 03", label: "项目清理" },
  settings: { code: "SYS.CONFIG / 04", label: "系统设置" },
};

export function Shell({
  children,
  activeView,
  onRefresh,
  onShowHealth,
  onShowProjectCleanup,
  onShowManagers,
  onShowSettings,
  onToggleTheme,
  scanMeta,
  scanning,
  selectedManager,
  totalBytes,
  theme,
}: {
  children: React.ReactNode;
  activeView: ViewId;
  onRefresh: () => void;
  onShowHealth: () => void;
  onShowProjectCleanup: () => void;
  onShowManagers: () => void;
  onShowSettings: () => void;
  onToggleTheme: () => void;
  scanMeta: string;
  scanning: boolean;
  selectedManager: ManagerId;
  totalBytes: string;
  theme: "dark" | "light";
}) {
  const activeMeta = viewMeta[activeView];
  const themeToggleLabel = theme === "dark" ? "切换到浅色主题" : "切换到深色主题";

  return (
    <div className="telemetry-shell bg-background text-foreground">
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <div className="telemetry-frame">
        <header>
          <div className="telemetry-rail">
            <samp className="truncate">LOCALHOST / DEVELOPMENT ASSET CONTROL</samp>
            <samp className="truncate">{activeView === "cleanup" ? "PROJECT DATA CHANNEL" : scanMeta || activeMeta.code}</samp>
            <div className="telemetry-status">
              <output className="telemetry-online">SYSTEM ONLINE</output>
              <Button
                aria-label={themeToggleLabel}
                aria-pressed={theme === "light"}
                className="telemetry-theme-toggle"
                onClick={onToggleTheme}
                size="icon-xs"
                title={themeToggleLabel}
                type="button"
                variant="ghost"
              >
                {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              </Button>
            </div>
          </div>

          <div className="telemetry-header-grid">
            <div className="telemetry-title-block">
              <h1 aria-label="Package Control" className="telemetry-title">
                <span>PKG</span>
                <span>CONTROL</span>
              </h1>
              <p className="telemetry-product-label">开发环境控制中心</p>
            </div>

            <div className="telemetry-control-block">
              <dl className="telemetry-readouts">
                <div className="telemetry-readout">
                  <dt className="telemetry-readout-label">TOTAL FOOTPRINT / 总占用</dt>
                  <dd className="telemetry-readout-value telemetry-readout-value--accent">{totalBytes}</dd>
                </div>
                <div className="telemetry-readout">
                  <dt className="telemetry-readout-label">ACTIVE UNIT</dt>
                  <dd className="telemetry-readout-value">{managerLabel(selectedManager)}</dd>
                </div>
                <div className="telemetry-readout">
                  <dt className="telemetry-readout-label">VIEW CHANNEL</dt>
                  <dd className="telemetry-readout-value">{activeMeta.label}</dd>
                </div>
              </dl>
              {activeView === "cleanup" ? (
                <div className="flex min-h-12 items-center bg-card px-4 text-xs text-muted-foreground">
                  <samp>[ PROJECT SCAN ]</samp>
                </div>
              ) : (
                <Button
                  className="telemetry-refresh"
                  disabled={scanning}
                  onClick={onRefresh}
                  size="lg"
                  type="button"
                >
                  <RefreshCw className={scanning ? "animate-spin" : undefined} data-icon="inline-start" />
                  {scanning ? `正在扫描 ${managerLabel(selectedManager)}...` : `刷新 ${managerLabel(selectedManager)}`}
                </Button>
              )}
            </div>
          </div>

          <nav aria-label="主导航" className="telemetry-nav">
            <Button
              aria-current={activeView === "health" ? "page" : undefined}
              onClick={onShowHealth}
              type="button"
              variant="ghost"
            >
              <Activity data-icon="inline-start" />
              体检
            </Button>
            <Button
              aria-current={activeView === "managers" ? "page" : undefined}
              onClick={onShowManagers}
              type="button"
              variant="ghost"
            >
              <List data-icon="inline-start" />
              包管理器
            </Button>
            <Button
              aria-current={activeView === "cleanup" ? "page" : undefined}
              onClick={onShowProjectCleanup}
              type="button"
              variant="ghost"
            >
              <Trash2 data-icon="inline-start" />
              项目清理
            </Button>
            <Button
              aria-current={activeView === "settings" ? "page" : undefined}
              onClick={onShowSettings}
              type="button"
              variant="ghost"
            >
              <Settings data-icon="inline-start" />
              设置
            </Button>
          </nav>
        </header>

        <div className="telemetry-content" id="main-content">
          {children}
        </div>
      </div>
    </div>
  );
}
