import type { MaintenanceRequest, MaintenanceResult } from "../state";
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
  result,
  onCancel,
  onConfirm,
}: {
  confirmation: MaintenanceRequest | null;
  pending: MaintenanceRequest | null;
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
          <p className={visibleResult.tone === "bad" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {visibleResult.message}
          </p>
        ) : null}
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

function maintenanceConfirmationCopy(confirmation: MaintenanceRequest) {
  if (confirmation.kind === "cleanCache") {
    return {
      title: "确认清理 npm 缓存",
      description: "将执行 npm cache clean --force。清理后会刷新 npm 缓存占用。",
      confirm: "清理缓存",
    };
  }

  if (confirmation.kind === "storePrune") {
    return {
      title: "确认清理 pnpm store",
      description: "将执行 pnpm store prune，清理不再引用的 store 内容。清理后会刷新 pnpm store 占用。",
      confirm: "清理 store",
    };
  }

  const managerLabel = confirmation.managerId === "Pnpm" ? "pnpm" : "npm";
  const command = confirmation.managerId === "Pnpm"
    ? `pnpm remove --global ${confirmation.packageName}`
    : `npm uninstall -g ${confirmation.packageName}`;
  return {
    title: `确认卸载 ${managerLabel} 全局包`,
    description: `将执行 ${command}。卸载后会刷新 ${managerLabel} 包列表。`,
    confirm: "卸载",
  };
}

function maintenanceResultCopy(request: MaintenanceRequest, result: MaintenanceResult) {
  if (request.kind === "cleanCache") {
    return result.tone === "bad"
      ? {
        title: "npm 缓存清理失败",
        description: "清理没有完成。请查看下方错误信息。",
      }
      : {
        title: "npm 缓存已清理",
          description: "npm 和 npx 缓存清理已完成，缓存占用已刷新。",
      };
  }

  if (request.kind === "storePrune") {
    return result.tone === "bad"
      ? {
        title: "pnpm store 清理失败",
        description: "清理没有完成。请查看下方错误信息。",
      }
      : {
        title: "pnpm store 已清理",
        description: "pnpm store prune 已完成，store 占用已刷新。",
      };
  }

  const managerLabel = request.managerId === "Pnpm" ? "pnpm" : "npm";

  return result.tone === "bad"
    ? {
      title: `${managerLabel} 全局包卸载失败`,
      description: `没有完成 ${request.packageName} 的卸载。请查看下方错误信息。`,
    }
    : {
      title: `${managerLabel} 全局包已卸载`,
      description: `${request.packageName} 已卸载，${managerLabel} 包列表已刷新。`,
    };
}
