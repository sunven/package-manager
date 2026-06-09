import { ChevronDown, Copy, ExternalLink, Terminal, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import type { PackageRow } from "../types";
import { actionLabel } from "../utils/format";

export function PackageActions({
  index,
  managerId,
  menuOpen,
  onCopyPackage,
  onCopyPackageAction,
  onOpenPackage,
  onRequestUninstall,
  onToggle,
  pendingUninstall,
  pkg,
}: {
  index: number;
  managerId: string;
  menuOpen: boolean;
  onCopyPackage: (index: number) => void;
  onCopyPackageAction: (index: number, actionIndex: number) => void;
  onOpenPackage: (index: number) => void;
  onRequestUninstall: (index: number) => void;
  onToggle: (index: number) => void;
  pendingUninstall: boolean;
  pkg: PackageRow;
}) {
  if (managerId === "Npm") {
    return (
      <TooltipProvider>
        <div className="flex justify-end gap-1">
          <InlineAction label="复制包名" onClick={() => onCopyPackage(index)}>
            <Copy />
          </InlineAction>
          {pkg.actions.map((action, actionIndex) => (
            <InlineAction key={`${action.preview}-${actionIndex}`} label={actionLabel(action)} onClick={() => onCopyPackageAction(index, actionIndex)}>
              <Terminal />
            </InlineAction>
          ))}
          <InlineAction disabled={!pkg.path} label="打开路径" onClick={() => onOpenPackage(index)}>
            <ExternalLink />
          </InlineAction>
          <InlineAction disabled={pendingUninstall} label={pendingUninstall ? "卸载中" : "卸载全局包"} onClick={() => onRequestUninstall(index)} variant="destructive">
            <Trash2 />
          </InlineAction>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={() => onToggle(index)}>
      <DropdownMenuTrigger asChild>
        <Button
          onClick={(event) => event.stopPropagation()}
          size="sm"
          type="button"
          variant="outline"
        >
          操作
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuGroup>
          <ActionItem icon={<Copy />} onClick={() => onCopyPackage(index)}>
            复制包名
          </ActionItem>
          {pkg.actions.map((action, actionIndex) => (
            <ActionItem icon={<Copy />} key={`${action.preview}-${actionIndex}`} onClick={() => onCopyPackageAction(index, actionIndex)}>
              {actionLabel(action)}
            </ActionItem>
          ))}
          {pkg.path ? (
            <ActionItem icon={<ExternalLink />} onClick={() => onOpenPackage(index)}>
              打开路径
            </ActionItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InlineAction({
  children,
  disabled,
  label,
  onClick,
  variant = "outline",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  variant?: "outline" | "destructive";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (disabled) return;
            onClick();
          }}
          size="icon-xs"
          title={label}
          type="button"
          variant={variant}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ActionItem({
  children,
  disabled,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onClick();
      }}
    >
      {icon}
      <span className="whitespace-nowrap">{children}</span>
    </DropdownMenuItem>
  );
}
