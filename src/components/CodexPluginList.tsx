import { Fragment, useId, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import {
  pluginDefaultLabel,
  type CodexPlugin, type CodexPluginChangeRequest, type CodexPluginChangeResult, type CodexPluginScan,
} from "../codexPlugins";
import { EmptyState, SkeletonRows } from "./ui";

type Confirmation = { plugin: CodexPlugin; request: CodexPluginChangeRequest; configPath: string };

export type CodexPluginState = {
  scan: CodexPluginScan | null;
  scanning: boolean;
  saving: boolean;
  error: string | null;
  result: CodexPluginChangeResult | null;
  onSetEnabled: (request: CodexPluginChangeRequest) => Promise<void>;
};

export function CodexPluginFeedback({ scan, error, result }: Pick<CodexPluginState, "scan" | "error" | "result">) {
  const scanFailure = error ?? (scan?.status !== "Ready" ? scan?.message : null);
  return <>
    {result ? <Alert variant={result.status === "Failed" ? "destructive" : "default"} role="status">
      <AlertTitle>{result.status === "Saved" ? "配置已保存" : result.status === "Conflict" ? "设置已变化，请重新确认" : "保存设置时遇到问题"}</AlertTitle>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert> : null}
    {scanFailure ? <Alert variant="destructive">
      <AlertTitle>{result?.status === "Saved" ? "配置已保存，但清单刷新失败" : scan?.status === "MissingCli" ? "插件清单需要 Codex CLI" : scan?.status === "Incompatible" ? "插件清单与 Codex CLI 版本不兼容" : "插件清单读取失败"}</AlertTitle>
      <AlertDescription>{scanFailure}{scan?.plugins.length ? " 下方插件为上次读取结果，已过期，暂时不能修改。" : ""}</AlertDescription>
    </Alert> : null}
    {scan?.configError ? <Alert variant="destructive">
      <AlertTitle>用户默认设置无法读取</AlertTitle>
      <AlertDescription>{scan.configError} 配置修复后请重新读取，当前禁止修改插件设置。</AlertDescription>
    </Alert> : null}
  </>;
}

export function CodexPluginList({ scan, scanning, saving, error, onSetEnabled, marketplaceName, blocked, onRestoreFocus }: Omit<CodexPluginState, "result"> & {
  marketplaceName: string;
  blocked: boolean;
  onRestoreFocus: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const plugins = scan?.plugins.filter((plugin) => plugin.marketplaceName === marketplaceName) ?? [];
  const busy = scanning || saving;
  const disabled = busy || blocked || Boolean(error || scan?.configError) || scan?.status !== "Ready" || !scan?.snapshotId;
  const scanFailure = error ?? (scan?.status !== "Ready" ? scan?.message : null);

  function requestChange(plugin: CodexPlugin, enabled: boolean, button: HTMLButtonElement) {
    if (disabled || plugin.readOnlyReason || !scan?.snapshotId) return;
    trigger.current = button;
    setConfirmation({
      plugin: { ...plugin }, configPath: scan.configPath,
      request: { snapshotId: scan.snapshotId, pluginId: plugin.pluginId, enabled },
    });
  }

  return (
    <section className="min-w-0" aria-label={`${marketplaceName} 的已安装插件`} aria-busy={busy}>
        <h3 className="mb-3 text-sm font-medium">已安装插件</h3>
        {!scan && scanning ? <SkeletonRows label="正在读取插件清单" /> : plugins.length ? (
          <Table className="min-w-[580px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">插件</TableHead>
                <TableHead className="w-[15%]">版本</TableHead>
                <TableHead className="w-[30%]">用户默认设置</TableHead>
                <TableHead className="w-[25%] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plugins.map((plugin, index) => {
                const open = expanded === plugin.pluginId;
                const detailId = `${id}-plugin-${index}`;
                const readOnly = disabled || Boolean(plugin.readOnlyReason);
                return (
                  <Fragment key={plugin.pluginId}>
                    <TableRow>
                      <TableCell className="whitespace-normal align-top">
                        <button aria-expanded={open} aria-controls={open ? detailId : undefined} className="w-full cursor-pointer break-all text-left font-medium text-primary underline-offset-4 hover:underline" onClick={() => setExpanded(open ? null : plugin.pluginId)} type="button">
                          {plugin.name}
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">{open ? "收起来源详情" : "查看来源详情"}</span>
                        </button>
                      </TableCell>
                      <TableCell className="whitespace-normal break-all align-top font-mono text-xs">{plugin.version || "未知"}</TableCell>
                      <TableCell className="whitespace-normal align-top">
                        <span className="block text-sm font-medium leading-5 text-foreground">
                          {plugin.readOnlyReason && plugin.defaultEnabled === null ? "未知" : pluginDefaultLabel(plugin.defaultEnabled)}
                        </span>
                        {plugin.readOnlyReason ? <p className="mt-1 break-words text-xs text-muted-foreground">{plugin.readOnlyReason}</p> : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap justify-end gap-1">
                          {plugin.defaultEnabled !== true ? <Button aria-label={`启用 ${plugin.name}（${plugin.marketplaceName}）`} disabled={readOnly} onClick={(event) => requestChange(plugin, true, event.currentTarget)} size="sm" type="button" variant="outline">{plugin.defaultEnabled === null ? "设为启用" : "启用"}</Button> : null}
                          {plugin.defaultEnabled !== false ? <Button aria-label={`禁用 ${plugin.name}（${plugin.marketplaceName}）`} disabled={readOnly} onClick={(event) => requestChange(plugin, false, event.currentTarget)} size="sm" type="button" variant="outline">{plugin.defaultEnabled === null ? "设为禁用" : "禁用"}</Button> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                    {open ? <TableRow id={detailId}><TableCell className="whitespace-normal bg-muted/30" colSpan={4}>
                      <dl className="grid gap-3 py-1 sm:grid-cols-2">
                        <PluginDetail label="来源类型" value={plugin.sourceKind === "local" ? "本地路径" : plugin.sourceKind === "git" ? "Git" : plugin.sourceKind === "npm" ? "npm" : "未知"} />
                        <PluginDetail label="插件身份" value={plugin.pluginId} mono />
                        <PluginDetail label="来源位置" value={plugin.sourceLocation} mono />
                        <PluginDetail label="市场来源" value={plugin.marketplaceLocation} mono />
                        <PluginDetail label="用户配置路径" value={scan?.configPath ?? null} mono />
                      </dl>
                    </TableCell></TableRow> : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        ) : <EmptyState message={scanning ? "正在读取已安装插件…" : scan?.status === "Ready" && !error ? "该市场暂无已安装插件。" : scanFailure ? "插件清单暂不可用。解决上方问题后，请重新读取。" : "等待读取已安装插件。"} />}

      <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !saving) setConfirmation(null); }}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus();
          else onRestoreFocus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>确认{confirmation?.request.enabled ? "启用" : "禁用"}插件</AlertDialogTitle>
            <AlertDialogDescription>只修改这个插件的用户默认设置。项目设置可能覆盖默认值；保存后请在新会话中验证。</AlertDialogDescription>
          </AlertDialogHeader>
          {confirmation ? <dl className="grid gap-3 text-sm">
            <PluginDetail label="插件" value={`${confirmation.plugin.name}（${confirmation.plugin.marketplaceName}）`} />
            <PluginDetail label="变更" value={`${pluginDefaultLabel(confirmation.plugin.defaultEnabled)} → ${confirmation.request.enabled ? "启用" : "禁用"}`} />
            <PluginDetail label="用户配置路径" value={confirmation.configPath} mono />
          </dl> : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button disabled={saving} type="button" variant="outline">取消</Button></AlertDialogCancel>
            <AlertDialogAction asChild><Button disabled={disabled} onClick={async (event) => {
              event.preventDefault();
              if (!confirmation) return;
              await onSetEnabled(confirmation.request);
              setConfirmation(null);
            }} type="button">{saving ? "正在保存…" : "保存设置"}</Button></AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function PluginDetail({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 whitespace-pre-wrap break-all ${mono ? "font-mono text-xs" : "text-sm"}`}>{value || "未知"}</dd></div>;
}
