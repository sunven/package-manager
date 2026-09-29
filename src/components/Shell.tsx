import {
  Chats as MessagesSquare,
  Code as Code2,
  Cube,
  Gear as Settings,
  House,
  Moon,
  Package,
  Sun,
  Trash as Trash2,
} from "@phosphor-icons/react";
import type { ManagerId, ManagerSnapshot } from "../types";

type ViewId = "health" | "managers" | "cleanup" | "vscode" | "sessions" | "settings";

const views: { id: ViewId; label: string; icon: typeof House }[] = [
  { id: "health", label: "总览", icon: House },
  { id: "managers", label: "包管理器", icon: Package },
  { id: "cleanup", label: "项目清理", icon: Trash2 },
  { id: "vscode", label: "VS Code 占用", icon: Code2 },
  { id: "sessions", label: "会话记录", icon: MessagesSquare },
  { id: "settings", label: "设置", icon: Settings },
];

export function Shell({
  children,
  activeView,
  onShowHealth,
  onShowProjectCleanup,
  onShowVscodeStorage,
  onShowSessionRecords,
  onShowManagers,
  onShowSettings,
  onToggleTheme,
  scanning,
  theme,
  managerCount,
  managerSnapshots,
}: {
  children: React.ReactNode;
  activeView: ViewId;
  onShowHealth: () => void;
  onShowProjectCleanup: () => void;
  onShowVscodeStorage: () => void;
  onShowSessionRecords: () => void;
  onShowManagers: () => void;
  onShowSettings: () => void;
  onToggleTheme: () => void;
  scanning: boolean;
  theme: "dark" | "light";
  managerCount: number;
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
}) {
  const handlers: Record<ViewId, () => void> = {
    health: onShowHealth,
    managers: onShowManagers,
    cleanup: onShowProjectCleanup,
    vscode: onShowVscodeStorage,
    sessions: onShowSessionRecords,
    settings: onShowSettings,
  };

  return (
    <div className="studio-shell">
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <header className="studio-topbar" data-tauri-drag-region="deep">
        <div className="studio-brand">
          <span aria-hidden="true" className="studio-logo">
            <Cube weight="fill" />
          </span>
          <div className="studio-brand-copy">
            <h1>包管理器控制中心</h1>
            <p>统一管理你的开发环境与依赖包</p>
          </div>
        </div>
        <div className="studio-top-actions">
          <div aria-label="主题" className="studio-theme" role="group">
            <button
              aria-pressed={theme === "light"}
              onClick={() => {
                if (theme !== "light") onToggleTheme();
              }}
              title="浅色主题"
              type="button"
            >
              <Sun aria-hidden="true" />
            </button>
            <button
              aria-pressed={theme === "dark"}
              onClick={() => {
                if (theme !== "dark") onToggleTheme();
              }}
              title="深色主题"
              type="button"
            >
              <Moon aria-hidden="true" />
            </button>
          </div>
          <p className="studio-online">
            <span aria-hidden="true" />
            {scanning ? "扫描中" : "已连接"}
          </p>
          <button
            aria-current={activeView === "settings" ? "page" : undefined}
            aria-label="设置"
            className="studio-icon-button"
            onClick={onShowSettings}
            title="设置"
            type="button"
          >
            <Settings aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="studio-body">
        <aside className="studio-sidebar">
          <nav aria-label="主导航" className="studio-nav">
            {views.map((view) => {
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
                  {view.id === "managers" ? <em>{managerCount}</em> : null}
                </button>
              );
            })}
          </nav>
          <section aria-label="环境信息" className="studio-env">
            <h2>环境信息</h2>
            <ul>
              {environmentRows(managerSnapshots).map((row) => (
                <li key={row.label}>
                  <span aria-hidden="true" className="studio-env-dot" data-tone={row.tone} />
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </li>
              ))}
            </ul>
          </section>
          <div aria-hidden="true" className="studio-slogan">
            <p>Better Dev<br />Better Life</p>
            <SloganMark />
          </div>
        </aside>
        <div className="studio-main" id="main-content">
          {children}
        </div>
      </div>
    </div>
  );
}

function environmentRows(snapshots: Partial<Record<ManagerId, ManagerSnapshot>>) {
  const optional = [
    fact("npm", snapshots.Npm?.version, "npm"),
    fact("Python", snapshots.Pip?.pip?.pythonVersion, "python"),
    fact("nvm", snapshots.Nvm?.version, "node"),
    fact("Maven", snapshots.Maven?.version, "maven"),
  ].flatMap((row) => (row ? [row] : []));

  return [...optional.slice(0, 3), { label: "系统", value: systemLabel(), tone: "os" }];
}

function fact(label: string, value: string | null | undefined, tone: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return { label, value: trimmed, tone };
}

function systemLabel() {
  if (typeof navigator === "undefined") return "本机";
  const ua = navigator.userAgent || "";
  if (/Mac/.test(ua)) return "macOS";
  if (/Win/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "本机";
}

function SloganMark() {
  return (
    <svg fill="none" viewBox="0 0 88 72" xmlns="http://www.w3.org/2000/svg">
      <path d="M44 8 76 26 44 44 12 26 44 8Z" fill="#d7e6ff" />
      <path d="M44 44 76 26 76 48 44 66 44 44Z" fill="#8eb4f5" />
      <path d="M12 26 44 44 44 66 12 48 12 26Z" fill="#b9d2fb" />
      <path d="M44 22 62 32 44 42 26 32 44 22Z" fill="#4d7fe8" />
    </svg>
  );
}
