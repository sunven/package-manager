import { useState } from "react";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import type { ClaudeHook, ClaudeHookDraft, ClaudeHookPreview, ClaudeHookScan, ClaudeHookType } from "../claudeCode";
import { claudeHookHandler } from "../claudeCode";
import type { ClaudeWorkflowState } from "../hooks/useClaudeWorkflow";
import { errorToString } from "../utils/format";

const control = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";
const raw = "max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed";
type Field = { key: string; label: string; kind?: "json" | "boolean" | "number" | "multiline"; choices?: string[]; required?: boolean };
const fields: Record<ClaudeHookType, Field[]> = {
  command: [{ key: "command", label: "命令或可执行文件", required: true, kind: "multiline" }, { key: "args", label: "参数数组（JSON，可选）", kind: "json" }, { key: "shell", label: "Shell（可选）", choices: ["bash", "powershell"] }, { key: "async", label: "后台执行", kind: "boolean" }, { key: "asyncRewake", label: "后台执行并唤醒 Claude", kind: "boolean" }],
  http: [{ key: "url", label: "HTTP URL", required: true }, { key: "headers", label: "请求头（JSON 对象，可选）", kind: "json" }, { key: "allowedEnvVars", label: "允许插值的环境变量（JSON 数组，可选）", kind: "json" }],
  mcp_tool: [{ key: "server", label: "MCP server", required: true }, { key: "tool", label: "MCP tool", required: true }, { key: "input", label: "MCP input（JSON 对象，可选）", kind: "json" }],
  prompt: [{ key: "prompt", label: "提示词", required: true, kind: "multiline" }, { key: "model", label: "模型（可选）" }, { key: "continueOnBlock", label: "返回阻止时继续", kind: "boolean" }],
  agent: [{ key: "prompt", label: "代理提示词", required: true, kind: "multiline" }, { key: "model", label: "模型（可选）" }],
};
const common: Field[] = [{ key: "timeout", label: "超时（秒，可选）", kind: "number" }, { key: "statusMessage", label: "运行提示（可选）" }, { key: "if", label: "工具权限匹配条件 if（可选）" }, { key: "onFailure", label: "失败时的处理（可选）", choices: ["continue", "block"] }];
const managed = new Set(["type", ...Object.values(fields).flat().map((f) => f.key), ...common.map((f) => f.key)]);
const initial = (handler: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(handler).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value, null, 2)]));

export type ClaudeHookSelection = { action: "Create" | "Edit" | "Delete"; hook?: ClaudeHook };

