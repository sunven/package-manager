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
};

export type CodexHookChangeRequest = {
  snapshotId: string;
  key: string;
  enabled: boolean;
};

export type CodexHookChangeResult = {
  status: "Saved" | "Conflict" | "Failed";
  message: string;
};

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
