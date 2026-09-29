import { statusLabels } from "../constants";
import type { DisplayStatus } from "../types";
import type { ManagerId, ManagerSnapshot } from "../types";
import { managerLabel } from "../utils/format";
import { ManagerMark } from "./OverviewDashboard";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";

export function ManagerTabs({
  managerIds,
  managerSnapshots,
  onSelect,
  scanningManagers,
  selectedManager,
}: {
  managerIds: ManagerId[];
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  onSelect: (managerId: ManagerId) => void;
  scanningManagers: Set<ManagerId>;
  selectedManager: ManagerId;
}) {
  return (
    <Tabs
      onValueChange={(value) => onSelect(value as ManagerId)}
      orientation="horizontal"
      value={selectedManager}
    >
      <div className="studio-manager-scroll">
        <TabsList className="studio-manager-tabs">
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
    </Tabs>
  );
}

function StatusDot({ status }: { status: DisplayStatus }) {
  const className =
    status === "Ready"
      ? "bg-terminal"
      : status === "Failed" || status === "Missing"
        ? "bg-destructive"
        : status === "Unsupported" || status === "Partial" || status === "Scanning" || status === "Pending"
          ? "bg-muted-foreground"
          : "bg-border";

  return (
    <span
      aria-hidden="true"
      className={`status-dot size-2.5 shrink-0 ${className}`}
      title={statusLabels[status]}
    />
  );
}
