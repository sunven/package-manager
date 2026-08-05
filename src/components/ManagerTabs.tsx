import { statusLabels } from "../constants";
import type { DisplayStatus } from "../types";
import type { ManagerId, ManagerSnapshot } from "../types";
import { managerLabel } from "../utils/format";
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
  const columnCount = Math.max(managerIds.length, 1);

  return (
    <Tabs
      onValueChange={(value) => onSelect(value as ManagerId)}
      orientation="horizontal"
      value={selectedManager}
    >
      <div className="w-full overflow-x-auto overflow-y-hidden">
        <TabsList
          className="manager-tab-grid grid h-auto bg-transparent"
          style={{
            gridTemplateColumns: `repeat(${columnCount}, minmax(92px, 1fr))`,
            minWidth: `${columnCount * 100}px`,
          }}
        >
          {managerIds.map((managerId) => {
            const manager = managerSnapshots[managerId];
            const managerName = manager?.label ?? managerLabel(managerId);
            const scanning = scanningManagers.has(managerId);
            const status = scanning ? "Scanning" : manager?.status ?? "Not scanned";
            const version = manager?.version ?? " ";
            return (
              <TabsTrigger
                className="manager-tab h-auto min-h-11 min-w-0 flex-col items-stretch justify-center gap-0.5 px-2 py-1 text-left transition-colors active:translate-y-px data-active:text-foreground"
                key={managerId}
                value={managerId}
              >
                <span className="flex min-w-0 items-center justify-between gap-1.5 text-xs leading-4">
                  <span className="min-w-0 truncate font-medium">{managerName}</span>
                  <StatusDot status={status} />
                </span>
                <span className="min-w-0 truncate text-[10px] leading-3 text-muted-foreground tabular-nums" title={manager?.version ?? undefined}>
                  {version}
                </span>
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
      aria-label={statusLabels[status]}
      className={`status-dot size-2.5 shrink-0 ${className}`}
      title={statusLabels[status]}
    />
  );
}
