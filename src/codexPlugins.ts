export type CodexPlugin = {
  pluginId: string;
  name: string;
  marketplaceName: string;
  version: string | null;
  defaultEnabled: boolean | null;
  sourceKind: string | null;
  sourceLocation: string | null;
  marketplaceLocation: string | null;
  readOnlyReason: string | null;
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
  status: "Saved" | "Conflict" | "Failed";
  message: string;
};

export function pluginDefaultLabel(enabled: boolean | null) {
  return enabled === null ? "未知（用户未显式设置）" : enabled ? "启用" : "禁用";
}
