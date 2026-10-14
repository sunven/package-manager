import type { CodexMarketplaceScan } from "../codexMarketplaces";

export function codexMarketplaceFixture(): CodexMarketplaceScan {
  return {
    snapshotId: "market-scan-1", directory: "/Users/example/.codex", configPath: "/Users/example/.codex/config.toml",
    status: "Ready", message: null, configError: null,
    marketplaces: [
      { id: "team-tools", name: "team-tools", root: "/Users/example/.codex/.tmp/marketplaces/team-tools", sourceKind: "git", source: "https://example.test/developer-tools/plugins.git", readOnlyReason: null },
      { id: "local-tools", name: "local-tools", root: "/Users/example/Developer/local-tools", sourceKind: "local", source: "/Users/example/Developer/local-tools", readOnlyReason: null },
      { id: "managed-tools", name: "managed-tools", root: "/Users/example/.codex/managed-tools", sourceKind: null, source: null, readOnlyReason: "默认、受管理或无法确认属于当前用户配置的来源，仅供查看。" },
    ],
  };
}
