import type { CodexPluginScan } from "../codexPlugins";

// Synthetic data for tests and browser review; never used as a production fallback.
export function codexPluginFixture(): CodexPluginScan {
  return {
    snapshotId: "scan-1",
    directory: "/Users/example/.codex",
    configPath: "/Users/example/.codex/config.toml",
    status: "Ready",
    message: null,
    configError: null,
    plugins: [
      { pluginId: "writer@personal", name: "writer", marketplaceName: "personal", version: "1.2.0", defaultEnabled: true, sourceKind: "git", sourceLocation: "https://example.com/plugins/writer", marketplaceLocation: "https://example.com/personal-catalog", readOnlyReason: null },
      { pluginId: "writer@community", name: "writer", marketplaceName: "community", version: null, defaultEnabled: null, sourceKind: "local", sourceLocation: "/Users/example/Developer/plugins/writer", marketplaceLocation: "/Users/example/.agents/plugins/marketplace.json", readOnlyReason: null },
      { pluginId: "code-review@personal", name: "code-review", marketplaceName: "personal", version: "2.0.0", defaultEnabled: false, sourceKind: "local", sourceLocation: "/Users/example/Developer/plugins/code-review", marketplaceLocation: "https://example.com/personal-catalog", readOnlyReason: null },
    ].map((plugin) => ({ ...plugin, installed: true, installPolicy: "AVAILABLE", authPolicy: "ON_INSTALL", installBlockedReason: null,
      details: { origin: null, root: null, displayName: null, description: null, author: null, category: null, skills: null, mcpServers: null, hooks: null, messages: ["详情尚不可读取。"] },
    })),
  };
}
