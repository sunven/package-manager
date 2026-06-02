import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription } from "../../components/ui/empty";
import { statusLabels } from "../constants";
import type { DisplayStatus } from "../types";
import { cn } from "../../lib/utils";

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0 gap-0 py-0", className)}>
      {children}
    </Card>
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
    <CardHeader className="border-b py-4">
      <CardDescription className="text-xs font-medium uppercase">{eyebrow}</CardDescription>
      <CardTitle className="truncate">{title}</CardTitle>
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm" className="min-h-[76px] justify-between gap-2 py-3">
      <CardHeader className="px-3.5">
        <CardDescription className="text-xs font-medium">{label}</CardDescription>
      </CardHeader>
      <CardContent className="px-3.5">
        <strong className="block text-2xl font-medium leading-7">{value}</strong>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Empty className="min-h-40 px-5 py-8">
      <EmptyDescription>{message}</EmptyDescription>
    </Empty>
  );
}

export function StatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  return (
    <Badge className={className} variant={statusVariant(status)}>
      {statusLabels[status]}
    </Badge>
  );
}

export function SignalBadge({ tone, children }: { tone: "neutral" | "warn" | "partial"; children: ReactNode }) {
  return (
    <Badge variant={tone === "neutral" ? "secondary" : tone === "warn" ? "destructive" : "outline"}>
      {children}
    </Badge>
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
    <Button
      aria-label={label}
      className={className}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type={type}
      size="icon"
      variant="outline"
    >
      {children}
    </Button>
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
    <Button
      className={className}
      disabled={disabled}
      onClick={onClick}
      type={type}
      size="sm"
      variant="outline"
    >
      {children}
    </Button>
  );
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Ready":
      return "default";
    case "Unsupported":
      return "outline";
    case "Missing":
    case "Failed":
    case "PermissionDenied":
    case "Error":
      return "destructive";
    case "Pending":
    case "Partial":
      return "secondary";
    default:
      return "secondary";
  }
}
