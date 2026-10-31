import { Fragment, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowsClockwise, Plus } from "@phosphor-icons/react";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { claudeOperationLabel, claudeSourceLabel, isMarketOperation, type ClaudeChangeRequest, type ClaudeMarketplace, type ClaudeOperation, type ClaudePlugin } from "../claudeCode";
import type { ClaudeCodeState } from "../hooks/useClaudeCode";
import type { ObservationCoverageItem } from "../observationCoverage";
import { errorToString } from "../utils/format";
import { ObservationState } from "./ObservationState";
import { EmptyState, Panel, PanelHead, SkeletonRows } from "./ui";

const control = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";

export function ClaudeMarketplacesPage({ state, coverage, onShowHooks, focusedPluginId }: {
  state: ClaudeCodeState;
  coverage: { marketplaces: ObservationCoverageItem; plugins: ObservationCoverageItem };
  focusedPluginId?: string;
  onShowHooks: () => void;
}) {
  const { marketplaces: marketScan, plugins: pluginScan, marketplacesScanning, pluginsScanning, busy: operating } = state;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sourceKind, setSourceKind] = useState<"git" | "local" | "url">("git");
  const [source, setSource] = useState("");
  const [refName, setRefName] = useState("");
  const [sparse, setSparse] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [confirmation, setConfirmation] = useState<{ request: ClaudeChangeRequest; label: string; affected: string[]; source?: string | null } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const readButton = useRef<HTMLButtonElement>(null);
  const directory = marketScan?.directory ?? pluginScan?.directory;
  const version = marketScan?.version ?? pluginScan?.version;
  const writeBlockedReason = marketScan?.writeBlockedReason ?? pluginScan?.writeBlockedReason;
  const marketBlocked = operating || choosing || marketplacesScanning || !marketScan?.snapshotId || Boolean(marketScan.writeBlockedReason);
  const pluginBlocked = operating || choosing || pluginsScanning || !pluginScan?.snapshotId || Boolean(pluginScan.writeBlockedReason);
  const groups = new Map<string, ClaudeMarketplace | null>((marketScan?.marketplaces ?? []).map((m) => [m.name, m]));
  for (const plugin of pluginScan?.plugins ?? []) if (!groups.has(plugin.marketplaceName)) groups.set(plugin.marketplaceName, null);

  useEffect(() => {
    if (!focusedPluginId) return;
    if (!pluginScan) { void state.readPlugins(); return; }
    const target = pluginScan.plugins.find((plugin) => plugin.id === focusedPluginId);
    if (target && expanded !== target.marketplaceName) setExpanded(target.marketplaceName);
  }, [focusedPluginId, pluginScan, expanded, state.readPlugins]);

  function toggle(name: string) {
    const next = expanded === name ? null : name;
    setExpanded(next);
    if (next && !pluginScan?.snapshotId && !pluginsScanning) void state.readPlugins();
  }

  function blockedFor(operation: ClaudeOperation) {
    return isMarketOperation(operation) ? marketBlocked : pluginBlocked;
  }

  function confirm(operation: ClaudeOperation, target: string, element: HTMLElement, market?: ClaudeMarketplace) {
    const snapshotId = isMarketOperation(operation) ? marketScan?.snapshotId : pluginScan?.snapshotId;
    if (!snapshotId || blockedFor(operation)) return;
    trigger.current = element;
    setConfirmation({ request: { snapshotId, operation, target }, label: target, affected: market?.affectedPlugins ?? [], source: market?.source });
  }
  async function choose(file: boolean) {
    setChoosing(true); setFormError(null);
    try { const path = await invoke<string | null>("choose_claude_marketplace_path", { file }); if (path) setSource(path); }
    catch (e) { setFormError(errorToString(e)); }
    finally { setChoosing(false); }
  }

  const confirmationSnapshot = confirmation
    ? isMarketOperation(confirmation.request.operation) ? marketScan?.snapshotId : pluginScan?.snapshotId
    : null;

  return <section className="grid gap-4" aria-label="Claude Code 插件市场">
    <Panel><PanelHead title="Claude Code 插件市场" action={<Button ref={readButton} disabled={operating || choosing} onClick={() => void state.refresh("marketplaces")} variant="outline" size="sm"><ArrowsClockwise aria-hidden="true" data-icon="inline-start" />{operating ? "正在处理…" : "重新读取"}</Button>} />
      <div className="grid gap-3 p-4 text-sm">
        <p>展开市场，浏览插件、查看详情并管理当前用户的安装与启用选择。</p>
        <dl className="meta-list">
          <div className="meta-row">
            <dt>Claude Code 目录</dt>
            <dd><code>{directory ?? "尚未读取"}</code>{version ? <span> · CLI {version}</span> : null}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">更新市场目录后，可单独更新已安装插件。插件变更请在 Claude 中重新加载或开启新会话验证。</p>
        <div className="grid gap-1">
          <ObservationState item={coverage.marketplaces} live showNote={!state.error} variant="strip" />
          <ObservationState item={coverage.plugins} live showNote={!state.error} variant="strip" />
        </div>
        {writeBlockedReason ? <Alert><AlertDescription>{writeBlockedReason}</AlertDescription></Alert> : null}
        {focusedPluginId && pluginScan && !pluginsScanning && !pluginScan.plugins.some((plugin) => plugin.id === focusedPluginId) ? <Alert><AlertDescription className="break-words">当前市场清单未找到插件 {focusedPluginId}。请重新读取；若仍未找到，请回该技能的原来源维护。</AlertDescription></Alert> : null}
      </div>
    </Panel>
    <Panel><PanelHead title="市场" action={<Button disabled={marketBlocked} size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" data-icon="inline-start" />添加市场</Button>} />
      {adding ? <form className="grid gap-3 border-b p-4" onSubmit={(event) => {
        event.preventDefault(); if (!marketScan?.snapshotId) return;
        trigger.current = event.currentTarget.querySelector('button[type="submit"]');
        setConfirmation({ request: { snapshotId: marketScan.snapshotId, operation: "AddMarket", source: source.trim(), sourceKind,
          refName: sourceKind === "git" ? refName.trim() : undefined, sparsePaths: sourceKind === "git" ? sparse.split("\n").map((p) => p.trim()).filter(Boolean) : [] }, label: source.trim(), affected: [] });
      }}>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="grid gap-1 text-sm">来源类型<select className={control} value={sourceKind} disabled={marketBlocked} onChange={(e) => setSourceKind(e.target.value as typeof sourceKind)}><option value="git">GitHub / Git</option><option value="local">本地目录 / JSON</option><option value="url">远程 JSON</option></select></label>
          <label className="grid gap-1 text-sm">市场来源<Input value={source} disabled={marketBlocked} onChange={(e) => setSource(e.target.value)} placeholder={sourceKind === "local" ? "本地绝对路径" : sourceKind === "url" ? "远程 marketplace.json 地址" : "owner/repo 或 Git URL"} required /></label>
        </div>
        {sourceKind === "local" ? <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={marketBlocked} onClick={() => void choose(false)} type="button">选择目录</Button><Button variant="outline" size="sm" disabled={marketBlocked} onClick={() => void choose(true)} type="button">选择 JSON 文件</Button><p className="w-full text-xs text-muted-foreground">本地目录须包含 .claude-plugin/marketplace.json。</p></div> : <p className="text-xs text-muted-foreground">沿用本机认证；地址请勿包含令牌。远程 JSON 目录中的插件不能使用相对来源路径。</p>}
        {sourceKind === "git" ? <details><summary className="cursor-pointer text-sm font-medium">Git 高级选项</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">分支或标签（可选）<Input value={refName} disabled={marketBlocked} onChange={(e) => setRefName(e.target.value)} placeholder="main 或 v1.0" /></label>
          <label className="grid gap-1 text-sm">稀疏检出目录（每行一个）<textarea className={control} value={sparse} disabled={marketBlocked} onChange={(e) => setSparse(e.target.value)} rows={3} /></label>
        </div></details> : null}
        <p className="text-xs text-muted-foreground">添加市场可能补装现有插件缺失的依赖，完成后会重新读取清单。</p>
        {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={operating || choosing} onClick={() => setAdding(false)}>取消添加</Button><Button type="submit" disabled={marketBlocked || !source.trim()}>预览添加</Button></div>
      </form> : null}
      {!marketScan && marketplacesScanning ? <SkeletonRows label="正在读取 Claude 市场" /> : groups.size ? <Table className="min-w-[720px] table-fixed">
        <TableHeader><TableRow><TableHead className="w-[23%]">市场</TableHead><TableHead className="w-[13%]">类型</TableHead><TableHead className="w-[34%]">来源</TableHead><TableHead className="w-[30%] text-right">操作</TableHead></TableRow></TableHeader>
        <TableBody>{Array.from(groups, ([name, market], index) => <Fragment key={name}>
          <TableRow>
            <TableCell className="whitespace-normal break-all align-top"><button className="w-full text-left font-medium text-primary underline-offset-4 hover:underline" aria-expanded={expanded === name} aria-controls={expanded === name ? `claude-market-${index}` : undefined} onClick={() => toggle(name)}>{name}<span className="mt-1 block text-xs font-normal">{expanded === name ? "收起插件与详情" : "查看插件与详情"}</span></button></TableCell>
            <TableCell className="whitespace-normal align-top">{market ? claudeSourceLabel(market.sourceKind) : "未知"}</TableCell>
            <TableCell className="whitespace-normal break-all font-mono text-xs align-top">{market?.source ?? "未匹配市场来源"}</TableCell>
            <TableCell className="whitespace-normal align-top">{!market || market.readOnlyReason ? <p className="text-xs text-muted-foreground">{market?.readOnlyReason ?? "来源不明，仅供查看。"}</p> : <>
              <div className="flex flex-wrap justify-end gap-1"><Button variant="outline" size="sm" disabled={marketBlocked} onClick={(e) => confirm("UpdateMarket", name, e.currentTarget, market)}>更新目录</Button><Button variant="outline" size="sm" disabled={marketBlocked || Boolean(market.removeBlockedReason)} onClick={(e) => confirm("RemoveMarket", name, e.currentTarget, market)}>移除</Button></div>
              {market.removeBlockedReason ? <p className="mt-2 text-xs text-muted-foreground">{market.removeBlockedReason}</p> : null}
            </>}</TableCell>
          </TableRow>
          {expanded === name ? <TableRow id={`claude-market-${index}`}><TableCell colSpan={4} className="whitespace-normal bg-muted/30">
            {pluginScan ? <ClaudePluginRows focusedPluginId={focusedPluginId} plugins={pluginScan.plugins.filter((p) => p.marketplaceName === name)} blocked={pluginBlocked} onAction={confirm} onShowHooks={onShowHooks} /> : <div className="grid gap-3 py-3">
              {pluginsScanning ? <SkeletonRows label="正在读取插件目录" /> : <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-muted-foreground">插件目录尚未读取。首次读取可能需要联网刷新缓存。</p><Button variant="outline" size="sm" disabled={operating} onClick={() => void state.readPlugins()}>读取插件目录</Button></div>}
            </div>}
            {market ? <dl className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2"><Detail label="市场本地目录" value={market.root} /><Detail label="分支或标签" value={market.refName} />{market.sparsePaths.length ? <Detail label="稀疏检出目录" value={market.sparsePaths.join("\n")} /> : null}</dl> : null}
          </TableCell></TableRow> : null}
        </Fragment>)}</TableBody>
      </Table> : <div className="grid gap-3 p-4">
        {marketplacesScanning || pluginsScanning ? <SkeletonRows label="正在读取内置插件目录（首次可能需要联网刷新缓存）" /> : <>
          <EmptyState message={marketScan?.status === "Ready" ? "当前没有市场。添加一个市场以浏览和安装插件。" : "市场清单暂不可用，请重新读取。"} />
          {marketScan?.status === "Ready" && !pluginScan ? <div className="flex justify-end"><Button variant="outline" size="sm" disabled={operating} onClick={() => void state.readPlugins()}>加载插件目录</Button></div> : null}
        </>}
      </div>}
    </Panel>

    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !operating) setConfirmation(null); }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); else readButton.current?.focus(); }}>
        <AlertDialogHeader><AlertDialogTitle>确认{confirmation ? claudeOperationLabel[confirmation.request.operation] : "操作"}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation?.request.operation === "RemoveMarket" ? "移除用户市场可能连带卸载下列插件，并删除其可删除的选项、秘密和数据。涉及其他作用域或影响不明时会阻止。" : confirmation?.request.operation === "Uninstall" ? "卸载此用户插件，由 Claude 处理安装记录及相关数据；若依赖规则不允许，将显示原因。" : confirmation?.request.operation === "UpdateMarket" ? "从来源刷新市场目录；已安装插件可在目录更新后单独更新。" : "在当前用户范围执行。添加市场、安装或启用可能联动插件依赖；实际结果以操作后重新读取的清单为准。"}</AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid gap-3"><Detail label="对象" value={confirmation?.label} /><Detail label="用户目录" value={directory} />{confirmation?.source ? <Detail label="来源" value={confirmation.source} /> : null}</dl>
        {confirmation?.request.operation === "RemoveMarket" ? <div className="text-sm"><p className="font-medium">受影响的用户插件</p>{confirmation.affected.length ? <ul className="mt-2 list-inside list-disc break-all">{confirmation.affected.map((id) => <li key={id}>{id}</li>)}</ul> : <p className="mt-2 text-muted-foreground">当前没有已安装插件。</p>}</div> : null}
        <AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" disabled={operating}>取消</Button></AlertDialogCancel><AlertDialogAction asChild><Button disabled={operating || confirmation?.request.snapshotId !== confirmationSnapshot} onClick={async (event) => {
          event.preventDefault(); if (!confirmation) return;
          const outcome = await state.change(confirmation.request);
          if (outcome?.status === "Succeeded" && confirmation.request.operation === "AddMarket") { setAdding(false); setSource(""); setRefName(""); setSparse(""); }
          setConfirmation(null);
        }}>{operating ? "正在执行…" : "确认执行"}</Button></AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

