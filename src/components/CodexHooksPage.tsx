import { ArrowClockwise as RefreshCw, Plus } from "@phosphor-icons/react";
import { Fragment, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { CardContent } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import {
  hookEventLabel, hookOperation, hookSource, hookTrustLabel,
  definitionHook, type CodexHook, type CodexHookChangeRequest, type CodexHookChangeResult, type CodexHookScan,
  type HookDefinitionRequest, type HookDefinitionPreview,
} from "../codexHooks";
import { CodexHookEditor, type HookEditorSelection } from "./CodexHookEditor";
import { EmptyState, Panel, PanelHead, SkeletonRows } from "./ui";

type Confirmation = { hook: CodexHook; request: CodexHookChangeRequest; configPath: string };

export function CodexHooksPage({ scan, scanning, saving, preparing = false, error, result, onRefresh, onSetEnabled, onShowPlugins, onPrepareDefinition, onCommitDefinition }: {
  scan: CodexHookScan | null;
  scanning: boolean;
  saving: boolean;
  preparing?: boolean;
  error: string | null;
  result: CodexHookChangeResult | null;
  onRefresh: () => void;
  onSetEnabled: (request: CodexHookChangeRequest) => Promise<void>;
  onShowPlugins: () => void;
  onPrepareDefinition?: (request: HookDefinitionRequest) => Promise<HookDefinitionPreview>;
  onCommitDefinition?: (planId: string) => Promise<CodexHookChangeResult>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [editor, setEditor] = useState<HookEditorSelection | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement | null>(null);
  const busy = scanning || saving || preparing;
  const stale = Boolean(error) || Boolean(scan && scan.status !== "Ready");
  const disabled = busy || stale || Boolean(scan?.configError || scan?.message) || !scan?.snapshotId || scan.featureEnabled !== true;
  const failure = error ?? (scan?.status !== "Ready" ? scan?.message : null);
  const definitions = scan?.definitions;
  const definitionDisabled = busy || stale || !definitions?.snapshotId || Boolean(definitions.readOnlyReason) || !onPrepareDefinition || !onCommitDefinition;
  const rows = [
    ...(scan?.hooks ?? []).map((hook) => ({ hook, definition: definitions?.entries.find((entry) => entry.nativeKey === hook.key) })),
    ...(definitions?.entries ?? []).filter((entry) => !scan?.hooks.some((hook) => hook.key === entry.nativeKey))
      .map((definition) => ({ hook: definitionHook(definition), definition })),
  ];

  function openEditor(selection: HookEditorSelection, button: HTMLButtonElement) {
    trigger.current = button;
    setEditor(selection);
  }

  function requestChange(hook: CodexHook, button: HTMLButtonElement) {
    if (disabled || hook.readOnlyReason || !scan?.snapshotId) return;
    trigger.current = button;
    setConfirmation({
      hook: { ...hook }, configPath: scan.configPath,
      request: { snapshotId: scan.snapshotId, key: hook.key, enabled: !hook.enabled },
    });
  }

  return (
    <section className="view-grid" aria-label="Codex Hooks 管理" aria-busy={busy}>
      <Panel>
        <PanelHead title="Codex Hooks" action={
          <div className="flex flex-wrap gap-2"><Button ref={refreshButton} disabled={busy || Boolean(confirmation) || Boolean(editor)} onClick={onRefresh} size="sm" type="button" variant="outline">
            <RefreshCw aria-hidden="true" className={scanning ? "motion-safe:animate-spin" : undefined} data-icon="inline-start" />
            {scanning ? "读取中" : "刷新"}
          </Button>
          {definitions ? <Button disabled={definitionDisabled || Boolean(confirmation) || Boolean(editor)} onClick={(e) => openEditor({ action: "create" }, e.currentTarget)} size="sm" type="button"><Plus aria-hidden="true" data-icon="inline-start" />新增 Hook</Button> : null}</div>
        } />
        <CardContent className="grid gap-2 p-4">
          <p className="text-sm">查看事件触发的操作，维护用户 Hook 定义，并管理已信任 Hook 的启用设置。</p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
            <span className="shrink-0 text-muted-foreground">Codex 目录</span>
            <code className="min-w-0 break-all">{scan?.directory || "尚未读取"}</code>
          </div>
          <p className="text-xs text-muted-foreground">
            用户定义可新增、编辑和删除；插件定义只读，可单项启停。项目配置与已禁用插件未展开。{" "}
            <button className="cursor-pointer text-primary underline underline-offset-4 disabled:cursor-default disabled:opacity-50" disabled={busy || Boolean(confirmation) || Boolean(editor)} onClick={onShowPlugins} type="button">前往插件市场</button>
          </p>
          <p className="text-xs text-muted-foreground" role="status">
            {preparing ? "正在核对定义变更，尚未保存…" : saving ? "正在保存并重新核对设置…" : scanning ? scan ? "正在读取，暂时显示上次结果。" : "正在读取 Hooks…" : "在其他地方修改设置后，请手动刷新；保存后请在新会话中验证。"}
          </p>
        </CardContent>
      </Panel>

      {result ? <Alert variant={result.status === "Failed" || result.status === "Partial" ? "destructive" : "default"} role="status">
        <AlertTitle>{result.status === "Saved" ? "配置已保存" : result.status === "Partial" ? "保存未完整确认，请核对实际变更" : result.status === "Conflict" ? "设置已变化，请重新确认" : "保存设置时遇到问题"}</AlertTitle>
        <AlertDescription>{result.message}</AlertDescription>
      </Alert> : null}
      {failure ? <Alert variant="destructive">
        <AlertTitle>{result?.status === "Saved" ? "配置已保存，但清单刷新失败" : scan?.status === "MissingCli" ? "需要 Codex CLI" : scan?.status === "Incompatible" ? "Codex CLI 版本不兼容" : "Hooks 清单读取失败"}</AlertTitle>
        <AlertDescription>{failure}{scan?.hooks.length ? " 下方为上次结果，已过期，暂时不能修改。" : ""}</AlertDescription>
      </Alert> : null}
      {scan?.status === "Ready" && !error && scan.featureEnabled === false ? <Alert>
        <AlertTitle>Hooks 总开关已关闭</AlertTitle>
        <AlertDescription>{definitions ? "用户定义仍可维护，但总开关关闭时不会触发。保存定义不会打开总开关。" : "Codex 此时不会返回 Hook 清单，并不表示没有配置。请在 Codex 中检查总开关设置后刷新。"}</AlertDescription>
      </Alert> : null}
      {definitions?.readOnlyReason ? <Alert><AlertTitle>定义维护当前只读</AlertTitle><AlertDescription className="whitespace-pre-wrap break-words">{definitions.readOnlyReason}</AlertDescription></Alert> : null}
      {scan?.configError ? <Alert variant="destructive">
        <AlertTitle>用户配置无法核实</AlertTitle>
        <AlertDescription>{scan.configError} 当前仅供查看。</AlertDescription>
      </Alert> : null}
      {scan?.status === "Ready" && scan.message ? <Alert variant="destructive">
        <AlertTitle>Hooks 清单尚未完整核实</AlertTitle>
        <AlertDescription className="whitespace-pre-wrap break-words">{scan.message}</AlertDescription>
      </Alert> : null}
      {scan?.warnings.length ? <Alert>
        <AlertTitle>配置提示</AlertTitle>
        <AlertDescription><ul className="list-disc space-y-1 pl-4">{scan.warnings.map((warning, index) => <li className="break-words" key={index}>{warning}</li>)}</ul></AlertDescription>
      </Alert> : null}

      <Panel className="overflow-hidden">
        <PanelHead title="Hooks 清单" action={<span className="text-xs text-muted-foreground">{scan?.status === "Ready" && !error && (scan.featureEnabled === true || definitions) ? "已读取 " + rows.length + " 项" : "清单待核实"}</span>} />
        {!scan && scanning ? <SkeletonRows label="正在读取 Hooks 清单" /> : rows.length ? (
          <Table className="min-w-[740px] table-fixed">
            <TableHeader><TableRow>
              <TableHead className="w-[14%]">事件</TableHead>
              <TableHead className="w-[30%]">操作内容</TableHead>
              <TableHead className="w-[16%]">来源</TableHead>
              <TableHead className="w-[23%]">启用与信任</TableHead>
              <TableHead className="w-[17%] text-right">操作</TableHead>
            </TableRow></TableHeader>
            <TableBody>{rows.map(({ hook, definition }, index) => {
              const open = expanded === hook.key;
              const detailId = "codex-hook-detail-" + index;
              const event = hookEventLabel(hook.eventName);
              return <Fragment key={hook.key}>
                <TableRow>
                  <TableCell className="whitespace-normal align-top">
                    <button aria-expanded={open} aria-controls={open ? detailId : undefined} className="w-full cursor-pointer break-all text-left font-medium text-primary underline-offset-4 hover:underline" onClick={() => setExpanded(open ? null : hook.key)} type="button">
                      {event}<span className="mt-1 block text-xs font-normal text-muted-foreground">{open ? "收起配置详情" : "查看配置详情"}</span>
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-normal align-top">
                    {hook.statusMessage ? <p className="mb-1 break-words text-sm">{hook.statusMessage}</p> : null}
                    <code className="line-clamp-2 break-all text-xs">{hookOperation(hook)}</code>
                  </TableCell>
                  <TableCell className="whitespace-normal break-all align-top text-xs">{hookSource(hook)}{definition ? <span className="mt-1 block text-muted-foreground">{definition.source === "json" ? "hooks.json" : "config.toml"}</span> : null}</TableCell>
                  <TableCell className="whitespace-normal align-top">
                    <p className="text-sm font-medium">{definition?.enabled === null ? "启用选择未知" : hook.enabled ? "启用" : "禁用"} · {hookTrustLabel(hook.trustStatus)}</p>
                    {hook.readOnlyReason ? <p className="mt-1 break-words text-xs text-muted-foreground">{hook.readOnlyReason}</p> : null}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <div className="flex flex-wrap justify-end gap-1">
                      {definition ? <Button aria-label={"编辑 " + event + "：" + hookOperation(hook)} disabled={definitionDisabled || Boolean(definition.readOnlyReason)} onClick={(e) => openEditor({ action: "update", definition }, e.currentTarget)} size="sm" type="button" variant="outline">编辑</Button> : null}
                      <Button aria-label={(hook.enabled ? "禁用 " : "启用 ") + event + "（" + hookSource(hook) + "）：" + hookOperation(hook)} disabled={disabled || Boolean(hook.readOnlyReason)} onClick={(e) => requestChange(hook, e.currentTarget)} size="sm" type="button" variant="outline">{hook.enabled ? "禁用" : "启用"}</Button>
                      {definition ? <Button aria-label={"删除 " + event + "：" + hookOperation(hook)} disabled={definitionDisabled || Boolean(definition.readOnlyReason)} onClick={(e) => openEditor({ action: "delete", definition }, e.currentTarget)} size="sm" type="button" variant="ghost" className="text-destructive">删除</Button> : null}
                    </div>
                  </TableCell>
                </TableRow>
                {open ? <TableRow id={detailId}><TableCell className="whitespace-normal bg-muted/30" colSpan={5}>
                  <dl className="grid gap-3 py-1 sm:grid-cols-2">
                    <div className="sm:col-span-2"><HookDetail label={hook.handlerType === "command" ? "完整命令" : "处理程序"} value={hookOperation(hook)} mono /></div>
                    <HookDetail label="配置来源" value={hook.sourcePath} mono />
                    <HookDetail label="匹配条件" value={hook.matcher ?? "未指定"} mono />
                    <HookDetail label="超时" value={hook.timeoutSec + " 秒"} />
                    <HookDetail label="类型" value={hook.handlerType === "command" ? hook.async ? "异步命令" : "命令" : hook.handlerType === "mcpTool" ? "MCP 工具" : hook.handlerType} />
                    <HookDetail label="信任审查" value="在 Codex CLI 输入 /hooks，或使用桌面 App 的 Hooks 界面。审查后刷新此页。" />
                    <HookDetail label="用户配置路径" value={scan?.configPath ?? "未知"} mono />
                    {definition ? <div className="min-w-0 sm:col-span-2"><dt className="text-xs text-muted-foreground">原始定义（只读）</dt><dd><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify({ event: definition.event, matcher: definition.matcher, handler: definition.handler }, null, 2)}</pre></dd></div> : null}
                  </dl>
                </TableCell></TableRow> : null}
              </Fragment>;
            })}</TableBody>
          </Table>
        ) : <EmptyState message={stale ? "清单暂不可用。解决上方问题后，请刷新重试。" : definitions?.snapshotId ? "当前没有用户定义。点击“新增 Hook”配置第一个事件处理程序。" : scan?.featureEnabled === false ? "开启总开关后，可重新读取可见的 Hooks。" : scan?.status === "Ready" && scan.featureEnabled === true && !scan.message ? "当前范围未返回 Hooks；已禁用插件和项目配置不在此清单中。" : "等待核实 Hooks 清单，请查看上方状态。"} />}
      </Panel>

      {editor && definitions && onPrepareDefinition && onCommitDefinition ? <CodexHookEditor selection={editor} definitions={definitions} busy={busy}
        onClose={() => setEditor(null)} onRefresh={onRefresh} onPrepare={onPrepareDefinition} onCommit={onCommitDefinition}
        onRestoreFocus={() => { if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus(); else refreshButton.current?.focus(); }} /> : null}

      <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !saving) setConfirmation(null); }}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus();
          else refreshButton.current?.focus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>确认{confirmation?.request.enabled ? "启用" : "禁用"} Hook</AlertDialogTitle>
            <AlertDialogDescription>只保存这条 Hook 的启用设置，信任记录保持不变。影响使用同一 Codex 目录的客户端；请在新会话中验证。</AlertDialogDescription>
          </AlertDialogHeader>
          {confirmation ? <dl className="grid gap-3 text-sm">
            <HookDetail label="事件与来源" value={hookEventLabel(confirmation.hook.eventName) + " · " + hookSource(confirmation.hook)} />
            <HookDetail label="操作内容" value={hookOperation(confirmation.hook)} mono />
            <HookDetail label="定义来源" value={confirmation.hook.sourcePath} mono />
            <HookDetail label="变更" value={(confirmation.hook.enabled ? "启用" : "禁用") + " → " + (confirmation.request.enabled ? "启用" : "禁用")} />
            <HookDetail label="用户配置路径" value={confirmation.configPath} mono />
          </dl> : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button disabled={saving} type="button" variant="outline">取消</Button></AlertDialogCancel>
            <AlertDialogAction asChild><Button disabled={saving || scanning} onClick={async (event) => {
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

function HookDetail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={"mt-1 whitespace-pre-wrap break-all " + (mono ? "font-mono text-xs" : "text-sm")}>{value}</dd></div>;
}
