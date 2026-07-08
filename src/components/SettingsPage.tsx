import { managerLabels, managerOrder } from "../constants";
import type { DisplayStatus, ManagerId, ManagerSnapshot } from "../types";
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
    <main className="mt-5 grid gap-4">
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
        <div className="divide-y">
          {managerOrder.map((managerId) => {
            const enabled = enabledSet.has(managerId);
            const locked = enabled && enabledManagers.length === 1;
            const manager = managerSnapshots[managerId];
            const status: DisplayStatus = scanningManagers.has(managerId) ? "Scanning" : manager?.status ?? "Not scanned";
            const version = manager?.version ?? "未扫描";

            return (
              <label
                className={`grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 ${
                  locked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-muted/60"
                }`}
                key={managerId}
              >
                <span className="grid min-w-0 gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{managerLabels[managerId]}</span>
                    <StatusBadge className="shrink-0" status={status} />
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{version}</span>
                </span>
                <input
                  aria-label={`启用 ${managerLabels[managerId]}`}
                  checked={enabled}
                  className="size-4 accent-primary"
                  disabled={locked}
                  onChange={(event) => onSetManagerEnabled(managerId, event.currentTarget.checked)}
                  type="checkbox"
                />
              </label>
            );
          })}
        </div>
      </Panel>
    </main>
  );
}