function ClaudePluginRows({ plugins, blocked, onAction, onShowHooks, focusedPluginId }: { focusedPluginId?: string; plugins: ClaudePlugin[]; blocked: boolean; onAction: (operation: ClaudeOperation, target: string, element: HTMLElement) => void; onShowHooks: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const focusedButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusedPluginId && plugins.some((plugin) => plugin.id === focusedPluginId)) {
      setQuery(""); setFilter("all"); setExpanded(focusedPluginId);
    }
  }, [focusedPluginId, plugins]);
  useEffect(() => {
    if (expanded === focusedPluginId) { focusedButton.current?.focus(); focusedButton.current?.scrollIntoView?.({ block: "nearest" }); }
  }, [expanded, focusedPluginId]);
  const visible = plugins.filter((plugin) => (filter === "all" || plugin.installed === (filter === "installed")) && `${plugin.name} ${plugin.details.description ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="grid gap-3 py-2">
    <div className="flex flex-wrap items-end justify-between gap-3"><h3 className="text-sm font-semibold">插件目录</h3><div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs">搜索此市场<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名称或简介" /></label>
      <label className="grid gap-1 text-xs">安装状态<select className={control} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部</option><option value="installed">已安装</option><option value="available">未安装</option></select></label>
    </div></div>
    {visible.length ? <Table className="min-w-[660px] table-fixed"><TableHeader><TableRow><TableHead className="w-[25%]">插件</TableHead><TableHead className="w-[15%]">安装版本</TableHead><TableHead className="w-[24%]">用户安装与启用</TableHead><TableHead className="w-[36%] text-right">操作</TableHead></TableRow></TableHeader><TableBody>
      {visible.map((plugin) => <Fragment key={plugin.id}><TableRow>
        <TableCell className="whitespace-normal break-all align-top"><button ref={plugin.id === focusedPluginId ? focusedButton : undefined} className="text-left font-medium text-primary underline-offset-4 hover:underline" aria-expanded={expanded === plugin.id} onClick={() => setExpanded(expanded === plugin.id ? null : plugin.id)}>{plugin.name}<span className="mt-1 block text-xs font-normal">{expanded === plugin.id ? "收起详情" : "查看详情"}</span></button></TableCell>
        <TableCell className="whitespace-normal break-all align-top font-mono text-xs">{plugin.version ?? "未安装"}</TableCell>
        <TableCell className="whitespace-normal align-top"><p>{plugin.installed ? "已安装" : "未在用户范围安装"}</p>{plugin.installed ? <p className="mt-1 text-xs text-muted-foreground">{plugin.userEnabled === null ? `用户未显式设置；当前配置${plugin.enabled ? "启用" : "禁用"}` : plugin.userEnabled ? "用户选择启用" : "用户选择禁用"}</p> : null}</TableCell>
        <TableCell className="whitespace-normal align-top">{plugin.readOnlyReason ? <p className="text-xs text-muted-foreground">{plugin.readOnlyReason}</p> : <div className="flex flex-wrap justify-end gap-1">
          {(plugin.installed ? [plugin.enabled ? "Disable" : "Enable", "Update", "Uninstall"] as const : ["Install"] as const).map((operation) => <Button key={operation} variant="outline" size="sm" disabled={blocked} aria-label={`${claudeOperationLabel[operation]} ${plugin.id}`} onClick={(e) => onAction(operation, plugin.id, e.currentTarget)}>{claudeOperationLabel[operation]}</Button>)}
        </div>}</TableCell>
      </TableRow>{expanded === plugin.id ? <TableRow><TableCell colSpan={4} className="whitespace-normal">
        <dl className="grid gap-3 py-2 sm:grid-cols-2"><Detail label="简介" value={plugin.details.description} /><Detail label="作者" value={plugin.details.author} /><Detail label="内容来源" value={plugin.details.origin === "installed" ? "已安装本地内容" : plugin.details.origin === "source" ? "本地来源目录" : "仅市场目录信息"} /><Detail label="本地位置" value={plugin.details.root} />
          <Detail label="技能声明" value={plugin.details.skills.join("、") || "未发现可读取的声明"} /><Detail label="代理声明" value={plugin.details.agents.join("、") || "未发现可读取的声明"} /><Detail label="MCP 服务声明" value={plugin.details.mcpServers.join("、") || "未发现可读取的声明"} /><Detail label="Hook 事件声明" value={plugin.details.hooks.join("、") || "未发现可读取的声明"} /><Detail label="插件来源" value={plugin.source} /></dl>
        {plugin.details.messages.map((message, index) => <p key={index} className="mt-2 text-xs text-muted-foreground">{message}</p>)}
        <p className="mt-3 text-xs text-muted-foreground">组件声明不代表会话已加载或 MCP 已连接。</p><Button className="mt-2" variant="outline" size="sm" disabled={blocked} onClick={onShowHooks}>查看 Hooks</Button>
      </TableCell></TableRow> : null}</Fragment>)}
    </TableBody></Table> : <EmptyState message={plugins.length ? "没有匹配的插件，请调整搜索或筛选。" : "此市场暂未提供可浏览的插件。"} />}
  </div>;
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-all text-sm">{value || "未知"}</dd></div>;
}