export function ClaudeHookEditor({ selection, scan, state, onClose, onRestoreFocus }: {
  selection: ClaudeHookSelection; scan: ClaudeHookScan; state: ClaudeWorkflowState; onClose: () => void; onRestoreFocus: () => void;
}) {
  const [basis, setBasis] = useState(selection.hook);
  const [snapshotId, setSnapshotId] = useState(scan.snapshotId);
  const [event, setEvent] = useState(selection.hook?.event ?? "PreToolUse");
  const [matcher, setMatcher] = useState(selection.hook?.matcher ?? "");
  const [kind, setKind] = useState<ClaudeHookType>((claudeHookHandler(selection.hook?.handler).type as ClaudeHookType) ?? "command");
  const [values, setValues] = useState<Record<string, string>>(() => initial(claudeHookHandler(selection.hook?.handler)));
  const [preview, setPreview] = useState<ClaudeHookPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const schema = scan.events.find((e) => e.name === event);
  const deleting = selection.action === "Delete";
  const busy = working || state.busy;
  const stale = snapshotId !== scan.snapshotId;
  const background = values.async === "true" || values.asyncRewake === "true";
  const activeFields = [...fields[kind], ...common].filter((field) => {
    if (field.key === "if") return schema?.condition;
    if (field.key === "onFailure") return schema?.failure && !background && (kind === "command" || kind === "http");
    if (field.key === "timeout") return !background || kind !== "command";
    if (field.key === "shell") return !values.args?.trim();
    return true;
  });

  function draft(): ClaudeHookDraft {
    const original = claudeHookHandler(basis?.handler);
    const handler = Object.fromEntries(Object.entries(original).filter(([key]) => !managed.has(key)));
    handler.type = kind;
    if (!schema?.types.includes(kind)) throw new Error("此事件不支持所选 Hook 类型。");
    for (const field of activeFields) {
      const value = values[field.key] ?? "";
      if (!value && !field.required) { if (original[field.key] === "") handler[field.key] = ""; continue; }
      if (field.required && !value.trim()) throw new Error(`请填写${field.label}。`);
      if (field.kind === "json") {
        try { handler[field.key] = JSON.parse(value); } catch { throw new Error(`${field.label}不是有效 JSON。`); }
      } else if (field.kind === "number") {
        const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error("超时必须是正数。"); handler[field.key] = number;
      } else if (field.kind === "boolean") handler[field.key] = value === "true";
      else handler[field.key] = value;
    }
    if (schema.matcher && matcher && matcher !== "*") { try { new RegExp(matcher); } catch { throw new Error("匹配条件不是有效的 JavaScript 正则表达式。"); } }
    return { event, matcher: schema.matcher && (matcher || basis?.matcher === "") ? matcher : null, handler };
  }

  async function prepare() {
    setError(null); setWorking(true);
    try {
      if (!snapshotId || stale) throw new Error("请重新读取并采用当前定义清单，再预览变更。");
      setPreview(await state.prepareHook({ snapshotId, action: selection.action, hookId: basis?.id, ...(deleting ? {} : { draft: draft() }) }));
    } catch (e) { setError(errorToString(e)); }
    finally { setWorking(false); }
  }

  function close() {
    if (preview) state.cancelHookPreview(preview.previewId);
    onClose();
  }

  async function rebase() {
    setError(null); setPreview(null); setWorking(true);
    try {
      if (preview) state.cancelHookPreview(preview.previewId);
      const next = await state.refresh("hooks");
      if (!next?.snapshotId) throw new Error(next?.writeBlockedReason ?? "当前定义不可维护。");
      if (basis) {
        const matches = next.hooks.filter((hook) => !hook.pluginId && hook.event === basis.event && hook.matcher === basis.matcher && JSON.stringify(hook.handler) === JSON.stringify(basis.handler));
        if (matches.length !== 1) throw new Error("原定义已变化或不唯一。草稿仍在表单中，请核对后关闭并重新选择目标。");
        setBasis(matches[0]);
      }
      setSnapshotId(next.snapshotId);
    } catch (e) { setError(errorToString(e)); }
    finally { setWorking(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto" showCloseButton={!busy} onInteractOutside={(e) => e.preventDefault()} onCloseAutoFocus={(e) => { e.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader><DialogTitle>{preview ? deleting ? "确认删除 Hook" : "确认保存 Hook" : deleting ? "删除 Hook" : selection.action === "Create" ? "新增 Hook" : "编辑 Hook"}</DialogTitle><DialogDescription>维护当前用户定义，保存后在 Claude 中核对加载结果。引用脚本与用户总开关会保留。</DialogDescription></DialogHeader>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {scan.writeBlockedReason ? <Alert><AlertDescription>{scan.writeBlockedReason}</AlertDescription></Alert> : null}
      {stale ? <p className="text-sm text-muted-foreground">清单已变化。重新读取会保留草稿，并复核原定义是否仍可唯一定位。</p> : null}
      <p className="break-all font-mono text-xs text-muted-foreground">{scan.configPath}</p>
      {preview ? <div className="grid gap-3"><p className="text-sm">{preview.message}</p><div className="grid gap-3 sm:grid-cols-2"><div><h3 className="mb-2 text-sm font-medium">变更前</h3><pre className={raw}>{preview.before ? JSON.stringify(preview.before, null, 2) : "新建定义"}</pre></div><div><h3 className="mb-2 text-sm font-medium">变更后</h3><pre className={raw}>{preview.after ? JSON.stringify(preview.after, null, 2) : "删除此定义"}</pre></div></div></div> : deleting ? <pre className={raw}>{JSON.stringify(basis, null, 2)}</pre> : <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">事件<select className={control} value={event} disabled={busy} onChange={(e) => setEvent(e.target.value)}>{scan.events.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Hook 类型<select className={control} value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as ClaudeHookType)}>{Object.keys(fields).map((type) => <option key={type} value={type} disabled={!schema?.types.includes(type as ClaudeHookType)}>{type}</option>)}</select></label></div>
        {schema?.matcher ? <label className="grid gap-1 text-sm">匹配条件（可选）<Input value={matcher} disabled={busy} onChange={(e) => setMatcher(e.target.value)} placeholder="例如 Bash 或 Edit|Write" /><span className="text-xs text-muted-foreground">留空匹配全部；支持原生字符串、列表或 JavaScript 正则表达式。</span></label> : null}
        {kind === "agent" ? <p className="text-xs text-muted-foreground">agent Hook 是 Claude 的实验性能力，原生行为可能变化。</p> : null}
        {kind === "mcp_tool" && (event === "Setup" || event === "SessionStart") ? <p className="text-xs text-muted-foreground">启动和 Setup 时 MCP 尚不可用，此 Hook 会跳过；SessionStart 在 clear 或 compact 后再次触发时才可能执行。</p> : null}
        {kind === "http" ? <p className="text-xs text-muted-foreground">请求头中的环境变量只有列入 allowedEnvVars 才会插值。</p> : null}
        {kind === "command" && values.args?.trim() ? <p className="text-xs text-muted-foreground">提供参数数组后，命令按可执行文件直接运行，不经过 Shell。</p> : null}
        {background && kind === "command" ? <p className="text-xs text-muted-foreground">后台命令不采用超时或失败阻止字段，保存时会移除这些无效组合。</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">{activeFields.map((field) => <label key={field.key} className={`grid content-start gap-1 text-sm ${field.kind === "json" || field.kind === "multiline" ? "sm:col-span-2" : ""}`}>{field.label}
          {field.kind === "json" || field.kind === "multiline" ? <textarea className={`${control} font-mono`} rows={field.kind === "json" ? 3 : 4} disabled={busy} value={values[field.key] ?? ""} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} />
            : field.choices || field.kind === "boolean" ? <select className={control} disabled={busy} value={values[field.key] ?? ""} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}><option value="">未指定（沿用原生默认）</option>{(field.choices ?? ["true", "false"]).map((choice) => <option key={choice} value={choice}>{choice === "true" ? "是" : choice === "false" ? "否" : choice}</option>)}</select>
            : <Input disabled={busy} type={field.kind === "number" ? "number" : "text"} min={field.kind === "number" ? "0.001" : undefined} step="any" value={values[field.key] ?? ""} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} />}
        </label>)}</div>
        {basis ? <details><summary className="cursor-pointer text-sm">查看原始处理程序（只读）</summary><pre className={`${raw} mt-2`}>{JSON.stringify(basis.handler, null, 2)}</pre></details> : null}
      </div>}
      <DialogFooter className="flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={close}>取消</Button>
        {error || stale ? <Button variant="outline" disabled={busy} onClick={() => void rebase()}>重新读取并保留草稿</Button> : null}
        {preview ? <><Button variant="outline" disabled={busy} onClick={() => { state.cancelHookPreview(preview.previewId); setPreview(null); }}>返回编辑</Button><Button disabled={busy || stale || Boolean(scan.writeBlockedReason)} onClick={async () => {
          setWorking(true); setError(null);
          try { const result = await state.commitHook(preview.previewId); if (result.status === "Succeeded") onClose(); else { setError(result.message); setPreview(null); } }
          catch (e) { setError(errorToString(e)); setPreview(null); }
          finally { setWorking(false); }
        }}>{busy ? "正在保存…" : deleting ? "确认删除" : "确认保存"}</Button></> : <Button disabled={busy || !snapshotId || stale || Boolean(scan.writeBlockedReason)} onClick={() => void prepare()}>{busy ? "正在准备…" : "预览变更"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
