import { X } from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";

export const appUpdateToastId = "app-update-prompt";

export function AppUpdateToast({
  version,
  onClose,
  onView,
}: {
  version: string;
  onClose(): void;
  onView(): void;
}) {
  return (
    <div className="pointer-events-auto w-[320px] rounded-2xl border bg-card p-4 text-card-foreground shadow-lg" role="status">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">发现新版本</p>
          <p className="mt-1 text-xs text-muted-foreground">版本 {version} 已可用。</p>
        </div>
        <Button
          aria-label="关闭更新提示"
          className="-mr-2 -mt-2"
          onClick={onClose}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
      <Button className="mt-3 w-full" onClick={onView} size="sm" type="button">
        查看更新
      </Button>
    </div>
  );
}
