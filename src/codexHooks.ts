export type CodexHook = {
  key: string;
  currentHash: string;
  eventName: string;
  handlerType: string;
  source: string;
  sourcePath: string;
  pluginId: string | null;
  enabled: boolean;
  isManaged: boolean;
  trustStatus: string;
  displayOrder: number;
  matcher: string | null;
  timeoutSec: number;
  statusMessage: string | null;
  additionalContextLimit: number | null;
  command: string | null;
  server: string | null;
  tool: string | null;
  async: boolean;
  readOnlyReason: string | null;
};

export type CodexHookScan = {
  snapshotId: string | null;
  directory: string;
  configPath: string;
  status: "Ready" | "MissingCli" | "Incompatible" | "Failed";
  featureEnabled: boolean | null;
  hooks: CodexHook[];
  warnings: string[];
  configError: string | null;
  message: string | null;
  definitions?: CodexHookDefinitions | null;
};

export type CodexHookChangeRequest = {
  snapshotId: string;
  key: string;
  enabled: boolean;
};

export type CodexHookChangeResult = {
  status: "Saved" | "Conflict" | "Failed" | "Partial";
  message: string;
};

export type HookSourceFormat = "json" | "toml";
export type CodexHookDefinition = {
  id: string;
  source: HookSourceFormat;
  sourcePath: string;
  event: string;
  matcher: string | null;
  handler: Record<string, unknown>;
  nativeKey: string | null;
  enabled: boolean | null;
  trustStatus: string;
  readOnlyReason: string | null;
};

export type CodexHookDefinitions = {
  snapshotId: string | null;
  entries: CodexHookDefinition[];
  sources: { format: HookSourceFormat; path: string; hasDefinitions: boolean; error: string | null }[];
  defaultSource: HookSourceFormat | null;
  readOnlyReason: string | null;
};

export type HookDefinitionFields = {
  kind: "command" | "mcp_tool";
  command?: string | null;
  commandWindows?: string | null;
  server?: string | null;
  tool?: string | null;
  input?: Record<string, unknown> | null;
  timeout?: number | null;
  statusMessage?: string | null;
  async?: boolean | null;
  additionalContextLimit?: number | null;
};

export type HookDefinitionRequest = {
  snapshotId: string;
  action: "create" | "update" | "delete";
  source: HookSourceFormat;
  id?: string | null;
  event?: string;
  matcher?: string | null;
  fields?: HookDefinitionFields;
  enabled?: boolean;
};

export type HookDefinitionPreview = {
  planId: string;
  action: "create" | "update" | "delete";
  sourcePath: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  enabled: boolean | null;
  impacts: { event: string; operation: string; enabled: boolean; target: boolean }[];
};

export const hookEvents = ["SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "Stop", "Interrupt"] as const;

export function definitionHook(definition: CodexHookDefinition): CodexHook {
  const raw = definition.handler;
  return {
    key: definition.nativeKey ?? definition.id, currentHash: "", eventName: definition.event,
    handlerType: raw.type === "mcp_tool" ? "mcpTool" : String(raw.type), source: "user",
    sourcePath: definition.sourcePath, pluginId: null, enabled: definition.enabled ?? false,
    isManaged: false, trustStatus: definition.trustStatus, displayOrder: 0, matcher: definition.matcher,
    timeoutSec: typeof raw.timeout === "number" ? raw.timeout : ["SessionEnd", "Interrupt"].includes(definition.event) ? 1 : 600,
    statusMessage: typeof raw.statusMessage === "string" ? raw.statusMessage : null,
    command: typeof raw.command === "string" ? raw.command : null,
    server: typeof raw.server === "string" ? raw.server : null, tool: typeof raw.tool === "string" ? raw.tool : null,
    additionalContextLimit: typeof raw.additionalContextLimit === "number" ? raw.additionalContextLimit : null,
    async: raw.async === true, readOnlyReason: definition.readOnlyReason ?? (definition.enabled === null
      ? "原生启停状态尚未确认。" : definition.trustStatus === "trusted" ? null : "请在 Codex 中审查信任后启停。"),
  };
}

export function hookEventLabel(event: string) {
  return event ? event[0].toUpperCase() + event.slice(1) : "未知事件";
}

export function hookTrustLabel(trust: string) {
  return ({ trusted: "已信任", untrusted: "待信任", modified: "定义已修改", managed: "策略信任" } as Record<string, string>)[trust] ?? "信任状态未知";
}

export function hookOperation(hook: CodexHook) {
  if (hook.handlerType === "command") return hook.command || "未提供命令";
  if (hook.handlerType === "mcpTool") return (hook.server ?? "未知服务") + " / " + (hook.tool ?? "未知工具");
  return hook.handlerType + "（当前不可管理）";
}

export function hookSource(hook: CodexHook) {
  return hook.source === "user" ? "用户配置" : hook.pluginId || "来源未知";
}
