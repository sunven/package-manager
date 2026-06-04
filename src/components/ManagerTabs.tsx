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
      onValueChange={(value) => onSelect(value as ManagerId)}
      value={selectedManager}
    >
      <TabsList className="grid h-auto w-full grid-cols-8 gap-2 bg-transparent p-0">
        {managerOrder.map((managerId) => {
          const manager = managerSnapshots[managerId];
          const managerName = manager?.label ?? managerLabel(managerId);
          const scanning = scanningManagers.has(managerId);
          const status = scanning ? "Scanning" : manager?.status ?? "Not scanned";
          const version = manager?.version ?? " ";
          return (
            <TabsTrigger
              className="min-h-11 min-w-0 flex-col items-stretch justify-center gap-0.5 rounded-sm bg-background px-2 py-1 text-left shadow-sm ring-1 ring-border transition-all hover:bg-accent hover:text-accent-foreground hover:ring-ring active:translate-y-px data-active:shadow-md data-active:ring-2 data-active:ring-primary data-active:text-foreground"
              key={managerId}
              value={managerId}
            >
              <span className="flex min-w-0 items-center justify-between gap-1.5 text-xs leading-4">
                <span className="min-w-0 truncate font-medium">{managerName}</span>
                <Badge className="shrink-0 px-1.5 text-[10px] leading-3" variant={status === "Failed" || status === "Missing" ? "destructive" : status === "Ready" ? "default" : "secondary"}>
                  {statusLabels[status]}
                </Badge>
              </span>
              <span className="min-w-0 truncate text-[10px] leading-3 text-muted-foreground tabular-nums" title={manager?.version ?? undefined}>
                {version}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
