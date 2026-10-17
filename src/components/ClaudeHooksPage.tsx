import { Fragment, useRef, useState } from "react";
import { ArrowsClockwise, Plus } from "@phosphor-icons/react";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { claudeHookHandler, claudeHookSummary } from "../claudeCode";
import type { ClaudeWorkflowState } from "../hooks/useClaudeWorkflow";
import { ClaudeHookEditor, type ClaudeHookSelection } from "./ClaudeHookEditor";
import { EmptyState, Panel, PanelHead, SkeletonRows } from "./ui";

export function ClaudeHooksPage({ state }: { state: ClaudeWorkflowState }) {
  const scan = state.hooks;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<ClaudeHookSelection | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const readButton = useRef<HTMLButtonElement>(null);
  const blocked = state.busy || !scan?.snapshotId || Boolean(scan.writeBlockedReason);
  const visible = (scan?.hooks ?? []).filter((hook) => `${hook.event} ${claudeHookSummary(hook)} ${hook.pluginId ?? "用户定义"}`.toLowerCase().includes(query.toLowerCase()));

  return <section className="grid gap-4" aria-label="Claude Code Hooks">
    <Panel><PanelHead title="Claude Code Hooks" action={<Button ref={readButton} disabled={state.busy} onClick={() => void state.refresh("hooks")} variant="outline" size="sm"><ArrowsClockwise aria-hidden="true" data-icon="inline-start" />{state.busy ? "正在处理…" : "重新读取"}</Button>} />
      <div className="grid gap-2 p-4 text-sm"><p>维护用户 Hook 定义，查看已安装市场插件的声明，包含禁用插件。</p><p className="text-xs text-muted-foreground">这份定义清单不代表会话正在执行的 Hook。插件声明只读；Claude 不提供保留定义的单项启停。</p>
        <p className="break-all font-mono text-xs text-muted-foreground">{scan?.configPath ?? "尚未读取用户配置"}</p>
        {scan?.disableAllHooks === true ? <Alert><AlertDescription>用户配置已关闭 Hooks，仍可编辑定义；保存不会打开总开关。项目可能覆盖此选择，托管 Hook 另有规则。</AlertDescription></Alert> : null}
        {scan?.writeBlockedReason ? <Alert><AlertDescription>{scan.writeBlockedReason}</AlertDescription></Alert> : null}
        {scan?.messages.length ? <Alert><AlertDescription><ul className="grid gap-1">{scan.messages.map((message, index) => <li key={index}>{message}</li>)}</ul></AlertDescription></Alert> : null}
      </div>
    </Panel>
    <Panel><PanelHead title="Hook 定义" action={<Button disabled={blocked} size="sm" onClick={(e) => { trigger.current = e.currentTarget; setSelection({ action: "Create" }); }}><Plus aria-hidden="true" data-icon="inline-start" />新增 Hook</Button>} />
      <div className="p-4"><label className="grid max-w-sm gap-1 text-xs">搜索定义<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="事件、处理内容或插件名称" /></label></div>
      {!scan && state.busy ? <SkeletonRows label="正在读取 Hook 定义" /> : visible.length ? <Table className="min-w-[760px] table-fixed"><TableHeader><TableRow><TableHead className="w-[20%]">事件 / 类型</TableHead><TableHead className="w-[32%]">处理内容</TableHead><TableHead className="w-[28%]">来源</TableHead><TableHead className="w-[20%] text-right">操作</TableHead></TableRow></TableHeader><TableBody>
        {visible.map((hook, index) => <Fragment key={hook.id}><TableRow><TableCell className="whitespace-normal break-all align-top"><button className="text-left font-medium text-primary underline-offset-4 hover:underline" aria-expanded={expanded === hook.id} aria-controls={expanded === hook.id ? `claude-hook-detail-${index}` : undefined} onClick={() => setExpanded(expanded === hook.id ? null : hook.id)}>{hook.event}<span className="mt-1 block font-mono text-xs font-normal">{String(claudeHookHandler(hook.handler).type ?? "未知")}</span></button></TableCell>
          <TableCell className="whitespace-normal align-top"><code className="line-clamp-3 break-all text-xs">{claudeHookSummary(hook)}</code>{hook.matcher !== null ? <p className="mt-1 break-all text-xs text-muted-foreground">匹配：{hook.matcher || "全部"}</p> : null}</TableCell>
          <TableCell className="whitespace-normal break-all align-top"><p className="text-sm">{hook.pluginId ?? "用户定义"}</p>{hook.pluginId ? <p className="mt-1 text-xs text-muted-foreground">插件当前配置{hook.pluginEnabled ? "启用" : "禁用"} · 定义只读</p> : null}{hook.readOnlyReason ? <p className="mt-1 text-xs text-muted-foreground">{hook.readOnlyReason}</p> : null}</TableCell>
          <TableCell className="whitespace-normal align-top">{!hook.pluginId ? <div className="flex flex-wrap justify-end gap-1">{(["Edit", "Delete"] as const).map((action) => <Button key={action} variant="outline" size="sm" disabled={blocked || Boolean(hook.readOnlyReason)} aria-label={`${action === "Edit" ? "编辑" : "删除"} ${hook.event}：${claudeHookSummary(hook)}`} onClick={(e) => { trigger.current = e.currentTarget; setSelection({ action, hook }); }}>{action === "Edit" ? "编辑" : "删除"}</Button>)}</div> : null}</TableCell>
        </TableRow>{expanded === hook.id ? <TableRow id={`claude-hook-detail-${index}`}><TableCell colSpan={4} className="whitespace-normal bg-muted/30"><p className="mb-2 break-all font-mono text-xs">{hook.source}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">{JSON.stringify(hook.handler, null, 2)}</pre></TableCell></TableRow> : null}</Fragment>)}
      </TableBody></Table> : <EmptyState message={!scan ? state.error ? "定义读取未完成，请使用「重新读取」重试。" : "尚未读取 Hook 定义。" : query ? "没有匹配的 Hook，请调整搜索。" : scan.writeBlockedReason || scan.messages.length ? "暂无可展示的定义；请先核对上方读取状态。" : "尚未发现用户或已安装插件的 Hook 定义。可新增用户 Hook。"} />}
    </Panel>
    {selection && scan ? <ClaudeHookEditor selection={selection} scan={scan} state={state} onClose={() => setSelection(null)} onRestoreFocus={() => { if (trigger.current?.isConnected) trigger.current.focus(); else readButton.current?.focus(); }} /> : null}
  </section>;
}
