import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { buildDevelopmentHealthSummary } from "./developmentHealth";
import { usePackageManagers } from "./hooks/usePackageManagers";
import { useProjectCleanup } from "./hooks/useProjectCleanup";
import { useSessionRecords } from "./hooks/useSessionRecords";
import { useCodexWorkflow } from "./hooks/useCodexWorkflow";
import { CodexSkillsPage } from "./components/CodexSkillsPage";
import { useClaudeWorkflow } from "./hooks/useClaudeWorkflow";
import { ClaudeCodePage } from "./components/ClaudeCodePage";
import { CodexMarketplacesPage } from "./components/CodexMarketplacesPage";
import { CodexHooksPage } from "./components/CodexHooksPage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useVscodeStorage } from "./hooks/useVscodeStorage";
import { SessionRecordsPage } from "./components/SessionRecordsPage";
import { VscodeStoragePage } from "./components/VscodeStoragePage";
import { ProjectCleanupPage } from "./components/ProjectCleanupPage";
import { OverviewDashboard } from "./components/OverviewDashboard";
import { ManagerTabs } from "./components/ManagerTabs";
import { MaintenanceConfirmationBanner } from "./components/MaintenanceConfirmationBanner";
import { MessageBanner } from "./components/MessageBanner";
import { PackageTable } from "./components/PackageTable";
import { PathPanel } from "./components/PathPanel";
import { SettingsPage } from "./components/SettingsPage";
import { Shell } from "./components/Shell";
import { ManagerDiagnostics } from "./components/ManagerDiagnostics";
import { scanStateLabel } from "./managerScanning";
import { Button } from "../components/ui/button";
import { Panel } from "./components/ui";
import { Toaster } from "../components/ui/sonner";

type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "pkg-control-theme";

function initialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "dark" || savedTheme === "light") {
      return savedTheme;
    }
  } catch {
    // Storage can be unavailable in restricted webviews.
  }

  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function App() {
  const state = usePackageManagers();
  const projectCleanup = useProjectCleanup();
  const [activeView, setActiveView] = useState<"health" | "managers" | "cleanup" | "vscode" | "sessions" | "plugins" | "claude" | "settings">("health");
  const [claudeTab, setClaudeTab] = useState("marketplaces");
  const claude = useClaudeWorkflow(activeView === "claude", claudeTab);
  const [codexTab, setCodexTab] = useState("marketplaces");
  const [focusedPluginId, setFocusedPluginId] = useState<string | undefined>();
  const codex = useCodexWorkflow(activeView === "plugins", codexTab);
  const vscodeStorage = useVscodeStorage(activeView === "vscode");
  const sessionRecords = useSessionRecords(activeView === "sessions");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const { actions, currentManager, scanningManagers, selectedManager } = state;
  const scanning = scanningManagers.has(selectedManager);
  const developmentHealth = useMemo(
    () => buildDevelopmentHealthSummary(state.enabledManagers, state.managerSnapshots),
    [state.enabledManagers, state.managerSnapshots],
  );

  useLayoutEffect(() => {
    const root = document.documentElement;
    const themeColor = theme === "dark" ? "#101722" : "#e7eef8";

    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The selected theme still applies for the current session.
    }

    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme))
        .catch(() => {
          // The page theme still applies when the native window theme cannot be set.
        });
    }
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        actions.closePackageActions();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actions]);

  return (
    <Shell
      activeView={activeView}
      managerCount={state.enabledManagers.length}
      managerSnapshots={state.managerSnapshots}
      onShowProjectCleanup={() => {
        actions.closePackageActions();
        setActiveView("cleanup");
      }}
      onShowVscodeStorage={() => {
        actions.closePackageActions();
        setActiveView("vscode");
      }}
      onShowSessionRecords={() => {
        actions.closePackageActions();
        setActiveView("sessions");
      }}
      onShowCodexPlugins={() => {
        actions.closePackageActions();
        setActiveView("plugins");
      }}
      onShowClaudeCode={() => {
        actions.closePackageActions();
        setActiveView("claude");
      }}
      onShowHealth={() => {
        actions.closePackageActions();
        setActiveView("health");
      }}
      onShowManagers={() => setActiveView("managers")}
      onShowSettings={() => {
        actions.closePackageActions();
        setActiveView("settings");
      }}
      onToggleTheme={() => setTheme((currentTheme) => currentTheme === "dark" ? "light" : "dark")}
      scanning={scanningManagers.size > 0}
      theme={theme}
    >
      <MessageBanner homeDirectory={state.homeDirectory} message={state.uiMessage} />
      <MaintenanceConfirmationBanner
        operation={state.maintenance}
        onCancel={actions.cancelMaintenance}
        onConfirm={() => void actions.confirmMaintenance()}
        onRetryVerification={() => void actions.retryVerification()}
      />
      <div className="telemetry-view-stage" data-view={activeView} key={activeView}>
        {activeView === "plugins" ? (
          <Tabs value={codexTab} onValueChange={setCodexTab} role="main" aria-label="Codex 管理">
            <TabsList aria-label="Codex 管理视图">
              <TabsTrigger value="marketplaces" disabled={codex.locked}>插件市场</TabsTrigger>
              <TabsTrigger value="hooks" disabled={codex.locked}>Hooks</TabsTrigger>
              <TabsTrigger value="skills" disabled={codex.locked}>Skills</TabsTrigger>
            </TabsList>
            <TabsContent value="marketplaces">
              <CodexMarketplacesPage workflow={codex.extensions} focusedPluginId={focusedPluginId} onShowHooks={() => setCodexTab("hooks")} />
            </TabsContent>
            <TabsContent value="hooks">
              <CodexHooksPage workflow={codex.extensions} onShowPlugins={() => setCodexTab("marketplaces")} />
            </TabsContent>
            <TabsContent value="skills">
              <CodexSkillsPage workflow={codex.skills} onShowPlugins={(pluginId) => { setFocusedPluginId(pluginId); setCodexTab("marketplaces"); }} />
            </TabsContent>
          </Tabs>
        ) : activeView === "claude" ? (
          <ClaudeCodePage workflow={claude} tab={claudeTab} onTabChange={setClaudeTab} />
        ) : activeView === "sessions" ? (
          <SessionRecordsPage
            error={sessionRecords.error}
            homeDirectory={state.homeDirectory}
            onRefresh={(source) => void sessionRecords.refresh(source)}
            onRemove={sessionRecords.removeOne}
            onRemoveOlder={sessionRecords.removeOlder}
            onRemoveSelected={sessionRecords.removeSelected}
            scan={sessionRecords.scan}
            scanningSources={sessionRecords.scanningSources}
          />
        ) : activeView === "vscode" ? (
          <VscodeStoragePage
            error={vscodeStorage.error}
            homeDirectory={state.homeDirectory}
            onRefresh={() => void vscodeStorage.refresh()}
            scan={vscodeStorage.scan}
            scanning={vscodeStorage.scanning}
          />
        ) : activeView === "cleanup" ? (
          <ProjectCleanupPage
            homeDirectory={state.homeDirectory}
            view={projectCleanup.view}
            workflow={projectCleanup.workflow}
          />
        ) : activeView === "settings" ? (
          <SettingsPage
            lockedManager={state.lockedManager}
            enabledManagers={state.enabledManagers}
            managerSnapshots={state.managerSnapshots}
            onSetManagerEnabled={actions.setManagerEnabled}
            scanningManagers={state.scanningManagers}
          />
        ) : activeView === "health" ? (
          <OverviewDashboard
            health={developmentHealth}
            homeDirectory={state.homeDirectory}
            managerSnapshots={state.managerSnapshots}
            scanStates={state.scanStates}
            scanningAll={state.scanningAll}
            maintenanceBusy={state.maintenanceBusy}
            onRefreshAll={() => void actions.refreshEnabled()}
            onOpenManager={(managerId) => {
              actions.closePackageActions();
              actions.selectManager(managerId);
              setActiveView("managers");
            }}
            onOpenView={setActiveView}
          />
        ) : (
          <ManagerTabs
            managerIds={state.enabledManagers}
            managerSnapshots={state.managerSnapshots}
            onSelect={actions.selectManager}
            scanningManagers={state.scanningManagers}
            selectedManager={selectedManager}
          >
            <div className="mb-3 mt-2 flex flex-wrap items-center justify-between gap-2" aria-live="polite">
              <div className="text-xs text-muted-foreground"><p>{scanStateLabel(state.scanStates[selectedManager], currentManager ?? undefined)}{state.scanStates[selectedManager]?.scannedAt ? ` · 数据时间 ${new Date(state.scanStates[selectedManager]!.scannedAt!).toLocaleString()}` : ""}</p><p>{state.scanMeta}</p></div>
              <Button variant="outline" type="button" disabled={scanning || state.maintenanceBusy} onClick={() => void actions.refresh()}>刷新当前管理器</Button>
            </div>
            <main className="view-grid min-[1100px]:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.7fr)] min-[1100px]:items-start">
              <Panel className="overflow-hidden">
                <PackageTable
                  key={selectedManager}
                  homeDirectory={state.homeDirectory}
                  manager={currentManager}
                  menuOpenIndex={state.openPackageActionMenuIndex}
                  onCopyPath={(path) => void actions.copyPath(path)}
                  onCopyPackage={(index) => void actions.copyPackage(index)}
                  onCopyPackageAction={(index, actionIndex) => void actions.copyPackageAction(index, actionIndex)}
                  onHomebrewFilter={actions.setHomebrewFilter}
                  onMavenFilter={actions.setMavenFilter}
                  onOpenPath={(path) => void actions.openPath(path)}
                  onOpenPackage={(index) => void actions.openPackage(index)}
                  onPipFilter={actions.setPipFilter}
                  onRequestCacheCleanup={actions.requestCacheCleanup}
                  onRequestPackageUninstall={actions.requestPackageUninstall}
                  onSelectPackage={actions.selectPackage}
                  onToggleActions={actions.togglePackageActions}
                  pendingMaintenance={state.maintenancePending}
                  scanning={scanning}
                  selectedHomebrewFilter={state.selectedHomebrewFilter}
                  selectedMavenFilter={state.selectedMavenFilter}
                  selectedPackageIndex={state.selectedPackageIndex}
                  selectedPipFilter={state.selectedPipFilter}
                />
              </Panel>

              <aside className="grid gap-2 min-[1100px]:sticky min-[1100px]:top-2">
                <ManagerDiagnostics
                  manager={currentManager} state={state.scanStates[selectedManager]}
                  homeDirectory={state.homeDirectory}
                  busy={scanning || state.maintenanceBusy}
                  onRefresh={() => void actions.refresh()}
                  onRetry={(kind) => void actions.retrySupplement(kind)}
                  onCopy={(value) => void actions.copyCommand(value)}
                />
                <PathPanel
                  homeDirectory={state.homeDirectory}
                  manager={currentManager}
                  onCopyCleanupCommand={() => void actions.copyCleanupCommand()}
                  onCopyPath={(path) => void actions.copyPath(path)}
                  onRequestCacheCleanup={actions.requestCacheCleanup}
                  onOpenPath={(path) => void actions.openPath(path)}
                  pendingMaintenance={state.maintenancePending}
                  pendingHomebrewCleanup={state.pendingHomebrewCleanup}
                  scanning={scanning}
                />
              </aside>
            </main>
          </ManagerTabs>
        )}
      </div>
      <Toaster />
    </Shell>
  );
}
