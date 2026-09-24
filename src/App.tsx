import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { buildDevelopmentHealthSummary } from "./developmentHealth";
import { usePackageManagers } from "./hooks/usePackageManagers";
import { useProjectCleanup } from "./hooks/useProjectCleanup";
import { useSessionRecords } from "./hooks/useSessionRecords";
import { useVscodeStorage } from "./hooks/useVscodeStorage";
import { SessionRecordsPage } from "./components/SessionRecordsPage";
import { VscodeStoragePage } from "./components/VscodeStoragePage";
import { ProjectCleanupPage } from "./components/ProjectCleanupPage";
import { DevelopmentHealthPage } from "./components/DevelopmentHealthPage";
import { ManagerTabs } from "./components/ManagerTabs";
import { cleanupPreviewDetails, cleanupReclaimable } from "./cleanupCopy";
import { MaintenanceConfirmationBanner } from "./components/MaintenanceConfirmationBanner";
import { MessageBanner } from "./components/MessageBanner";
import { PackageTable } from "./components/PackageTable";
import { PathPanel } from "./components/PathPanel";
import { SettingsPage } from "./components/SettingsPage";
import { Shell } from "./components/Shell";
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
  const [activeView, setActiveView] = useState<"health" | "managers" | "cleanup" | "vscode" | "sessions" | "settings">("health");
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
    const themeColor = theme === "dark" ? "#1c1b19" : "#f7f6f3";

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
      onRefresh={() => void actions.refresh()}
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
      scanMeta={state.scanMeta}
      scanning={scanning}
      selectedManager={selectedManager}
      totalBytes={state.overview.totalBytes}
      theme={theme}
    >
      <MessageBanner homeDirectory={state.homeDirectory} message={state.uiMessage} />
      <MaintenanceConfirmationBanner
        confirmation={state.maintenanceConfirmation}
        onCancel={actions.cancelMaintenance}
        onConfirm={() => void actions.confirmMaintenance()}
        pending={state.maintenancePending}
        reclaimDetails={
          state.maintenanceConfirmation?.kind === "cleanupCache"
            ? cleanupPreviewDetails(state.managerSnapshots[state.maintenanceConfirmation.managerId])
            : null
        }
        reclaimable={
          state.maintenanceConfirmation?.kind === "cleanupCache"
            ? cleanupReclaimable(state.managerSnapshots[state.maintenanceConfirmation.managerId])
            : null
        }
        result={state.maintenanceResult}
      />
      <div className="telemetry-view-stage" data-view={activeView} key={activeView}>
        {activeView === "sessions" ? (
          <SessionRecordsPage
            error={sessionRecords.error}
            homeDirectory={state.homeDirectory}
            onRefresh={() => void sessionRecords.refresh()}
            onRemove={sessionRecords.removeOne}
            onRemoveOlder={sessionRecords.removeOlder}
            onRemoveSelected={sessionRecords.removeSelected}
            scan={sessionRecords.scan}
            scanning={sessionRecords.scanning}
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
            enabledManagers={state.enabledManagers}
            managerSnapshots={state.managerSnapshots}
            onSetManagerEnabled={actions.setManagerEnabled}
            scanningManagers={state.scanningManagers}
          />
        ) : activeView === "health" ? (
          <DevelopmentHealthPage
            health={developmentHealth}
            homeDirectory={state.homeDirectory}
            onOpenManager={(managerId) => {
              actions.closePackageActions();
              actions.selectManager(managerId);
              setActiveView("managers");
            }}
          />
        ) : (
          <>
            <ManagerTabs
              managerIds={state.enabledManagers}
              managerSnapshots={state.managerSnapshots}
              onSelect={actions.selectManager}
              scanningManagers={state.scanningManagers}
              selectedManager={selectedManager}
            />

            <main className="view-grid min-[1100px]:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.7fr)] min-[1100px]:items-start">
              <Panel className="overflow-hidden">
                <PackageTable
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
          </>
        )}
      </div>
      <Toaster />
    </Shell>
  );
}
