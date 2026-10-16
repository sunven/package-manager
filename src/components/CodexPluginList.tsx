import { Fragment, useId, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { pluginDefaultLabel, type CodexPlugin } from "../codexPlugins";
import type { CodexExtensions } from "../hooks/useCodexExtensions";
import { EmptyState, SkeletonRows } from "./ui";

const operationLabel = { Install: "安装", Reinstall: "重新安装", Uninstall: "卸载" };

export type CodexPluginState = CodexExtensions["plugins"];

export function CodexPluginFeedback({ scan, scanning, current, error, result }: CodexPluginState) {
  const scanFailure = error ?? (scan?.status !== "Ready" ? scan?.message : scan && !current && !scanning ? "插件清单已过期，请重新读取。" : null);
  return <>
    {result ? <Alert variant={result.status === "Failed" ? "destructive" : "default"} role="status">
      <AlertTitle>{result.status === "Succeeded" ? "插件操作已完成" : result.status === "Saved" ? "配置已保存" : result.status === "Conflict" ? "设置已变化，请重新确认" : "插件操作遇到问题"}</AlertTitle>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert> : null}
    {scanFailure ? <Alert variant="destructive">
      <AlertTitle>{result?.status === "Succeeded" ? "操作已完成，但清单读取失败" : result?.status === "Saved" ? "配置已保存，但清单刷新失败" : scan?.status === "MissingCli" ? "插件清单需要 Codex CLI" : scan?.status === "Incompatible" ? "插件清单与 Codex CLI 版本不兼容" : "插件清单读取失败"}</AlertTitle>
      <AlertDescription>{scanFailure}{scan?.plugins.length ? " 下方插件为上次读取结果，已过期，暂时不能修改。" : ""}</AlertDescription>
    </Alert> : null}
    {scan?.configError ? <Alert variant="destructive">
      <AlertTitle>用户默认设置无法读取</AlertTitle>
      <AlertDescription>{scan.configError} 配置修复后请重新读取，当前禁止修改插件设置。</AlertDescription>
    </Alert> : null}
  </>;
}

export function CodexPluginList({ workflow, onShowHooks, marketplaceName, onRestoreFocus }: {
  workflow: CodexExtensions;
  onShowHooks?: () => void;
  marketplaceName: string;
  onRestoreFocus: () => void;
}) {
  const { scan, scanning, current, error } = workflow.plugins;
  const confirmation = workflow.operation?.kind === "plugin" && workflow.operation.target.marketplaceName === marketplaceName ? workflow.operation : null;
  const saving = Boolean(confirmation && confirmation.phase !== "confirming");
  const blocked = Boolean(workflow.operation);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const marketPlugins = scan?.plugins.filter((plugin) => plugin.marketplaceName === marketplaceName) ?? [];
  const plugins = marketPlugins.filter((plugin) => (filter === "all" || plugin.installed === (filter === "installed"))
    && [plugin.name, plugin.details.displayName, plugin.details.description].some((value) => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const busy = scanning || saving;
  const disabled = busy || blocked || Boolean(error || scan?.configError) || !current;
  const scanFailure = error ?? (scan?.status !== "Ready" ? scan?.message : null);
  const lifecycle = confirmation && "operation" in confirmation.intent ? confirmation.intent.operation : null;
  const action = lifecycle ? operationLabel[lifecycle] : confirmation && "enabled" in confirmation.intent && confirmation.intent.enabled ? "启用" : "禁用";

  async function requestChange(plugin: CodexPlugin, enabled: boolean, button: HTMLButtonElement) {
    if (disabled || plugin.readOnlyReason) return;
    trigger.current = button;
    setRequestError(await workflow.request({ kind: "plugin", pluginId: plugin.pluginId, enabled }));
  }

  async function requestLifecycle(plugin: CodexPlugin, operation: "Install" | "Reinstall" | "Uninstall", button: HTMLButtonElement) {
    if (disabled || plugin.readOnlyReason) return;
    if (operation !== "Uninstall" && plugin.installBlockedReason) return;
    trigger.current = button;
    setRequestError(await workflow.request({ kind: "plugin", pluginId: plugin.pluginId, operation }));
  }

  return <section className="min-w-0" aria-label={`${marketplaceName} 的插件`} aria-busy={busy}>
    {requestError ? <p className="mb-3 text-sm text-destructive" role="alert">{requestError}</p> : null}
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <h3 className="mr-auto text-sm font-medium">插件目录</h3>
      <div className="grid min-w-0 flex-1 basis-52 gap-1 sm:max-w-xs">
        <label className="text-xs text-muted-foreground" htmlFor={`${id}-search`}>搜索此市场</label>
        <Input id={`${id}-search`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称或简介" />
      </div>
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground" htmlFor={`${id}-filter`}>安装状态</label>
        <select id={`${id}-filter`} className="h-9 rounded-md border bg-background px-3 text-sm" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">全部</option><option value="installed">已安装</option><option value="available">未安装</option>
        </select>
      </div>
    </div>
    {!scan && scanning ? <SkeletonRows label="正在读取插件清单" /> : plugins.length ? <Table className="min-w-[680px] table-fixed">
      <TableHeader><TableRow>
        <TableHead className="w-[26%]">插件</TableHead><TableHead className="w-[14%]">版本</TableHead>
        <TableHead className="w-[24%]">状态与默认设置</TableHead><TableHead className="w-[36%] text-right">操作</TableHead>
      </TableRow></TableHeader>
      <TableBody>{plugins.map((plugin, index) => {
        const open = expanded === plugin.pluginId;
        const detailId = `${id}-plugin-${index}`;
        const readOnly = disabled || Boolean(plugin.readOnlyReason);
        return <Fragment key={plugin.pluginId}>
          <TableRow>
            <TableCell className="whitespace-normal align-top">
              <button aria-expanded={open} aria-controls={open ? detailId : undefined} className="w-full cursor-pointer break-all text-left font-medium text-primary underline-offset-4 hover:underline" onClick={() => setExpanded(open ? null : plugin.pluginId)} type="button">
                {plugin.details.displayName || plugin.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{open ? "收起插件详情" : "查看插件详情"}</span>
              </button>
            </TableCell>
            <TableCell className="whitespace-normal break-all align-top text-xs"><span className="font-mono">{plugin.version || "未知"}</span><span className="mt-1 block text-muted-foreground">{plugin.installed ? "已安装版本" : "来源版本"}</span></TableCell>
            <TableCell className="whitespace-normal align-top">
              <span className="block text-sm font-medium">{plugin.installed ? "已安装" : "未安装"}</span>
              {plugin.installed ? <span className="text-sm">{plugin.readOnlyReason && plugin.defaultEnabled === null ? "未知" : pluginDefaultLabel(plugin.defaultEnabled)}</span> : null}
              {plugin.readOnlyReason ? <p className="mt-1 text-xs text-muted-foreground">{plugin.readOnlyReason}</p> : null}
              {plugin.installBlockedReason ? <p className="mt-1 text-xs text-muted-foreground">{plugin.installBlockedReason}</p> : null}
            </TableCell>
            <TableCell className="align-top"><div className="flex flex-wrap justify-end gap-1">
              {plugin.installed && plugin.defaultEnabled !== true ? <Button aria-label={`启用 ${plugin.name}（${plugin.marketplaceName}）`} disabled={readOnly} onClick={(event) => requestChange(plugin, true, event.currentTarget)} size="sm" type="button" variant="outline">{plugin.defaultEnabled === null ? "设为启用" : "启用"}</Button> : null}
              {plugin.installed && plugin.defaultEnabled !== false ? <Button aria-label={`禁用 ${plugin.name}（${plugin.marketplaceName}）`} disabled={readOnly} onClick={(event) => requestChange(plugin, false, event.currentTarget)} size="sm" type="button" variant="outline">{plugin.defaultEnabled === null ? "设为禁用" : "禁用"}</Button> : null}
              <>
                <Button aria-label={`${plugin.installed ? "重新安装" : "安装"} ${plugin.name}（${plugin.marketplaceName}）`} disabled={readOnly || Boolean(plugin.installBlockedReason)} onClick={(event) => requestLifecycle(plugin, plugin.installed ? "Reinstall" : "Install", event.currentTarget)} size="sm" type="button" variant={plugin.installed ? "outline" : "default"}>{plugin.installed ? "重新安装" : "安装"}</Button>
                {plugin.installed ? <Button aria-label={`卸载 ${plugin.name}（${plugin.marketplaceName}）`} disabled={readOnly} onClick={(event) => requestLifecycle(plugin, "Uninstall", event.currentTarget)} size="sm" type="button" variant="outline">卸载</Button> : null}
              </>
            </div></TableCell>
          </TableRow>
          {open ? <TableRow id={detailId}><TableCell className="whitespace-normal bg-muted/30" colSpan={4}>
            <dl className="grid gap-3 py-2 sm:grid-cols-2">
              <PluginDetail label="简介" value={plugin.details.description} />
              <PluginDetail label="作者" value={plugin.details.author} />
              <PluginDetail label="分类" value={plugin.details.category} />
              <PluginDetail label="插件身份" value={plugin.pluginId} mono />
              <PluginDetail label="安装策略" value={plugin.installPolicy === "AVAILABLE" ? "可安装" : plugin.installPolicy === "INSTALLED_BY_DEFAULT" ? "默认安装" : plugin.installPolicy === "NOT_AVAILABLE" ? "不允许安装" : null} />
              <PluginDetail label="认证要求" value={plugin.authPolicy === "ON_INSTALL" ? "安装时认证；请在 Codex 完成" : plugin.authPolicy === "ON_USE" ? "使用时认证；请在 Codex 完成" : plugin.authPolicy} />
              <PluginDetail label="来源类型" value={plugin.sourceKind === "local" ? "本地路径" : plugin.sourceKind === "git" ? "Git" : plugin.sourceKind === "npm" ? "npm" : "未知"} />
              <PluginDetail label="来源位置" value={plugin.sourceLocation} mono />
              <PluginDetail label="市场来源" value={plugin.marketplaceLocation} mono />
              <PluginDetail label={plugin.details.origin === "installed" ? "详情来自安装副本" : "详情来自来源目录"} value={plugin.details.root} mono />
              <PluginDetail label="用户配置路径" value={scan?.configPath ?? null} mono />
            </dl>
            <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-3">
              <ComponentList label="技能" items={plugin.details.skills} />
              <ComponentList label="MCP 服务" items={plugin.details.mcpServers} />
              <div><ComponentList label="Hooks 事件" items={plugin.details.hooks} />{onShowHooks ? <Button className="mt-2" disabled={busy || blocked} size="sm" variant="outline" onClick={onShowHooks}>打开 Hooks 管理</Button> : null}</div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">组件来自插件声明，不代表已经加载、连接或获得信任。</p>
            {plugin.details.messages.map((message, i) => <p key={i} className="mt-2 text-sm text-muted-foreground">{message}</p>)}
          </TableCell></TableRow> : null}
        </Fragment>;
      })}</TableBody>
    </Table> : <EmptyState message={scanning ? "正在读取插件目录…" : scan?.status === "Ready" && !error ? marketPlugins.length ? "没有符合搜索或筛选条件的插件。" : "该市场暂无插件目录项或已安装插件。" : scanFailure ? "插件清单暂不可用。解决上方问题后，请重新读取。" : "等待读取插件目录。"} />}

    <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open && confirmation) workflow.cancel(confirmation.id); }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus(); else onRestoreFocus();
      }}>
        <AlertDialogHeader>
          <AlertDialogTitle>确认{action}插件</AlertDialogTitle>
          <AlertDialogDescription>{lifecycle === "Uninstall" ? "由 Codex 卸载选定插件的安装副本及配置。不会追加删除原始来源、凭据或插件数据。"
            : lifecycle === "Reinstall" ? "从当前来源重新安装，并将插件设为启用，包括当前已禁用的插件。不保证取得上游最新版；认证请在 Codex 中完成，并在新会话中验证。"
              : lifecycle === "Install" ? "从当前来源安装此插件，并设为启用。连接认证请在 Codex 中完成，并在新会话中验证。"
              : "只修改这个插件的用户默认设置。项目设置可能覆盖默认值；保存后请在新会话中验证。"}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmation ? <dl className="grid gap-3 text-sm">
          <PluginDetail label="插件" value={`${confirmation.target.name}（${confirmation.target.marketplaceName}）`} />
          {"enabled" in confirmation.intent ? <PluginDetail label="变更" value={`${pluginDefaultLabel(confirmation.target.defaultEnabled)} → ${confirmation.intent.enabled ? "启用" : "禁用"}`} /> : <PluginDetail label="来源" value={confirmation.target.sourceLocation} mono />}
          <PluginDetail label="用户配置路径" value={confirmation.configPath} mono />
        </dl> : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild><Button disabled={saving} type="button" variant="outline">取消</Button></AlertDialogCancel>
          <AlertDialogAction asChild><Button disabled={saving} variant={lifecycle === "Uninstall" ? "destructive" : "default"} onClick={async (event) => {
            event.preventDefault(); if (!confirmation) return;
            await workflow.confirm(confirmation.id);
          }} type="button">{saving ? "正在执行…" : lifecycle ? `确认${action}` : "保存设置"}</Button></AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

function PluginDetail({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 whitespace-pre-wrap break-all ${mono ? "font-mono text-xs" : "text-sm"}`}>{value || "未知"}</dd></div>;
}

function ComponentList({ label, items }: { label: string; items: string[] | null }) {
  return <div><h4 className="text-sm font-medium">{label}</h4>{items?.length ? <ul className="mt-2 space-y-1 text-sm">{items.map((name) => <li key={name} className="break-all">{name}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">{items === null ? "尚不可读取" : "未声明"}</p>}</div>;
}
