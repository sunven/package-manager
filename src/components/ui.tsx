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
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Empty, EmptyDescription } from "../../components/ui/empty";
import { statusLabels } from "../constants";
import type { DisplayStatus } from "../types";
import type { SessionRefresh } from "../sessionRecords";
import { cn } from "../../lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("industrial-panel min-w-0 gap-0 py-0", className)}>
      {children}
    </Card>
  );
}

export function PanelHead({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <CardHeader className="industrial-panel-head border-b py-0">
      <CardTitle aria-level={2} role="heading">{title}</CardTitle>
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm" className="industrial-stat-card justify-between">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <strong className="block">{value}</strong>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Empty className="industrial-empty-state h-auto flex-none gap-0 px-3 py-2">
      <EmptyDescription>{message}</EmptyDescription>
    </Empty>
  );
}

export function SkeletonRows({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="studio-skeleton" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

export function Notice({ title, message }: { title: string; message: string }) {
  return <Alert><AlertTitle>{title}</AlertTitle><AlertDescription className="break-words">{message}</AlertDescription></Alert>;
}

export function RefreshNotice({ value, onRetry }: { value: SessionRefresh; onRetry: () => void }) {
  if (value.status === "notRequested") return null;
  if (value.status === "failed") return (
    <div>
      <p className="wrap-anywhere" role="status">列表刷新失败：{value.message} 执行结果已保留。</p>
      <Button className="mt-2" onClick={onRetry} size="sm" type="button" variant="outline">重试刷新</Button>
    </div>
  );
  return <p role="status">{value.status === "refreshing" ? "列表正在刷新。" : "列表已刷新。"}</p>;
}

export function StatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  return (
    <Badge className={cn("status-badge", className)} data-status={status} variant={statusVariant(status)}>
      {statusLabels[status]}
    </Badge>
  );
}

export function SignalBadge({ tone, children }: { tone: "neutral" | "warn" | "partial"; children: ReactNode }) {
  return (
    <Badge className="signal-badge" data-tone={tone} variant={tone === "neutral" ? "secondary" : tone === "warn" ? "destructive" : "outline"}>
      {children}
    </Badge>
  );
}

export function IconButton({
  ariaDescribedBy,
  children,
  className,
  disabled,
  label,
  onClick,
  type = "button",
}: {
  ariaDescribedBy?: string;
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
      aria-describedby={ariaDescribedBy}
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
    case "Failed":
    case "PermissionDenied":
    case "Error":
      return "destructive";
    case "Pending":
    case "Partial":
    case "Missing":
      return "secondary";
    default:
      return "secondary";
  }
}
