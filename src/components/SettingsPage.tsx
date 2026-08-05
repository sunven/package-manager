import { managerLabels, managerOrder } from "../constants";
import type { DisplayStatus, ManagerId, ManagerSnapshot } from "../types";
import { Checkbox } from "../../components/ui/checkbox";
import { Panel, PanelHead, StatusBadge } from "./ui";

export function SettingsPage({
  enabledManagers,
  managerSnapshots,
  onSetManagerEnabled,
  scanningManagers,
}: {
  enabledManagers: ManagerId[];
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  onSetManagerEnabled: (managerId: ManagerId, enabled: boolean) => void;
  scanningManagers: Set<ManagerId>;
}) {
  const enabledSet = new Set(enabledManagers);

  return (
    <main className="view-grid">
      <Panel className="overflow-hidden">
        <PanelHead
          action={
            <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              已启用 {enabledManagers.length}/{managerOrder.length}
            </span>
          }
          eyebrow="设置"
          title="包管理工具"
        />
        <div className="flex flex-wrap gap-px bg-border">
          {managerOrder.map((managerId, index) => {
            const enabled = enabledSet.has(managerId);
            const locked = enabled && enabledManagers.length === 1;
            const manager = managerSnapshots[managerId];
            const status: DisplayStatus = scanningManagers.has(managerId) ? "Scanning" : manager?.status ?? "Not scanned";
            const version = manager?.version ?? null;

            return (
              <label
                className={`settings-row grid min-h-10 min-w-0 flex-[1_1_20rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-background px-4 py-1.5 transition-colors ${
                  locked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-muted/60"
                }`}
                data-index={String(index + 1).padStart(2, "0")}
                key={managerId}
              >
                <span className="grid min-w-0 gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{managerLabels[managerId]}</span>
                    <StatusBadge className="shrink-0" status={status} />
                  </span>
                  {version ? <span className="truncate text-xs text-muted-foreground">{version}</span> : null}
                </span>
                <Checkbox
                  aria-label={`启用 ${managerLabels[managerId]}`}
                  checked={enabled}
                  disabled={locked}
                  onCheckedChange={(checked) => onSetManagerEnabled(managerId, checked === true)}
                />
              </label>
            );
          })}
        </div>
      </Panel>
    </main>
  );
}
