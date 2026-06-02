import { managerOrder, statusLabels } from "../constants";
import type { ManagerId, ManagerSnapshot } from "../types";
import { managerLabel } from "../utils/format";
import { Badge } from "../../components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";

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
    <ToggleGroup
      className="mb-4 grid w-full grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6"
      onValueChange={(value) => {
        if (value) onSelect(value as ManagerId);
      }}
      type="single"
      value={selectedManager}
      variant="outline"
    >
      {managerOrder.map((managerId) => {
        const manager = managerSnapshots[managerId];
        const scanning = scanningManagers.has(managerId);
        const status = scanning ? "Scanning" : manager?.status ?? "Not scanned";
        return (
          <ToggleGroupItem
            className="min-h-12 w-full justify-between gap-3 px-3"
            key={managerId}
            value={managerId}
          >
            <span className="min-w-0 truncate font-medium">{manager?.label ?? managerLabel(managerId)}</span>
            <Badge className="shrink-0" variant={status === "Failed" || status === "Missing" ? "destructive" : status === "Ready" ? "default" : "secondary"}>
              {statusLabels[status]}
            </Badge>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
