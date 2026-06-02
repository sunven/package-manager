import { ChevronDown, Copy, ExternalLink } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { PackageRow } from "../types";
import { actionLabel } from "../utils/format";

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
    <DropdownMenuItem
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {icon}
      <span className="whitespace-nowrap">{children}</span>
    </DropdownMenuItem>
  );
}
