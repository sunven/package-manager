import { managerOrder, statusLabels } from "../constants";
import type { ManagerId, ManagerSnapshot } from "../types";
import { managerLabel } from "../utils/format";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";

export function ManagerTabs({
  managerSnapshots,
  onSelect,
  scanningManagers,
  selectedManager,
}: {
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  onSelect: (managerId: ManagerId) => void;
  scanningManagers: Set<ManagerId>;
  selectedManager: ManagerId;
}) {
  return (
    <Tabs
      className="mb-4"
      onValueChange={(value) => onSelect(value as ManagerId)}
      value={selectedManager}
    >
      <TabsList className="grid h-auto w-full grid-cols-6 bg-transparent p-0">
          {managerOrder.map((managerId) => {
            const manager = managerSnapshots[managerId];
            const scanning = scanningManagers.has(managerId);
            const status = scanning ? "Scanning" : manager?.status ?? "Not scanned";
            return (
              <TabsTrigger
                className="min-h-12 min-w-0 justify-between gap-2 border bg-background px-2 data-active:bg-muted"
                key={managerId}
                value={managerId}
              >
                <span className="min-w-0 truncate font-medium">{manager?.label ?? managerLabel(managerId)}</span>
                <Badge className="shrink-0" variant={status === "Failed" || status === "Missing" ? "destructive" : status === "Ready" ? "default" : "secondary"}>
                  {statusLabels[status]}
                </Badge>
              </TabsTrigger>
            );
          })}
      </TabsList>
    </Tabs>
  );
}
