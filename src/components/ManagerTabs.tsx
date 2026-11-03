import type { ReactNode } from "react";
import type { DisplayStatus } from "../types";
import type { ManagerId, ManagerSnapshot } from "../types";
import { managerLabel } from "../utils/format";
import { requireCoverageItem, type CoverageStatus, type ObservationCoverageIndex } from "../observationCoverage";
import { managerObservationId } from "../observationItems";
import { managerTabPresentation } from "../managerObservationPresentation";
import { ManagerMark } from "./OverviewDashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

export function ManagerTabs({
  children,
  managerIds,
  managerSnapshots,
  coverageIndex,
  onSelect,
  scanningManagers,
  selectedManager,
}: {
  children: ReactNode;
  managerIds: ManagerId[];
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  coverageIndex: ObservationCoverageIndex;
  onSelect: (managerId: ManagerId) => void;
  scanningManagers: Set<ManagerId>;
  selectedManager: ManagerId;
}) {
  if (!managerIds.length) return <>{children}</>;

  return (
    <Tabs
      className="studio-manager-layout"
      onValueChange={(value) => onSelect(value as ManagerId)}
      orientation="vertical"
      value={selectedManager}
    >
      <aside aria-label="管理器切换" className="studio-manager-menu">
        <TabsList aria-label="包管理器" className="studio-manager-tabs">
          {managerIds.map((managerId) => {
            const manager = managerSnapshots[managerId];
            const managerName = manager?.label ?? managerLabel(managerId);
            const scanning = scanningManagers.has(managerId);
            const presentation = managerTabPresentation(
              requireCoverageItem(coverageIndex, managerObservationId(managerId)),
              { managerName, snapshot: manager, scanning },
            );
            const version = manager?.version?.trim() || presentation.label;
            return (
              <TabsTrigger className="studio-manager-tab" key={managerId} value={managerId}>
                <ManagerMark id={managerId} />
                <span className="studio-manager-tab-copy">
                  <strong>{managerName}</strong>
                  <small>{version}</small>
                </span>
                <StatusDot
                  dataObservationStatus={presentation.observationStatus}
                  label={presentation.label}
                  status={presentation.status}
                  title={presentation.title}
                />
              </TabsTrigger>
            );
          })}
        </TabsList>
      </aside>
      {managerIds.map((managerId) => (
        <TabsContent className="studio-manager-content" key={managerId} value={managerId}>
          {managerId === selectedManager ? children : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function StatusDot({
  status,
  label,
  title,
  dataObservationStatus,
}: {
  status: DisplayStatus;
  label: string;
  title: string;
  dataObservationStatus: CoverageStatus;
}) {
  return (
    <span
      aria-label={label}
      className="status-dot size-2.5 shrink-0"
      data-observation-status={dataObservationStatus}
      data-status={status}
      role="img"
      title={title}
    />
  );
}
