import { ChevronDown, Copy, ExternalLink } from "lucide-react";
import type { PackageRow } from "../types";
import { actionLabel } from "../utils/format";
import { cx } from "../utils/classNames";

export function PackageActions({
  index,
  menuOpen,
  onCopyPackage,
  onCopyPackageAction,
  onOpenPackage,
  onToggle,
  pkg,
}: {
  index: number;
  menuOpen: boolean;
  onCopyPackage: (index: number) => void;
  onCopyPackageAction: (index: number, actionIndex: number) => void;
  onOpenPackage: (index: number) => void;
  onToggle: (index: number) => void;
  pkg: PackageRow;
}) {
  return (
    <div className="relative inline-flex">
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-bold text-teal-700 transition hover:bg-slate-50"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(index);
        }}
        type="button"
      >
        操作
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {menuOpen ? (
        <div
          className={cx(
            "absolute right-0 top-9 z-20 grid min-w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg",
          )}
          role="menu"
        >
          <ActionItem icon={<Copy className="h-3.5 w-3.5" />} onClick={() => onCopyPackage(index)}>
            复制包名
          </ActionItem>
          {pkg.actions.map((action, actionIndex) => (
            <ActionItem icon={<Copy className="h-3.5 w-3.5" />} key={`${action.preview}-${actionIndex}`} onClick={() => onCopyPackageAction(index, actionIndex)}>
              {actionLabel(action)}
            </ActionItem>
          ))}
          {pkg.path ? (
            <ActionItem icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => onOpenPackage(index)}>
              打开路径
            </ActionItem>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionItem({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      role="menuitem"
      type="button"
    >
      {icon}
      <span className="whitespace-nowrap">{children}</span>
    </button>
  );
}
