import { ArrowClockwise as RefreshCw, Chats as MessagesSquare, Code as Code2, Gear as Settings, List, Moon, Pulse as Activity, Sun, Trash as Trash2 } from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";
import { managerLabel } from "../utils/format";
import type { ManagerId } from "../types";

type ViewId = "health" | "managers" | "cleanup" | "vscode" | "sessions" | "settings";

const viewMeta: Record<ViewId, { code: string; label: string }> = {
  health: { code: "体检", label: "开发体检" },
  managers: { code: "管理器", label: "包管理器" },
  cleanup: { code: "项目派生数据", label: "项目清理" },
  vscode: { code: "工作区存储", label: "VS Code 占用" },
  sessions: { code: "会话记录", label: "会话记录" },
  settings: { code: "设置", label: "系统设置" },
};

export function Shell({
  children,
  activeView,
  onRefresh,
  onShowHealth,
  onShowProjectCleanup,
  onShowVscodeStorage,
  onShowSessionRecords,
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
  onShowVscodeStorage: () => void;
  onShowSessionRecords: () => void;
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
      <div aria-hidden="true" className="telemetry-ambient" />
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <div className="telemetry-frame">
        <nav aria-label="主导航" className="telemetry-titlebar" data-tauri-drag-region="deep">
          <div className="telemetry-titlebar-drag" data-tauri-drag-region />
          <div className="telemetry-nav">
            <Button
              aria-current={activeView === "health" ? "page" : undefined}
              onClick={onShowHealth}
              size="xs"
              type="button"
              variant="ghost"
            >
              <Activity data-icon="inline-start" />
              体检
            </Button>
            <Button
              aria-current={activeView === "managers" ? "page" : undefined}
              onClick={onShowManagers}
              size="xs"
              type="button"
              variant="ghost"
            >
              <List data-icon="inline-start" />
              包管理器
            </Button>
            <Button
              aria-current={activeView === "cleanup" ? "page" : undefined}
              onClick={onShowProjectCleanup}
              size="xs"
              type="button"
              variant="ghost"
            >
              <Trash2 data-icon="inline-start" />
              项目清理
            </Button>
            <Button
              aria-current={activeView === "vscode" ? "page" : undefined}
              onClick={onShowVscodeStorage}
              size="xs"
              type="button"
              variant="ghost"
            >
              <Code2 data-icon="inline-start" />
              VS Code 占用
            </Button>
            <Button
              aria-current={activeView === "sessions" ? "page" : undefined}
              onClick={onShowSessionRecords}
              size="xs"
              type="button"
              variant="ghost"
            >
              <MessagesSquare data-icon="inline-start" />
              会话记录
            </Button>
          </div>
          <div className="telemetry-titlebar-end">
            <div className="telemetry-titlebar-drag" data-tauri-drag-region />
            <Button
              aria-current={activeView === "settings" ? "page" : undefined}
              onClick={onShowSettings}
              size="xs"
              type="button"
              variant="ghost"
            >
              <Settings data-icon="inline-start" />
              设置
            </Button>
          </div>
        </nav>
        <header>
          <div className="telemetry-header-grid">
            <div className="telemetry-title-block">
              <p className="telemetry-product-label">
                <samp>本机开发环境</samp>
                <samp className="telemetry-context">{activeView === "cleanup" || activeView === "vscode" || activeView === "sessions" ? activeMeta.code : scanMeta || activeMeta.code}</samp>
              </p>
              <h1 aria-label="Package Control" className="telemetry-title">
                <span>控制中心</span>
              </h1>
            </div>

            <div className="telemetry-control-block">
              <dl className="telemetry-readouts">
                <div className="telemetry-readout">
                  <dt className="telemetry-readout-label">{activeView === "vscode" || activeView === "sessions" ? "管理器占用" : "总占用"}</dt>
                  <dd className="telemetry-readout-value telemetry-readout-value--accent">{totalBytes}</dd>
                </div>
                <div className="telemetry-readout">
                  <dt className="telemetry-readout-label">当前对象</dt>
                  <dd className="telemetry-readout-value">{activeView === "vscode" ? "VS Code" : activeView === "sessions" ? "Codex · Claude" : managerLabel(selectedManager)}</dd>
                </div>
                <div className="telemetry-readout">
                  <dt className="telemetry-readout-label">当前视图</dt>
                  <dd className="telemetry-readout-value">{activeMeta.label}</dd>
                </div>
              </dl>
              <div className="telemetry-actions">
                <output className="telemetry-online">就绪</output>
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
                {activeView === "cleanup" || activeView === "vscode" || activeView === "sessions" ? (
                  <div className="telemetry-channel">
                    <samp>{activeView === "vscode" ? "工作区存储" : activeView === "sessions" ? "会话记录" : "项目扫描"}</samp>
                  </div>
                ) : (
                  <Button
                    className="telemetry-refresh"
                    disabled={scanning}
                    onClick={onRefresh}
                    size="sm"
                    type="button"
                  >
                    <RefreshCw className={scanning ? "animate-spin" : undefined} data-icon="inline-start" />
                    {scanning ? `正在扫描 ${managerLabel(selectedManager)}...` : `刷新 ${managerLabel(selectedManager)}`}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="telemetry-content" id="main-content">
          {children}
        </div>
      </div>
    </div>
  );
}
