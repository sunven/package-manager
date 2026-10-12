import type { ReactNode } from "react";
import { statusLabels } from "../constants";
import type { DisplayStatus } from "../types";
import type { ManagerId, ManagerSnapshot } from "../types";
import { managerLabel } from "../utils/format";
import { ManagerMark } from "./OverviewDashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

export function ManagerTabs({
  children,
  managerIds,
  managerSnapshots,
  onSelect,
  scanningManagers,
  selectedManager,
}: {
  children: ReactNode;
  managerIds: ManagerId[];
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  onSelect: (managerId: ManagerId) => void;
  scanningManagers: Set<ManagerId>;
  selectedManager: ManagerId;
}) {
  if (!managerIds.length) return <>{children}</>;

  return (
    <Tabs
      onValueChange={(value) => onSelect(value as ManagerId)}
      orientation="horizontal"
      value={selectedManager}
    >
      <div className="studio-manager-scroll">
        <TabsList aria-label="包管理器" className="studio-manager-tabs">
          {managerIds.map((managerId) => {
            const manager = managerSnapshots[managerId];
            const managerName = manager?.label ?? managerLabel(managerId);
            const scanning = scanningManagers.has(managerId);
            const status = scanning ? "Scanning" : manager?.status ?? "Not scanned";
            const version = manager?.version?.trim() || statusLabels[status];
            return (
              <TabsTrigger className="studio-manager-tab" key={managerId} value={managerId}>
                <ManagerMark id={managerId} />
                <span className="studio-manager-tab-copy">
                  <strong>{managerName}</strong>
                  <small>{version}</small>
                </span>
                <StatusDot status={status} />
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      {managerIds.map((managerId) => (
        <TabsContent className="min-w-0" key={managerId} value={managerId}>
          {managerId === selectedManager ? children : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function StatusDot({ status }: { status: DisplayStatus }) {
  return (
    <span
      aria-label={statusLabels[status]}
      className="status-dot size-2.5 shrink-0"
      data-status={status}
      role="img"
      title={statusLabels[status]}
    />
  );
}
