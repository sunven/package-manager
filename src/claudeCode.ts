export type ClaudeMarketplace = {
  name: string; sourceKind: string; source: string | null; root: string | null;
  refName: string | null; sparsePaths: string[]; readOnlyReason: string | null;
  removeBlockedReason: string | null; affectedPlugins: string[];
};

export type ClaudePlugin = {
  id: string; name: string; marketplaceName: string; installed: boolean; version: string | null;
  enabled: boolean | null; userEnabled: boolean | null; source: string | null; readOnlyReason: string | null;
  details: {
    origin: string | null; root: string | null; description: string | null; author: string | null;
    skills: string[]; agents: string[]; mcpServers: string[]; hooks: string[]; messages: string[];
  };
};

export type ClaudeMarketplaceScan = {
  snapshotId: string | null; directory: string; version: string | null; status: string;
  message: string | null; writeBlockedReason: string | null; marketplaces: ClaudeMarketplace[];
};

export type ClaudePluginScan = {
  snapshotId: string | null; directory: string; version: string | null; status: string;
  message: string | null; writeBlockedReason: string | null; plugins: ClaudePlugin[];
};

export type ClaudeOperation = "AddMarket" | "UpdateMarket" | "RemoveMarket" | "Install" | "Update" | "Uninstall" | "Enable" | "Disable";
export function isMarketOperation(operation: ClaudeOperation) {
  return operation === "AddMarket" || operation === "UpdateMarket" || operation === "RemoveMarket";
}
export type ClaudeChangeRequest = {
  snapshotId: string; operation: ClaudeOperation; target?: string; source?: string;
  sourceKind?: "git" | "local" | "url"; refName?: string; sparsePaths?: string[];
};
export type ClaudeChangeResult = { status: "Succeeded" | "Failed" | "Conflict" | "Unconfirmed"; message: string; executed: boolean };

export type ClaudeHookType = "command" | "http" | "mcp_tool" | "prompt" | "agent";
export type ClaudeEventSchema = { name: string; types: ClaudeHookType[]; matcher: boolean; condition: boolean; failure: boolean };
export type ClaudeHook = {
  id: string; event: string; matcher: string | null; handler: unknown;
  source: string; pluginId: string | null; pluginEnabled: boolean | null; readOnlyReason: string | null;
};
export type ClaudeHookScan = {
  snapshotId: string | null; directory: string; configPath: string; version: string | null;
  writeBlockedReason: string | null; disableAllHooks: boolean | null;
  hooks: ClaudeHook[]; events: ClaudeEventSchema[]; messages: string[];
};
export type ClaudeHookDraft = { event: string; matcher: string | null; handler: Record<string, unknown> };
export type ClaudeHookRequest = { snapshotId: string; action: "Create" | "Edit" | "Delete"; hookId?: string; draft?: ClaudeHookDraft };
export type ClaudeHookPreview = { previewId: string; source: string; before: unknown; after: unknown; message: string };

export const claudeOperationLabel: Record<ClaudeOperation, string> = {
  AddMarket: "添加市场", UpdateMarket: "更新市场目录", RemoveMarket: "移除市场",
  Install: "安装", Update: "更新插件", Uninstall: "卸载", Enable: "启用", Disable: "禁用",
};
export function claudeSourceLabel(kind: string) {
  return ({ github: "GitHub", git: "Git 仓库", url: "远程 JSON", directory: "本地目录", file: "本地 JSON", claudeai: "账户托管" } as Record<string, string>)[kind] ?? "未知来源";
}
export function claudeHookHandler(handler: unknown): Record<string, unknown> {
  return handler !== null && typeof handler === "object" && !Array.isArray(handler) ? handler as Record<string, unknown> : {};
}
export function claudeHookSummary(hook: ClaudeHook) {
  const h = claudeHookHandler(hook.handler);
  return String(h.command ?? h.url ?? (h.type === "mcp_tool" ? `${h.server ?? "?"} / ${h.tool ?? "?"}` : h.prompt ?? "未知处理程序"));
}
