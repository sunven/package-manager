import { useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import {
  hookEvents, type CodexHookDefinition, type CodexHookDefinitions, type CodexHookChangeResult,
  type HookDefinitionFields, type HookDefinitionPreview, type HookDefinitionRequest, type HookSourceFormat,
} from "../codexHooks";
import { errorToString } from "../utils/format";

const control = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";
const rawText = "max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed";

export type HookEditorSelection = { action: "create" | "update" | "delete"; definition?: CodexHookDefinition };

function text(value: unknown) { return typeof value === "string" ? value : ""; }
function optional(value: string, original?: unknown) { return value || original === "" ? value : null; }

export function CodexHookEditor({ selection, definitions, busy, onClose, onRefresh, onPrepare, onCommit, onRestoreFocus }: {
  selection: HookEditorSelection;
  definitions: CodexHookDefinitions;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onPrepare: (request: HookDefinitionRequest) => Promise<HookDefinitionPreview>;
  onCommit: (planId: string) => Promise<CodexHookChangeResult>;
  onRestoreFocus: () => void;
}) {
  const definition = selection.definition;
  const [basis, setBasis] = useState(definition);
  const original = basis?.handler ?? {};
  const deleting = selection.action === "delete";
  const [snapshotId, setSnapshotId] = useState(definitions.snapshotId);
  const [source, setSource] = useState<HookSourceFormat | "">(() => definition?.source ?? definitions.defaultSource ?? "");
  const [event, setEvent] = useState(definition?.event ?? "SessionStart");
  const [matcher, setMatcher] = useState(definition?.matcher ?? "");
  const [kind, setKind] = useState<"command" | "mcp_tool">(original.type === "mcp_tool" ? "mcp_tool" : "command");
  const [command, setCommand] = useState(text(original.command));
  const [commandWindows, setCommandWindows] = useState(text(original.commandWindows ?? original.command_windows));
  const [server, setServer] = useState(text(original.server));
  const [tool, setTool] = useState(text(original.tool));
  const [input, setInput] = useState(original.input === undefined ? "" : JSON.stringify(original.input, null, 2));
  const [timeout, setTimeoutValue] = useState(original.timeout === undefined ? "" : String(original.timeout));
  const [statusMessage, setStatusMessage] = useState(text(original.statusMessage));
  const [asyncValue, setAsyncValue] = useState(original.async === undefined ? "" : String(original.async));
  const [contextLimit, setContextLimit] = useState(original.additionalContextLimit === undefined ? "" : String(original.additionalContextLimit));
  const [enabled, setEnabled] = useState(definition?.enabled ?? true);
  const [preview, setPreview] = useState<HookDefinitionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const processing = busy || working;
  const changedSnapshot = snapshotId !== definitions.snapshotId;
  const current = definition ? definitions.entries.find((entry) => entry.id === definition.id) : null;
  const unavailable = !definitions.snapshotId || Boolean(definitions.readOnlyReason) || Boolean(definition && !current);
  const title = preview ? deleting ? "确认删除 Hook" : "确认保存 Hook" : deleting ? "删除 Hook" : definition ? "编辑 Hook" : "新增 Hook";
  const supportsMatcher = !["Stop", "Interrupt", "UserPromptSubmit"].includes(event);
  const sourcePath = definitions.sources.find((item) => item.format === source)?.path;

  function number(value: string, label: string) {
    if (value === "") return null;
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result < 0) throw new Error(label + "必须是有效的非负整数。");
    return result;
  }

  async function prepare() {
    setError(null);
    try {
      if (!source || !snapshotId) throw new Error("请选择保存位置，并刷新可维护的定义清单。");
      let fields: HookDefinitionFields | undefined;
      if (!deleting) {
        let parsed: Record<string, unknown> | null = null;
        if (kind === "mcp_tool" && input.trim()) {
          try { parsed = JSON.parse(input); } catch { throw new Error("MCP input 不是有效的 JSON，请检查引号和逗号。"); }
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP input 必须是 JSON 对象。");
        }
        fields = {
          kind, statusMessage: optional(statusMessage, original.statusMessage), timeout: number(timeout, "超时"),
          ...(kind === "command" ? {
            command, commandWindows: optional(commandWindows, original.commandWindows ?? original.command_windows),
            async: asyncValue === "" ? null : asyncValue === "true", additionalContextLimit: number(contextLimit, "上下文限制"),
          } : { server, tool, input: parsed }),
        };
      }
      setWorking(true);
      setPreview(await onPrepare({ snapshotId, source, action: selection.action, id: definition?.id,
        ...(!deleting ? { event, matcher: supportsMatcher ? optional(matcher, basis?.matcher) : null, fields,
          ...(selection.action === "create" ? { enabled } : {}) } : {}) }));
    } catch (caught) {
      setError(errorToString(caught));
    } finally { setWorking(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !processing) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto" showCloseButton={!processing} onInteractOutside={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{deleting ? "只删除所选定义；引用的脚本和插件内容保持不变。" : "维护当前用户的 Hook 定义。保存后在 Codex 审查信任，并在新会话中验证。"}</DialogDescription>
      </DialogHeader>
      {error ? <Alert variant="destructive"><AlertTitle>尚未完成</AlertTitle><AlertDescription className="whitespace-pre-wrap break-words">{error}</AlertDescription></Alert> : null}
      {unavailable || changedSnapshot ? <Alert>
        <AlertTitle>请核对刷新后的定义</AlertTitle>
        <AlertDescription className="grid gap-2">
          <p>{definitions.readOnlyReason ?? (definition && !current ? "所选定义已不存在。表单内容保留在下方，请核对来源后重新选择。" : "表单内容已保留。配置快照已变化，重新检查前请核对当前定义及启用选择。")}</p>
          {current ? <><p>当前启用选择：{current.enabled === null ? "未知" : current.enabled ? "启用" : "禁用"}</p><pre className={rawText}>{JSON.stringify({ event: current.event, matcher: current.matcher, handler: current.handler }, null, 2)}</pre></> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={processing} onClick={onRefresh} size="sm" type="button" variant="outline">刷新定义清单</Button>
            {!unavailable && changedSnapshot ? <Button disabled={processing} onClick={() => { setSnapshotId(definitions.snapshotId); setBasis(current ?? definition); setPreview(null); setError(null); }} size="sm" type="button" variant="outline">已核对，使用当前定义重新检查</Button> : null}
          </div>
        </AlertDescription>
      </Alert> : null}

      {preview ? <div className="grid min-w-0 gap-4">
        <div className="text-xs"><span className="text-muted-foreground">保存位置</span><code className="mt-1 block break-all">{preview.sourcePath}</code></div>
        {preview.enabled !== null ? <p className="text-sm">保存后的启用选择：<strong>{preview.enabled ? "启用" : "禁用"}</strong>；信任仍需在 Codex 审查。</p> : null}
        <div className={"grid min-w-0 gap-3" + (preview.before && preview.after ? " sm:grid-cols-2" : "")}>
          {preview.before ? <div className="min-w-0"><h3 className="mb-2 text-sm font-medium">{deleting ? "将删除的定义" : "当前定义"}</h3><pre className={rawText}>{JSON.stringify(preview.before, null, 2)}</pre></div> : null}
          {preview.after ? <div className="min-w-0"><h3 className="mb-2 text-sm font-medium">保存后的定义</h3><pre className={rawText}>{JSON.stringify(preview.after, null, 2)}</pre></div> : null}
        </div>
        {preview.impacts.length ? <div><h3 className="mb-2 text-sm font-medium">受影响的条目</h3><ul className="divide-y rounded-md border px-3">
          {preview.impacts.map((impact, index) => <li className="py-2 text-sm" key={index}>
            <p className="font-medium">{impact.event} · {impact.target && deleting ? "将删除" : `${impact.enabled ? "保持启用" : "保持禁用"}，需重新审查`}</p>
            <code className="mt-1 block break-all text-xs text-muted-foreground">{impact.operation}</code>
          </li>)}
        </ul></div> : null}
        <p className="text-xs text-muted-foreground">其他条目的定义和启用选择保持不变。身份变化的条目会撤销旧信任，不会自动获得信任。</p>
        <DialogFooter>
          <Button disabled={processing} onClick={() => setPreview(null)} type="button" variant="outline">{deleting ? "返回" : "返回编辑"}</Button>
          <Button disabled={processing || unavailable || changedSnapshot} variant={deleting ? "destructive" : "default"} type="button" onClick={async () => {
            setWorking(true); setError(null);
            try {
              const result = await onCommit(preview.planId);
              if (result.status === "Saved") onClose();
              else { setError(result.message); setPreview(null); }
            } catch (caught) { setError(errorToString(caught)); setPreview(null); }
            finally { setWorking(false); }
          }}>{processing ? "正在保存…" : deleting ? "确认删除" : "确认保存"}</Button>
        </DialogFooter>
      </div> : <form className="grid min-w-0 gap-4" onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
        {deleting ? <pre className={rawText}>{JSON.stringify({ event: basis?.event, matcher: basis?.matcher, handler: original }, null, 2)}</pre> : <fieldset disabled={processing} className="grid min-w-0 gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="保存位置"><select className={control} required value={source} disabled={Boolean(definition)} onChange={(event) => setSource(event.target.value as HookSourceFormat)}>
              <option value="" disabled>请选择保存位置</option>{definitions.sources.map((s) => <option value={s.format} key={s.format} disabled={Boolean(s.error)}>{s.format === "json" ? "hooks.json" : "config.toml"}</option>)}
            </select></Field>
            <Field label="事件"><select className={control} value={event} onChange={(e) => setEvent(e.target.value)}>{hookEvents.map((e) => <option key={e}>{e}</option>)}</select></Field>
          </div>
          <code className="-mt-2 break-all text-xs text-muted-foreground">{sourcePath ?? "两种来源均有定义，请明确选择本次保存位置。"}</code>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="处理类型"><select className={control} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="command">命令（command）</option><option value="mcp_tool">MCP 工具（mcp_tool）</option></select></Field>
            {supportsMatcher ? <Field label="匹配条件（可选）"><Input value={matcher} onChange={(e) => setMatcher(e.target.value)} placeholder="正则表达式，例如 Bash|Edit" /></Field> : <p className="self-center text-xs text-muted-foreground">此事件不使用匹配条件。</p>}
          </div>
          {kind === "command" ? <Field label="命令"><textarea className={control + " min-h-24 font-mono text-xs"} required value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} /></Field> : <>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="MCP 服务"><Input required value={server} onChange={(e) => setServer(e.target.value)} /></Field><Field label="MCP 工具"><Input required value={tool} onChange={(e) => setTool(e.target.value)} /></Field></div>
            <Field label="MCP input（可选 JSON 对象）"><textarea className={control + " min-h-28 font-mono text-xs"} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder="{}" /></Field>
            <p className="-mt-2 text-xs text-muted-foreground">使用 Codex 已连接的 MCP 服务；保存时不连接服务或运行工具。</p>
            {event === "SessionEnd" ? <p className="text-sm text-destructive" role="alert">SessionEnd 不支持 MCP Hook，请更换事件或处理类型。</p> : null}
          </>}
          <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">高级选项</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="超时（秒，可选）"><Input type="number" min="1" max={["SessionEnd", "Interrupt"].includes(event) ? 3 : undefined} step="1" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} placeholder={["SessionEnd", "Interrupt"].includes(event) ? "默认 1，最多 3" : "默认 600"} /></Field>
            <Field label="状态提示（可选）"><Input value={statusMessage} onChange={(e) => setStatusMessage(e.target.value)} /></Field>
            {kind === "command" ? <>
              <Field label="执行方式"><select className={control} value={asyncValue} onChange={(e) => setAsyncValue(e.target.value)}><option value="">未指定（Codex 默认）</option><option value="false">同步</option><option value="true">异步</option></select></Field>
              <Field label="上下文限制（可选）"><Input type="number" min="0" step="1" value={contextLimit} onChange={(e) => setContextLimit(e.target.value)} /></Field>
              <div className="sm:col-span-2"><Field label="Windows 命令（可选）"><textarea className={control + " min-h-20 font-mono text-xs"} value={commandWindows} onChange={(e) => setCommandWindows(e.target.value)} spellCheck={false} /></Field></div>
            </> : null}
          </div></details>
          {basis ? <p className="text-xs text-muted-foreground">保留原启用选择：{basis.enabled ? "启用" : "禁用"}。定义变更后需重新审查信任。</p> : <label className="flex items-start gap-2 text-sm"><input className="mt-1 accent-primary" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>保存为启用<span className="mt-1 block text-xs text-muted-foreground">启用选择与信任独立；可取消以禁用状态保存。</span></span></label>}
          {basis ? <details className="min-w-0"><summary className="cursor-pointer text-xs text-muted-foreground">原始定义（只读）</summary><pre className={rawText + " mt-2"}>{JSON.stringify({ event: basis.event, matcher: basis.matcher, handler: original }, null, 2)}</pre></details> : null}
        </fieldset>}
        <DialogFooter>
          {(error && !changedSnapshot) ? <Button disabled={processing} onClick={onRefresh} type="button" variant="outline">刷新定义清单</Button> : null}
          <Button disabled={processing} onClick={onClose} type="button" variant="outline">取消</Button>
          <Button disabled={processing || unavailable || changedSnapshot || (!deleting && kind === "mcp_tool" && event === "SessionEnd")} type="submit">{processing ? "正在核实…" : deleting ? "检查删除影响" : "检查变更"}</Button>
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}
