import type { MaintenanceRequest, MaintenanceResult } from "../state";
import { cleanupCopyFor } from "../cleanupCopy";
import { managerLabel } from "../utils/format";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";

export function MaintenanceConfirmationBanner({
  confirmation,
  pending,
  reclaimable,
  reclaimDetails,
  result,
  onCancel,
  onConfirm,
}: {
  confirmation: MaintenanceRequest | null;
  pending: MaintenanceRequest | null;
  /** Reclaimable-space figure, or null when none can be shown honestly. */
  reclaimable: string | null;
  /**
   * Itemised list of what will be removed, when the manager can produce one
   * before running. Only Homebrew can, via its dry-run.
   */
  reclaimDetails: string | null;
  result: MaintenanceResult | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirmation) return null;

  const isPending = Boolean(pending);
  const visibleResult = pending ? null : result;
  const confirmationCopy = maintenanceConfirmationCopy(confirmation);
  const resultCopy = visibleResult ? maintenanceResultCopy(confirmation, visibleResult) : null;
  const copy = resultCopy ?? confirmationCopy;

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open && !isPending) onCancel();
    }}>
      <DialogContent showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle className={visibleResult ? "sr-only" : undefined}>{copy.title}</DialogTitle>
          {visibleResult ? null : <DialogDescription>{copy.description}</DialogDescription>}
        </DialogHeader>
        {visibleResult ? (
          <p className={resultToneClassName(visibleResult.tone)}>
            {visibleResult.message}
          </p>
        ) : (
          <>
            {reclaimable && confirmation.kind === "cleanupCache" ? (
              <p className="text-sm text-muted-foreground">
                预计回收 <strong className="font-medium text-foreground">{reclaimable}</strong>
              </p>
            ) : null}
            {confirmationCopy.reclaimNote ? (
              <p className="text-sm text-muted-foreground">{confirmationCopy.reclaimNote}</p>
            ) : null}
            {reclaimDetails ? (
              <pre className="terminal-code max-h-48 overflow-auto p-3 text-xs leading-5 text-muted-foreground">
                {reclaimDetails}
              </pre>
            ) : null}
          </>
        )}
        <DialogFooter>
          {visibleResult ? (
            <Button onClick={onCancel} size="sm" type="button" variant="outline">
              关闭
            </Button>
          ) : (
            <>
              <Button disabled={isPending} onClick={onCancel} size="sm" type="button" variant="outline">
                取消
              </Button>
              <Button disabled={isPending} onClick={onConfirm} size="sm" type="button" variant="destructive">
                {isPending ? "执行中" : confirmationCopy.confirm}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function resultToneClassName(tone: MaintenanceResult["tone"]) {
  if (tone === "bad") return "text-sm text-destructive";
  // Partial completion is neither success nor failure; it needs its own weight.
  if (tone === "warn") return "text-sm text-foreground";
  return "text-sm text-muted-foreground";
}

function maintenanceConfirmationCopy(confirmation: MaintenanceRequest) {
  if (confirmation.kind === "cleanupCache") {
    const copy = cleanupCopyFor(confirmation.managerId);
    if (!copy) {
      // Unreachable via the UI: managers without a plan expose no affordance.
      return {
        title: "无法清理",
        description: `${managerLabel(confirmation.managerId)} 没有可用的清理方案。`,
        confirm: "关闭",
        reclaimNote: undefined as string | undefined,
      };
    }
    return {
      title: copy.title,
      description: copy.description,
      confirm: copy.confirm,
      reclaimNote: copy.reclaimNote,
    };
  }

  const label = managerLabel(confirmation.managerId);
  const command = confirmation.managerId === "Pnpm"
    ? `pnpm remove --global ${confirmation.packageName}`
    : `npm uninstall -g ${confirmation.packageName}`;
  return {
    title: `确认卸载 ${label} 全局包`,
    description: `将执行 ${command}。卸载后会刷新 ${label} 包列表。`,
    confirm: "卸载",
    reclaimNote: undefined as string | undefined,
  };
}

function maintenanceResultCopy(request: MaintenanceRequest, result: MaintenanceResult) {
  if (request.kind === "cleanupCache") {
    const copy = cleanupCopyFor(request.managerId);
    if (result.tone === "bad") {
      return {
        title: copy?.failed ?? "清理失败",
        description: "清理没有完成。请查看下方错误信息。",
      };
    }
    if (result.tone === "warn") {
      return {
        title: `${managerLabel(request.managerId)} 清理部分完成`,
        description: "部分步骤已经删除了内容，后续步骤没有完成。请查看下方明细再决定是否重试。",
      };
    }
    return {
      title: copy?.succeeded ?? "清理完成",
      description: "清理已完成，占用已刷新。",
    };
  }

  const label = managerLabel(request.managerId);

  return result.tone === "bad"
    ? {
      title: `${label} 全局包卸载失败`,
      description: `没有完成 ${request.packageName} 的卸载。请查看下方错误信息。`,
    }
    : {
      title: `${label} 全局包已卸载`,
      description: `${request.packageName} 已卸载，${label} 包列表已刷新。`,
    };
}
