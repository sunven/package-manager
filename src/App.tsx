import { useEffect } from "react";
import { usePackageManagers } from "./hooks/usePackageManagers";
import { ManagerTabs } from "./components/ManagerTabs";
import { MessageBanner } from "./components/MessageBanner";
import { PackageTable } from "./components/PackageTable";
import { PathPanel } from "./components/PathPanel";
import { Shell } from "./components/Shell";
import { Panel } from "./components/ui";

export function App() {
  const state = usePackageManagers();
  const { actions, currentManager, scanningManagers, selectedManager } = state;
  const scanning = scanningManagers.has(selectedManager);

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
      onRefresh={() => void actions.refresh()}
      scanMeta={state.scanMeta}
      scanning={scanning}
      selectedManager={selectedManager}
      totalBytes={state.overview.totalBytes}
    >
      <MessageBanner message={state.uiMessage} />
      <ManagerTabs
        managerSnapshots={state.managerSnapshots}
        onSelect={actions.selectManager}
        scanningManagers={state.scanningManagers}
        selectedManager={selectedManager}
      />

      <main className="mt-5 grid gap-4">
        <Panel className="overflow-hidden">
          <PackageTable
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
            onSelectPackage={actions.selectPackage}
            onToggleActions={actions.togglePackageActions}
            scanning={scanning}
            selectedHomebrewFilter={state.selectedHomebrewFilter}
            selectedMavenFilter={state.selectedMavenFilter}
            selectedPackageIndex={state.selectedPackageIndex}
            selectedPipFilter={state.selectedPipFilter}
          />
        </Panel>

        <aside className="grid gap-4">
          <PathPanel
            manager={currentManager}
            onCopyCleanupCommand={() => void actions.copyCleanupCommand()}
            onCopyCommand={(payload) => void actions.copyCommand(payload)}
            onCopyPath={(path) => void actions.copyPath(path)}
            onOpenPath={(path) => void actions.openPath(path)}
            pendingHomebrewCleanup={state.pendingHomebrewCleanup}
            scanning={scanning}
          />
        </aside>
      </main>
    </Shell>
  );
}
