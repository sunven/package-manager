import type { ReactNode } from "react";
import { statusLabels } from "../constants";
import type { DisplayStatus } from "../types";
import { cx } from "../utils/classNames";

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("min-w-0 rounded-lg border border-slate-200 bg-white", className)}>
      {children}
    </section>
  );
}

export function PanelHead({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{eyebrow}</p>
        <h2 className="truncate text-[17px] font-bold leading-6 text-slate-900">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-[76px] rounded-lg border border-slate-200 bg-white px-3.5 py-3">
      <span className="block text-xs font-bold text-slate-500">{label}</span>
      <strong className="mt-2.5 block text-2xl font-bold leading-7 text-slate-900">{value}</strong>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center px-5 py-8 text-center">
      <p className="text-sm font-bold text-slate-500">{message}</p>
    </div>
  );
}

export function StatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[11px] font-extrabold leading-none", statusClass(status), className)}>
      {statusLabels[status]}
    </span>
  );
}

export function SignalBadge({ tone, children }: { tone: "neutral" | "warn" | "partial"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-1 text-[11px] font-extrabold leading-none",
        tone === "warn" && "bg-amber-100 text-amber-800",
        tone === "partial" && "bg-yellow-100 text-yellow-800",
        tone === "neutral" && "bg-slate-100 text-slate-600",
      )}
    >
      {children}
    </span>
  );
}

export function IconButton({
  children,
  className,
  disabled,
  label,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      aria-label={label}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-teal-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type={type}
    >
      {children}
    </button>
  );
}

export function TextButton({
  children,
  className,
  disabled,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={cx(
        "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-bold text-teal-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function statusClass(status: string) {
  switch (status) {
    case "Ready":
      return "bg-emerald-100 text-emerald-800";
    case "Unsupported":
      return "bg-amber-100 text-amber-800";
    case "Missing":
    case "Failed":
    case "PermissionDenied":
    case "Error":
      return "bg-red-100 text-red-800";
    case "Pending":
    case "Partial":
      return "bg-yellow-100 text-yellow-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}
