import {
  Chats as MessagesSquare,
  ClockCounterClockwise,
  Code as Code2,
  Cube,
  Gear as Settings,
  House,
  List as ListIcon,
  Moon,
  Package,
  Robot,
  Sun,
  TerminalWindow,
  Trash as Trash2,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const groups = [
    { label: "观察", views: observeViews },
    { label: "维护", views: maintainViews },
    { label: "扩展", views: extensionViews },
  ];

  const go = (id: ViewId) => {
    setMenuOpen(false);
    handlers[id]();
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
            <span aria-hidden="true" />
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
        <aside className="studio-sidebar">
          <div className="studio-brand">
            <span aria-hidden="true" className="studio-logo">
              <Cube weight="duotone" />
            </span>
            <div className="studio-brand-copy">
              <span className="studio-brand-name">包管理器控制中心</span>
              <p>本机开发环境观察台</p>
            </div>
          </div>
          <nav aria-label="主导航" className="studio-nav">
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
          <button
            className="studio-nav-item studio-nav-more"
            onClick={() => setMenuOpen(true)}
            type="button"
          >
            <ListIcon aria-hidden="true" />
            <span>全部</span>
          </button>
        </aside>
        <div className="studio-main" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </div>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="max-w-sm gap-4">
          <DialogTitle>导航</DialogTitle>
          <nav aria-label="完整导航" className="grid gap-4">
            {groups.map((group) => (
              <div className="grid gap-1" key={group.label}>
                <p className="studio-nav-label">{group.label}</p>
                {group.views.map((view) => {
                  const Icon = view.icon;
                  return (
                    <button
                      aria-current={activeView === view.id ? "page" : undefined}
                      className="studio-nav-item"
                      key={view.id}
                      onClick={() => go(view.id)}
                      type="button"
                    >
                      <Icon aria-hidden="true" weight={activeView === view.id ? "fill" : "regular"} />
                      <span>{view.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="grid gap-1 border-t pt-3">
              <button
                aria-current={activeView === "settings" ? "page" : undefined}
                className="studio-nav-item"
                onClick={() => go("settings")}
                type="button"
              >
                <Settings aria-hidden="true" weight={activeView === "settings" ? "fill" : "regular"} />
                <span>设置</span>
              </button>
            </div>
          </nav>
        </DialogContent>
      </Dialog>
    </div>
  );
}
