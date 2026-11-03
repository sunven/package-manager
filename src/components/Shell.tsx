import { useId, useRef, useState } from "react";
import {
  CaretDown,
  Chats as MessagesSquare,
  ClockCounterClockwise,
  Code as Code2,
  Gear as Settings,
  House,
  Moon,
  Package,
  Robot,
  Sun,
  TerminalWindow,
  Trash as Trash2,
} from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";

type ViewId = "health" | "history" | "managers" | "cleanup" | "vscode" | "sessions" | "plugins" | "claude" | "settings";

const observeViews: { id: ViewId; label: string; icon: typeof House }[] = [
  { id: "health", label: "总览", icon: House },
  { id: "history", label: "历史", icon: ClockCounterClockwise },
];

const maintainViews: { id: ViewId; label: string; icon: typeof House }[] = [
  { id: "managers", label: "包管理器", icon: Package },
  { id: "cleanup", label: "项目清理", icon: Trash2 },
  { id: "vscode", label: "VS Code 占用", icon: Code2 },
  { id: "sessions", label: "会话记录", icon: MessagesSquare },
];

const extensionViews: { id: ViewId; label: string; icon: typeof House }[] = [
  { id: "plugins", label: "Codex", icon: TerminalWindow },
  { id: "claude", label: "Claude Code", icon: Robot },
];

export function Shell({
  children,
  search,
  activeView,
  onShowHealth,
  onShowHistory,
  onShowProjectCleanup,
  onShowVscodeStorage,
  onShowSessionRecords,
  onShowCodexPlugins,
  onShowClaudeCode,
  onShowManagers,
  onShowSettings,
  onToggleTheme,
  scanning,
  theme,
}: {
  children: React.ReactNode;
  search?: React.ReactNode;
  activeView: ViewId;
  onShowHealth: () => void;
  onShowHistory: () => void;
  onShowProjectCleanup: () => void;
  onShowVscodeStorage: () => void;
  onShowSessionRecords: () => void;
  onShowCodexPlugins: () => void;
  onShowClaudeCode: () => void;
  onShowManagers: () => void;
  onShowSettings: () => void;
  onToggleTheme: () => void;
  scanning: boolean;
  theme: "dark" | "light";
  managerCount?: number;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationId = useId();
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const activeLabel = [...observeViews, ...maintainViews, ...extensionViews]
    .find((view) => view.id === activeView)?.label ?? "设置";
  const handlers: Record<ViewId, () => void> = {
    health: onShowHealth,
    history: onShowHistory,
    managers: onShowManagers,
    cleanup: onShowProjectCleanup,
    vscode: onShowVscodeStorage,
    sessions: onShowSessionRecords,
    plugins: onShowCodexPlugins,
    claude: onShowClaudeCode,
    settings: onShowSettings,
  };
  const renderViews = (views: typeof observeViews) => views.map((view) => {
    const Icon = view.icon;
    const current = activeView === view.id;
    return (
      <button
        aria-current={current ? "page" : undefined}
        className="studio-nav-item"
        key={view.id}
        onClick={handlers[view.id]}
        type="button"
      >
        <Icon aria-hidden="true" weight={current ? "fill" : "regular"} />
        <span>{view.label}</span>
      </button>
    );
  });

  return (
    <div className="studio-shell">
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <header className="studio-topbar" data-tauri-drag-region="deep">
        {search}
        <div className="studio-top-actions">
          <p className="studio-online" data-scanning={scanning}>
            {scanning ? "扫描中" : "按需扫描"}
          </p>
          <div aria-label="主题" className="studio-theme" role="group">
            <button
              aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
              onClick={onToggleTheme}
              title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
              type="button"
            >
              {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      <div className="studio-body">
        <aside
          className="studio-sidebar"
          onKeyDown={(event) => {
            if (navigationOpen && event.key === "Escape") {
              setNavigationOpen(false);
              navigationToggle.current?.focus();
            }
          }}
        >
          <div className="studio-brand">
            <span aria-hidden="true" className="studio-logo">
              cu
            </span>
            <span className="studio-brand-name">Clean Up</span>
          </div>
          <Button
            aria-controls={navigationId}
            aria-expanded={navigationOpen}
            aria-label={`页面导航，当前：${activeLabel}`}
            className="studio-nav-toggle"
            onClick={() => setNavigationOpen((open) => !open)}
            ref={navigationToggle}
            type="button"
            variant="outline"
          >
            <span>{activeLabel}</span>
            <span className="studio-nav-toggle-hint">切换页面</span>
            <CaretDown aria-hidden="true" />
          </Button>
          <nav
            aria-label="主导航"
            className="studio-nav"
            data-expanded={navigationOpen}
            id={navigationId}
            onClick={() => {
              setNavigationOpen(false);
              if (navigationOpen) navigationToggle.current?.focus();
            }}
          >
            <div className="studio-nav-group">
              <p className="studio-nav-label">观察</p>
              {renderViews(observeViews)}
            </div>
            <div className="studio-nav-group">
              <p className="studio-nav-label">维护</p>
              {renderViews(maintainViews)}
            </div>
            <div className="studio-nav-group">
              <p className="studio-nav-label">扩展</p>
              {renderViews(extensionViews)}
            </div>
            <div className="studio-nav-group studio-nav-foot">
              {renderViews([{ id: "settings", label: "设置", icon: Settings }])}
            </div>
          </nav>
        </aside>
        <div className="studio-main" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
