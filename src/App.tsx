import { GlobalSearch } from "./components/GlobalSearch";
import { EnvironmentPanel } from "./components/ObservationTools";
import { ObservationCoveragePage } from "./components/ObservationCoveragePage";
import { HistoryPage, type HistoryRequest } from "./components/HistoryPage";
import { useObservationTools } from "./hooks/useObservationTools";
import { locateSearchTarget, type SearchTarget } from "./globalSearch";
import { toast } from "sonner";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildDevelopmentHealthSummary } from "./developmentHealth";
import { usePackageManagers } from "./hooks/usePackageManagers";
import { useProjectCleanup } from "./hooks/useProjectCleanup";
import { useSessionRecords } from "./hooks/useSessionRecords";
import { useOpenCodeSessions } from "./hooks/useOpenCodeSessions";
import { useCodexWorkflow } from "./hooks/useCodexWorkflow";
import { CodexSkillsPage } from "./components/CodexSkillsPage";
import { useClaudeWorkflow } from "./hooks/useClaudeWorkflow";
import { ClaudeCodePage } from "./components/ClaudeCodePage";
import { CodexMarketplacesPage } from "./components/CodexMarketplacesPage";
import { CodexHooksPage } from "./components/CodexHooksPage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useVscodeStorage } from "./hooks/useVscodeStorage";
import { useObservationLedger } from "./hooks/useObservationLedger";
import { useObservationScopes } from "./hooks/useObservationScopes";
import { managerOrder } from "./constants";
import {
  claudeObservationFacts,
  codexObservationFacts,
  environmentObservationFacts,
  managerObservationFacts,
  openCodeObservationFacts,
  projectObservationFacts,
  sessionObservationFacts,
  vscodeObservationFacts,
  type ObservationFactsMap,
} from "./observationFacts";
import {
  buildObservationCoverage,
  indexObservationCoverage,
  requireCoverageItem,
  type ObservationCoverageItem,
} from "./observationCoverage";
import { managerObservationId } from "./observationItems";
import { ManagerObservationHeader } from "./components/ManagerObservationHeader";
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
import { Panel } from "./components/ui";
import { Toaster } from "../components/ui/sonner";
import { AppUpdateToast, appUpdateToastId } from "./components/AppUpdateToast";
import { useAppUpdate } from "./hooks/useAppUpdate";

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
  const appUpdate = useAppUpdate();
  const projectCleanup = useProjectCleanup();
  const [activeView, setActiveView] = useState<"health" | "history" | "managers" | "cleanup" | "vscode" | "sessions" | "plugins" | "claude" | "settings">("health");
  const [overviewTab, setOverviewTab] = useState("overview");
  const [historyRequest, setHistoryRequest] = useState<HistoryRequest | null>(null);
  const observations = useObservationTools(activeView === "health" && overviewTab === "environment" ? "environment" : null, state.enabledManagers, state.historyRevision);
  const [searchFocus, setSearchFocus] = useState<(SearchTarget & { sequence: number }) | null>(null);
  const focusSequence = useRef(0);
  const locatedSequence = useRef(0);
  const [claudeTab, setClaudeTab] = useState("marketplaces");
  const claude = useClaudeWorkflow(activeView === "claude", claudeTab);
  const [codexTab, setCodexTab] = useState("marketplaces");
  const [focusedPluginId, setFocusedPluginId] = useState<string | undefined>();
  const codex = useCodexWorkflow(activeView === "plugins", codexTab);
  const vscodeStorage = useVscodeStorage(activeView === "vscode");
  const sessionRecords = useSessionRecords(activeView === "sessions");
  const openCodeSessions = useOpenCodeSessions(activeView === "sessions");
  const observationLedger = useObservationLedger();
  const observationScopes = useObservationScopes(state.enabledManagers);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const { actions, currentManager, scanningManagers, selectedManager } = state;
  const scanning = scanningManagers.has(selectedManager);
  const developmentHealth = useMemo(
    () => buildDevelopmentHealthSummary(state.enabledManagers, state.managerSnapshots),
    [state.enabledManagers, state.managerSnapshots],
  );
  const coverageFacts = useMemo<ObservationFactsMap>(() => {
    const facts: ObservationFactsMap = {};
    for (const manager of managerOrder) {
      facts[managerObservationId(manager)] = managerObservationFacts(
        state.managerSnapshots[manager],
        state.scanStates[manager],
      );
    }
    facts.environment = environmentObservationFacts(
      observations.environment,
      observations.environmentBusy,
      observations.environmentError,
    );
    facts["project-scan"] = projectObservationFacts(projectCleanup.view);
    facts["vscode-storage"] = vscodeObservationFacts(
      vscodeStorage.scan,
      vscodeStorage.scanning,
      vscodeStorage.error,
    );
    facts["session:codex"] = sessionObservationFacts(
      "codex",
      sessionRecords.scan?.codex ?? null,
      sessionRecords.scanningSources.codex,
      sessionRecords.error,
    );
    facts["session:claude"] = sessionObservationFacts(
      "claude",
      sessionRecords.scan?.claude ?? null,
      sessionRecords.scanningSources.claude,
      sessionRecords.error,
    );
    facts["session:opencode"] = openCodeObservationFacts(
      openCodeSessions.scan,
      openCodeSessions.scanning,
      openCodeSessions.error,
    );
    facts["codex:marketplaces"] = codexObservationFacts("marketplaces", codex.extensions.marketplaces);
    facts["codex:plugins"] = codexObservationFacts("plugins", codex.extensions.plugins);
    facts["codex:hooks"] = codexObservationFacts("hooks", codex.extensions.hooks);
    facts["codex:skills"] = codexObservationFacts("skills", codex.skills);
    facts["claude:extensions"] = claudeObservationFacts("extensions", claude.state.extensionsView);
    facts["claude:hooks"] = claudeObservationFacts("hooks", claude.state.hooksView);
    facts["claude:skills"] = claudeObservationFacts("skills", claude.skills);
    return facts;
  }, [
    state.managerSnapshots, state.scanStates,
    observations.environment, observations.environmentBusy, observations.environmentError,
    projectCleanup.view,
    vscodeStorage.scan, vscodeStorage.scanning, vscodeStorage.error,
    sessionRecords.scan, sessionRecords.scanningSources.codex, sessionRecords.scanningSources.claude, sessionRecords.error,
    openCodeSessions.scan, openCodeSessions.scanning, openCodeSessions.error,
    codex.extensions.marketplaces, codex.extensions.plugins, codex.extensions.hooks, codex.skills,
    claude.state.extensionsView, claude.state.hooksView, claude.skills,
  ]);
  const coverage = useMemo(() => buildObservationCoverage({
    records: observationLedger.records,
    facts: coverageFacts,
    scopes: observationScopes.scopes,
    enabledManagers: state.enabledManagers,
  }), [observationLedger.records, coverageFacts, observationScopes.scopes, state.enabledManagers]);
  const coverageById = useMemo(
    () => indexObservationCoverage(coverage),
    [coverage],
  );
  const coverageWarnings = useMemo(() => [
    ...observationLedger.warnings,
    ...(observationScopes.error ? [`观察范围无法读取：${observationScopes.error}`] : []),
  ], [observationLedger.warnings, observationScopes.error]);
  const coverageBusy = state.maintenanceBusy
    || state.scanningAll
    || codex.locked
    || claude.locked
    || Boolean(vscodeStorage.operation)
    || Boolean(sessionRecords.operation)
    || Boolean(openCodeSessions.operation)
    || Boolean(projectCleanup.view.batch);

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

  const updatePromptVersion = appUpdate.view.promptVersion;
  const dismissUpdatePrompt = appUpdate.dismissPrompt;

  useEffect(() => {
    if (!updatePromptVersion) {
      toast.dismiss(appUpdateToastId);
      return;
    }
    toast.custom(
      (toastId) => (
        <AppUpdateToast
          onClose={() => {
            dismissUpdatePrompt();
            toast.dismiss(toastId);
          }}
          onView={() => {
            dismissUpdatePrompt();
            toast.dismiss(toastId);
            setActiveView("settings");
          }}
          version={updatePromptVersion}
        />
      ),
      { duration: Infinity, id: appUpdateToastId, unstyled: true },
    );
  }, [dismissUpdatePrompt, updatePromptVersion]);

  function showHistoryRecord(recordId: string) {
    actions.closePackageActions();
    setHistoryRequest({ recordId });
    setActiveView("history");
  }

  function locate(target: SearchTarget) {
    if (!state.enabledManagers.includes(target.managerId) || locateSearchTarget(target, state.managerSnapshots[target.managerId]) < 0) {
      toast.warning("条目已变化，请重新搜索或刷新对应管理器。");
      return;
    }
    actions.closePackageActions();
    actions.setHomebrewFilter("All"); actions.setMavenFilter("All"); actions.setPipFilter("All");
    actions.selectManager(target.managerId);
    setSearchFocus({ ...target, sequence: ++focusSequence.current });
    setActiveView("managers");
  }

  function showCoverageItem(item: ObservationCoverageItem) {
    actions.closePackageActions();
    switch (item.id) {
      case "environment":
        setOverviewTab("environment");
        return;
      case "project-scan":
        setActiveView("cleanup");
        return;
      case "vscode-storage":
        setActiveView("vscode");
        return;
      case "session:codex":
      case "session:claude":
      case "session:opencode":
        setActiveView("sessions");
        return;
      case "codex:marketplaces":
      case "codex:plugins":
        setCodexTab("marketplaces");
        setActiveView("plugins");
        return;
      case "codex:hooks":
        setCodexTab("hooks");
        setActiveView("plugins");
        return;
      case "codex:skills":
        setCodexTab("skills");
        setActiveView("plugins");
        return;
      case "claude:extensions":
        setClaudeTab("marketplaces");
        setActiveView("claude");
        return;
      case "claude:hooks":
        setClaudeTab("hooks");
        setActiveView("claude");
        return;
      case "claude:skills":
        setClaudeTab("skills");
        setActiveView("claude");
        return;
      default: {
        const manager = managerOrder.find((candidate) => managerObservationId(candidate) === item.id);
        if (manager) {
          actions.selectManager(manager);
          setActiveView("managers");
        }
      }
    }
  }

  function adjustCoverageItem(item: ObservationCoverageItem) {
    actions.closePackageActions();
    if (item.group === "managers") setActiveView("settings");
    if (item.id === "project-scan") setActiveView("cleanup");
  }

  async function refreshCoverageItem(item: ObservationCoverageItem) {
    switch (item.id) {
      case "environment": await observations.refreshEnvironment(); return;
      case "vscode-storage": await vscodeStorage.refresh(); return;
      case "session:codex": await sessionRecords.refresh("codex"); return;
      case "session:claude": await sessionRecords.refresh("claude"); return;
      case "session:opencode": await openCodeSessions.refresh(); return;
      case "codex:marketplaces": await codex.extensions.readMarketplaces(); return;
      case "codex:plugins": await codex.extensions.readPlugins(); return;
      case "codex:hooks": await codex.extensions.readHooks(); return;
      case "codex:skills": await codex.skills.refresh(); return;
      case "claude:extensions": await claude.state.refresh("marketplaces"); return;
      case "claude:hooks": await claude.state.refresh("hooks"); return;
      case "claude:skills": await claude.skills.refresh(); return;
    }
  }

  useEffect(() => {
    if (!searchFocus || searchFocus.sequence === locatedSequence.current || activeView !== "managers" || selectedManager !== searchFocus.managerId) return;
    let element: HTMLElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const index = locateSearchTarget(searchFocus, currentManager ?? undefined);
      const attribute = searchFocus.kind === "package" ? "data-package-observation" : "data-path-observation";
      element = Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`)).find((node) => node.getAttribute(attribute) === searchFocus.observationId);
      locatedSequence.current = searchFocus.sequence;
      if (index < 0 || !element) { toast.warning("条目已变化，请重新搜索。"); return; }
      if (searchFocus.kind === "package") actions.selectPackage(index);
      element.scrollIntoView?.({ block: "center", inline: "nearest" });
      (searchFocus.kind === "package" ? element.querySelector<HTMLElement>("button") : element)?.focus({ preventScroll: true });
      element.classList.add("observation-located");
      timer = setTimeout(() => element?.classList.remove("observation-located"), 1800);
    });
    return () => { cancelAnimationFrame(frame); if (timer) clearTimeout(timer); element?.classList.remove("observation-located"); };
  }, [searchFocus, activeView, selectedManager, currentManager]);

  return (
    <Shell
      search={<GlobalSearch managers={state.enabledManagers} snapshots={state.managerSnapshots} scanStates={state.scanStates} homeDirectory={state.homeDirectory} busy={state.maintenanceBusy || state.scanningAll} onRefresh={() => void actions.refreshEnabled()} onLocate={locate} />}
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
      onShowHistory={() => {
        actions.closePackageActions();
        setActiveView("history");
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
      {state.historyWarning ? <Alert className="mb-3"><AlertTitle>历史保存提示</AlertTitle><AlertDescription className="break-words">{state.historyWarning}</AlertDescription></Alert> : null}
      <MessageBanner homeDirectory={state.homeDirectory} message={state.uiMessage} />
      <MaintenanceConfirmationBanner
        operation={state.maintenance}
        onCancel={actions.cancelMaintenance}
        onConfirm={() => void actions.confirmMaintenance()}
        onRetryVerification={() => void actions.retryVerification()}
        onShowHistory={showHistoryRecord}
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
              <CodexMarketplacesPage
                coverage={{
                  marketplaces: requireCoverageItem(coverageById, "codex:marketplaces"),
                  plugins: requireCoverageItem(coverageById, "codex:plugins"),
                }}
                focusedPluginId={focusedPluginId}
                onShowHooks={() => setCodexTab("hooks")}
                workflow={codex.extensions}
              />
            </TabsContent>
            <TabsContent value="hooks">
              <CodexHooksPage
                coverageItem={requireCoverageItem(coverageById, "codex:hooks")}
                onShowPlugins={() => setCodexTab("marketplaces")}
                workflow={codex.extensions}
              />
            </TabsContent>
            <TabsContent value="skills">
              <CodexSkillsPage
                coverageItem={requireCoverageItem(coverageById, "codex:skills")}
                onShowPlugins={(pluginId) => { setFocusedPluginId(pluginId); setCodexTab("marketplaces"); }}
                workflow={codex.skills}
              />
            </TabsContent>
          </Tabs>
        ) : activeView === "claude" ? (
          <ClaudeCodePage
            coverage={{
              extensions: requireCoverageItem(coverageById, "claude:extensions"),
              hooks: requireCoverageItem(coverageById, "claude:hooks"),
              skills: requireCoverageItem(coverageById, "claude:skills"),
            }}
            onTabChange={setClaudeTab}
            tab={claudeTab}
            workflow={claude}
          />
        ) : activeView === "sessions" ? (
          <SessionRecordsPage
            homeDirectory={state.homeDirectory}
            records={sessionRecords}
            openCode={openCodeSessions}
            coverageItems={{
              codex: requireCoverageItem(coverageById, "session:codex"),
              claude: requireCoverageItem(coverageById, "session:claude"),
              opencode: requireCoverageItem(coverageById, "session:opencode"),
            }}
            onShowHistory={showHistoryRecord}
          />
        ) : activeView === "vscode" ? (
          <VscodeStoragePage
            homeDirectory={state.homeDirectory}
            workflow={vscodeStorage}
            coverageItem={requireCoverageItem(coverageById, "vscode-storage")}
            onShowHistory={showHistoryRecord}
          />
        ) : activeView === "cleanup" ? (
          <ProjectCleanupPage
            coverageItem={requireCoverageItem(coverageById, "project-scan")}
            homeDirectory={state.homeDirectory}
            view={projectCleanup.view}
            workflow={projectCleanup.workflow}
            onShowHistory={showHistoryRecord}
          />
        ) : activeView === "history" ? (
          <HistoryPage
            active={activeView === "history"}
            managers={state.enabledManagers}
            historyRevision={state.historyRevision}
            homeDirectory={state.homeDirectory}
            request={historyRequest}
            onRequestConsumed={() => setHistoryRequest(null)}
            onOpenDomain={(domain) => {
              actions.closePackageActions();
              setActiveView(domain === "manager" ? "managers" : domain === "projectCleanup" ? "cleanup" : domain === "vscodeStorage" ? "vscode" : "sessions");
            }}
          />
        ) : activeView === "settings" ? (
          <SettingsPage
            appUpdate={{
              view: appUpdate.view,
              onCheck: appUpdate.checkForUpdate,
              onDownload: appUpdate.downloadAndInstall,
              onSkip: () => {
                toast.dismiss(appUpdateToastId);
                appUpdate.skipVersion();
              },
            }}
            lockedManager={state.lockedManager}
            enabledManagers={state.enabledManagers}
            managerSnapshots={state.managerSnapshots}
            onSetManagerEnabled={actions.setManagerEnabled}
            scanningManagers={state.scanningManagers}
          />
        ) : activeView === "health" ? (
          <Tabs value={overviewTab} onValueChange={setOverviewTab}>
            <TabsList aria-label="总览视图"><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="environment">环境诊断</TabsTrigger><TabsTrigger value="coverage">观察覆盖度</TabsTrigger></TabsList>
            <TabsContent value="environment"><EnvironmentPanel
              state={observations}
              enabledManagers={state.enabledManagers}
              managerSnapshots={state.managerSnapshots}
              scanStates={state.scanStates}
              ledgerRecords={observationLedger.records}
              onCopy={(value) => void actions.copyPath(value)}
              onOpenManager={(manager) => { actions.selectManager(manager); setActiveView("managers"); }}
            /></TabsContent>
            <TabsContent value="overview">
          <OverviewDashboard
            health={developmentHealth}
            coverage={coverage}
            homeDirectory={state.homeDirectory}
            scanningAll={state.scanningAll}
            maintenanceBusy={state.maintenanceBusy}
            onRefreshAll={() => void actions.refreshEnabled()}
            onOpenManager={(managerId) => {
              actions.closePackageActions();
              actions.selectManager(managerId);
              setActiveView("managers");
            }}
            onOpenView={setActiveView}
            onOpenCoverage={() => setOverviewTab("coverage")}
          />
            </TabsContent>
            <TabsContent value="coverage">
              <ObservationCoveragePage
                coverage={coverage}
                warnings={coverageWarnings}
                busy={coverageBusy}
                onView={showCoverageItem}
                onRefresh={(item) => { void refreshCoverageItem(item); }}
                onRefreshManagers={() => void actions.refreshEnabled()}
                onAdjustScope={adjustCoverageItem}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <ManagerTabs
            coverageIndex={coverageById}
            managerIds={state.enabledManagers}
            managerSnapshots={state.managerSnapshots}
            onSelect={actions.selectManager}
            scanningManagers={state.scanningManagers}
            selectedManager={selectedManager}
          >
            <ManagerObservationHeader
              busy={state.maintenanceBusy}
              item={requireCoverageItem(coverageById, managerObservationId(selectedManager))}
              onRefresh={() => void actions.refresh()}
              scanMeta={state.scanMeta}
              scanState={state.scanStates[selectedManager]}
              scanning={scanning}
            />
            <main className="view-grid min-[1100px]:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.7fr)] min-[1100px]:items-start">
              <Panel className="overflow-hidden">
                <PackageTable
                  key={`${selectedManager}:${searchFocus?.sequence ?? 0}`}
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
                  onCopy={(value) => void actions.copyCommand(value)}
                />
                <PathPanel
                  focusedPath={searchFocus?.managerId === selectedManager && searchFocus.kind === "path" ? searchFocus.observationId : undefined}
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
