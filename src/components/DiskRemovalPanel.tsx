import { Trash } from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import type { DiskScanEntry } from "../diskScan";
import type { DiskScanWorkflow } from "../diskScanWorkflow";
import { diskRemovalLabels, type DiskRemovalView } from "../diskRemoval";
import { Notice, Panel } from "./ui";

export function DiskRemovalButton({ entry, workflow, icon = false }: { entry: DiskScanEntry; workflow: DiskScanWorkflow; icon?: boolean }) {
  return <Button type="button" variant={icon ? "ghost" : "outline"} size={icon ? "icon" : "sm"}
    disabled={!workflow.canRemove(entry)} title={entry.removalReason ?? "移到废纸篓"} aria-label={`移到废纸篓：${entry.name}`}
    onClick={() => void workflow.prepareRemoval([entry.id])}><Trash aria-hidden="true" />{!icon && "移到废纸篓"}</Button>;
}

export function DiskRemovalPanel({ removal, workflow }: { removal: DiskRemovalView; workflow: DiskScanWorkflow }) {
  const { plan, results, phase } = removal;
  const moved = results.filter((item) => item.status === "moved").length;
  const failed = results.filter((item) => item.status === "failed").length;
  const skipped = results.length - moved - failed;
  const byId = new Map(results.map((item) => [item.id, item]));
  return <>
    <AlertDialog open={phase === "confirming"} onOpenChange={(open) => { if (!open) void workflow.cancelRemoval(); }}>
      <AlertDialogContent className="disk-removal-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>将 {plan?.targets.length ?? 0} 项移到废纸篓？</AlertDialogTitle>
          <AlertDialogDescription>清空废纸篓前可通过系统恢复；本次操作不代表磁盘空间立即释放。</AlertDialogDescription>
        </AlertDialogHeader>
        {plan?.targets.some((target) => target.directory) && <p>目录会连同全部内容移入，包含扫描后新增的文件。</p>}
        {plan?.targets.some((target) => target.partial) && <p className="disk-removal-note">部分目录尚未扫描完整，操作包含未扫描到的内容，占用统计不完整。</p>}
        <ul className="disk-removal-targets">{plan?.targets.map((target) => <li key={target.id}><strong>{target.name}{target.directory ? "（整个目录）" : ""}</strong><p>{target.path}</p></li>)}</ul>
        {removal.error && <p role="alert">{removal.error}</p>}
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={removal.cancelling} onClick={() => void workflow.cancelRemoval()}>取消</Button>
          <Button type="button" variant="destructive" disabled={removal.cancelling} onClick={() => void workflow.confirmRemoval()}>移到废纸篓</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {phase === "preparing" && <p role="status">正在准备移除确认…</p>}
    {phase === "done" && !plan && removal.error && <Notice title="无法准备移除" message={removal.error} />}
    {plan && (phase === "running" || phase === "done") && <Panel className="disk-removal-result">
      <div className="disk-removal-result-head">
        <strong>{phase === "running" ? "正在移到废纸篓" : "移除结果"}</strong>
        <span role="status">已处理 {results.length} / {plan.targets.length} 项</span>
        {phase === "running" && <Button type="button" variant="outline" size="sm" disabled={removal.stopping} onClick={() => void workflow.stopRemoval()}>{removal.stopping ? "等待当前项完成…" : "完成当前项后停止"}</Button>}
      </div>
      <p>已移入 {moved} · 跳过 {skipped} · 失败 {failed}{phase === "done" && ` · ${removal.error ? "结果未确认" : "未执行"} ${plan.targets.length - results.length}`}</p>
      {removal.currentPath && <p className="disk-removal-current">{removal.currentPath}</p>}
      {removal.error && <p role="alert">{removal.error}</p>}
      {removal.followup && <p role="status">{removal.followup}</p>}
      {removal.historyWarning && <p role="alert">维护历史提示：{removal.historyWarning}</p>}
      <details><summary>查看逐项结果</summary><ul className="disk-removal-targets">{plan.targets.map((target) => {
        const item = byId.get(target.id);
        return <li key={target.id}><strong>{target.name} · {item ? diskRemovalLabels[item.status] : phase === "running" ? "待处理" : removal.error ? "结果未确认" : "未执行"}</strong><p>{target.path}</p>{item?.message && <p>{item.message}</p>}</li>;
      })}</ul></details>
    </Panel>}
  </>;
}
