import { managerOrder, statusLabels } from "../constants";
import type { ManagerId, ManagerSnapshot } from "../types";
import { managerLabel } from "../utils/format";
import { cx } from "../utils/classNames";
import { statusClass } from "./ui";

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
    <section className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
      {managerOrder.map((managerId) => {
        const manager = managerSnapshots[managerId];
        const scanning = scanningManagers.has(managerId);
        const status = scanning ? "Scanning" : manager?.status ?? "Not scanned";
        return (
          <button
            className={cx(
              "flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm transition hover:bg-slate-50",
              managerId === selectedManager && "border-teal-700 shadow-[inset_0_0_0_1px_#0f766e]",
            )}
            key={managerId}
            onClick={() => onSelect(managerId)}
            type="button"
          >
            <span className="min-w-0 truncate font-medium">{manager?.label ?? managerLabel(managerId)}</span>
            <span className={cx("shrink-0 rounded-full px-2 py-1 text-[11px] font-extrabold leading-none", statusClass(status))}>
              {statusLabels[status]}
            </span>
          </button>
        );
      })}
    </section>
  );
}
