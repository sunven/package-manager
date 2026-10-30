import type { MaintenanceRequest } from "../state";
import type { MaintenanceOperation } from "../managerMaintenanceWorkflow";
import { cleanupCopyFor } from "../cleanupCopy";
import { managerLabel } from "../utils/format";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";

export function MaintenanceConfirmationBanner({
  operation,
  onCancel,
  onConfirm,
  onRetryVerification,
  onShowHistory,
}: {
  operation: MaintenanceOperation | null;
  onCancel: () => void;
  onConfirm: () => void;
  onRetryVerification: () => void;
  onShowHistory?: (recordId: string) => void;
}) {
  if (!operation) return null;

  const { request, phase, execution, verification, reclaimable, reclaimDetails } = operation;
  const busy = phase === "executing" || phase === "verifying";
  const copy = maintenanceConfirmationCopy(request);
  const title = phase === "invalidated" ? "确认已失效" : execution ? `${managerLabel(request.managerId)} 维护结果` : copy.title;

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open && !busy) onCancel();
    }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="wrap-anywhere">{title}</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            {phase === "invalidated" ? operation.invalidation : execution
              ? request.kind === "uninstallGlobalPackage"
                ? `本次卸载目标：${managerLabel(request.managerId)} 全局包 ${request.packageName}。`
                : request.kind === "uninstallSdkComponent"
                  ? `本次卸载目标：Android SDK 组件 ${request.packageName}。`
                  : `本次操作：${copy.title.replace(/^确认/, "")}。`
              : copy.description}
          </DialogDescription>
        </DialogHeader>
        <div aria-live="polite" className="grid min-w-0 gap-4 wrap-anywhere">
          {execution ? (
            <section className="grid min-w-0 gap-1" aria-label="执行结果">
              <h3 className="text-sm font-medium">执行结果：{execution.title}</h3>
              <p className={`whitespace-pre-wrap text-sm ${execution.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                {execution.message}
              </p>
            </section>
          ) : phase !== "invalidated" ? (
            <>
              {reclaimable && request.kind === "cleanupCache" ? (
                <p className="text-sm text-muted-foreground">
                  {reclaimable.label} <strong className="font-medium text-foreground">{reclaimable.value}</strong>
                  <span className="mt-1 block">{reclaimable.note}</span>
                </p>
              ) : null}
              {copy.reclaimNote ? <p className="text-sm text-muted-foreground">{copy.reclaimNote}</p> : null}
              {reclaimDetails ? (
                <pre tabIndex={0} role="region" aria-label="清理预演明细" className="terminal-code max-h-48 overflow-auto whitespace-pre-wrap p-3 text-xs leading-5 text-muted-foreground">
                  {reclaimDetails}
                </pre>
              ) : null}
              {phase === "executing" ? <p className="text-sm text-muted-foreground">正在执行，完成后将读取最新快照…</p> : null}
            </>
          ) : null}
          {verification.status !== "notStarted" ? (
            <section className="grid min-w-0 gap-1" aria-label="快照核对">
              <h3 className="text-sm font-medium">{verification.status === "reading" ? "正在核对最新快照…"
                : verification.status === "succeeded" ? "最新快照已读取"
                : verification.status === "failed" ? "最新快照读取失败" : "未执行核对"}</h3>
              <p className={`whitespace-pre-wrap text-sm ${verification.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                {verification.message ?? (verification.status === "reading"
                  ? "正在读取包清单、目录占用及适用的补充信息。"
                  : "已完成目标管理器的完整读取。")}
              </p>
              {verification.status === "failed" ? <p className="text-sm text-muted-foreground">可重新读取此管理器，执行结果会保留，维护命令不会重复执行。</p> : null}
            </section>
          ) : null}
        </div>
        <DialogFooter>
          {phase === "confirming" || phase === "executing" ? (
            <>
              <Button disabled={busy} onClick={onCancel} size="sm" type="button" variant="outline">取消</Button>
              <Button disabled={busy} onClick={onConfirm} size="sm" type="button" variant="destructive">
                {busy ? request.kind === "cleanupCache" ? "正在清理" : "正在卸载" : copy.confirm}
              </Button>
            </>
          ) : (
            <>
              {phase === "finished" && verification.status === "failed" ? (
                <Button onClick={onRetryVerification} size="sm" type="button" variant="outline">重新读取</Button>
              ) : null}
              {phase === "finished" && operation.historyId && onShowHistory ? (
                <Button onClick={() => { onCancel(); onShowHistory(operation.historyId!); }} size="sm" type="button" variant="outline">已保存到维护历史</Button>
              ) : null}
              <Button disabled={busy} onClick={onCancel} size="sm" type="button" variant="outline">{busy ? "正在核对" : "关闭"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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

  if (confirmation.kind === "uninstallSdkComponent") {
    return {
      title: "确认卸载 SDK 组件",
      description: `将永久删除 Android SDK 组件 ${confirmation.packageName}，不进入废纸篓，无法由本工具恢复。${
        confirmation.commandPreview ? `执行命令：${confirmation.commandPreview}。` : ""
      }卸载后会刷新 SDK 组件列表。`,
      confirm: "卸载 SDK 组件",
      reclaimNote: undefined as string | undefined,
    };
  }

  const label = managerLabel(confirmation.managerId);
  const command = confirmation.managerId === "Pnpm"
    ? `pnpm remove --global ${confirmation.packageName}`
    : `npm uninstall -g ${confirmation.packageName}`;
  return {
    title: `确认卸载 ${confirmation.packageName}`,
    description: `将卸载此 ${label} 全局包，需要时须重新安装。执行命令：${command}。卸载后会刷新包列表。`,
    confirm: "卸载全局包",
    reclaimNote: undefined as string | undefined,
  };
}
