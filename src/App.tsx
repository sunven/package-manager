import { useEffect } from "react";
import { managerLabels } from "./constants";
import { usePackageManagers } from "./hooks/usePackageManagers";
import { FailurePanel } from "./components/FailurePanel";
import { ManagerTabs } from "./components/ManagerTabs";
import { MessageBanner } from "./components/MessageBanner";
import { Overview } from "./components/Overview";
import { PackageTable } from "./components/PackageTable";
import { PathPanel } from "./components/PathPanel";
import { Shell } from "./components/Shell";
import { Panel, PanelHead, StatusBadge } from "./components/ui";

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
    <Shell onRefresh={() => void actions.refresh()} scanMeta={state.scanMeta} scanning={scanning} selectedManager={selectedManager}>
      <MessageBanner message={state.uiMessage} />
      <Overview {...state.overview} />
      <ManagerTabs
        managerSnapshots={state.managerSnapshots}
        onSelect={actions.selectManager}
        scanningManagers={state.scanningManagers}
        selectedManager={selectedManager}
      />

      <main className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(330px,0.75fr)] xl:items-start">
        <Panel className="overflow-hidden">
          <PanelHead
            action={<StatusBadge status={scanning ? "Scanning" : currentManager?.status ?? "Not scanned"} />}
            eyebrow="软件包"
            title={currentManager ? `${currentManager.label}${currentManager.version ? ` ${currentManager.version}` : ""}` : managerLabels[selectedManager]}
          />
          <PackageTable
            manager={currentManager}
            menuOpenIndex={state.openPackageActionMenuIndex}
            onCopyPackage={(index) => void actions.copyPackage(index)}
            onCopyPackageAction={(index, actionIndex) => void actions.copyPackageAction(index, actionIndex)}
            onHomebrewFilter={actions.setHomebrewFilter}
            onMavenFilter={actions.setMavenFilter}
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
          <FailurePanel manager={currentManager} scanning={scanning} />
        </aside>
      </main>
    </Shell>
  );
}
