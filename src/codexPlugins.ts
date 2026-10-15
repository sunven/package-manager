export type CodexPlugin = {
  pluginId: string;
  name: string;
  marketplaceName: string;
  version: string | null;
  installed: boolean;
  installPolicy: string | null;
  authPolicy: string | null;
  installBlockedReason: string | null;
  details: CodexPluginDetails;
  defaultEnabled: boolean | null;
  sourceKind: string | null;
  sourceLocation: string | null;
  marketplaceLocation: string | null;
  readOnlyReason: string | null;
};

export type CodexPluginDetails = {
  origin: "installed" | "source" | null;
  root: string | null;
  displayName: string | null;
  description: string | null;
  author: string | null;
  category: string | null;
  skills: string[] | null;
  mcpServers: string[] | null;
  hooks: string[] | null;
  messages: string[];
};

export type CodexPluginLifecycleRequest = {
  snapshotId: string;
  pluginId: string;
  operation: "Install" | "Reinstall" | "Uninstall";
};

export type CodexPluginScan = {
  snapshotId: string | null;
  directory: string;
  configPath: string;
  status: "Ready" | "MissingCli" | "Incompatible" | "Failed";
  plugins: CodexPlugin[];
  message: string | null;
  configError: string | null;
};

export type CodexPluginChangeRequest = {
  snapshotId: string;
  pluginId: string;
  enabled: boolean;
};

export type CodexPluginChangeResult = {
  status: "Saved" | "Succeeded" | "Conflict" | "Failed";
  message: string;
};

export function pluginDefaultLabel(enabled: boolean | null) {
  return enabled === null ? "未知（用户未显式设置）" : enabled ? "启用" : "禁用";
}
