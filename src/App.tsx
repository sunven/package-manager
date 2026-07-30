import { useEffect, useMemo, useState } from "react";
import { buildDevelopmentHealthSummary } from "./developmentHealth";
import { usePackageManagers } from "./hooks/usePackageManagers";
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

export function App() {
  const state = usePackageManagers();
  const [activeView, setActiveView] = useState<"health" | "managers" | "settings">("health");
  const { actions, currentManager, scanningManagers, selectedManager } = state;
  const scanning = scanningManagers.has(selectedManager);
  const developmentHealth = useMemo(
    () => buildDevelopmentHealthSummary(state.enabledManagers, state.managerSnapshots),
    [state.enabledManagers, state.managerSnapshots],
  );

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
      onShowHealth={() => {
        actions.closePackageActions();
        setActiveView("health");
      }}
      onShowManagers={() => setActiveView("managers")}
      onShowSettings={() => {
        actions.closePackageActions();
        setActiveView("settings");
      }}
      scanMeta={state.scanMeta}
      scanning={scanning}
      selectedManager={selectedManager}
      totalBytes={state.overview.totalBytes}
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
      {activeView === "settings" ? (
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

          <main className="mt-5 grid gap-4">
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

            <aside className="grid gap-4">
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
      <Toaster />
    </Shell>
  );
}
