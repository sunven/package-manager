import type { ClaudeHookScan, ClaudeMarketplaceScan, ClaudePluginScan } from "../claudeCode";

export function claudeMarketplacesFixture(): ClaudeMarketplaceScan {
  return {
    snapshotId: "claude-marketplaces-1", directory: "/Users/example/.claude", version: "2.1.300", status: "Ready", message: null, writeBlockedReason: null,
    marketplaces: [
      { name: "team-tools", sourceKind: "github", source: "example/developer-tools", root: "/Users/example/.claude/plugins/marketplaces/team-tools", refName: "main", sparsePaths: [], readOnlyReason: null, removeBlockedReason: null, affectedPlugins: ["reviewer@team-tools"] },
      { name: "project-shared", sourceKind: "git", source: "https://example.invalid/shared.git", root: "/Users/example/.claude/plugins/marketplaces/project-shared", refName: null, sparsePaths: [], readOnlyReason: null, removeBlockedReason: "此市场存在项目或其他作用域安装，移除可能连带卸载，已阻止。", affectedPlugins: [] },
    ],
  };
}

export function claudePluginFixture(): ClaudePluginScan {
  return {
    snapshotId: "claude-plugins-1", directory: "/Users/example/.claude", version: "2.1.300", status: "Ready", message: null, writeBlockedReason: null,
    plugins: [
      { id: "reviewer@team-tools", name: "reviewer", marketplaceName: "team-tools", installed: true, version: "1.2.0", enabled: false, userEnabled: false, source: "./plugins/reviewer", readOnlyReason: null,
        details: { origin: "installed", root: "/Users/example/.claude/plugins/cache/team-tools/reviewer/1.2.0", description: "检查代码变更，整理审查要点。", author: "Example team", skills: ["review-changes"], agents: ["reviewer.md"], mcpServers: [], hooks: ["PreToolUse"], messages: [] } },
      { id: "notes@team-tools", name: "notes", marketplaceName: "team-tools", installed: false, version: null, enabled: null, userEnabled: null, source: "https://example.invalid/notes.git", readOnlyReason: null,
        details: { origin: null, root: null, description: "整理项目笔记与变更记录。", author: null, skills: [], agents: [], mcpServers: [], hooks: [], messages: ["未下载本地内容，组件详情未知；不会为预览自动下载。"] } },
    ],
  };
}

export function claudeHookFixture(): ClaudeHookScan {
  return {
    snapshotId: "claude-hooks-1", directory: "/Users/example/.claude", configPath: "/Users/example/.claude/settings.json", version: "2.1.300", writeBlockedReason: null, disableAllHooks: true, messages: [],
    events: [
      { name: "PreToolUse", types: ["command", "http", "mcp_tool", "prompt", "agent"], matcher: true, condition: true, failure: true },
      { name: "Stop", types: ["command", "http", "mcp_tool", "prompt", "agent"], matcher: false, condition: false, failure: false },
      { name: "SessionStart", types: ["command", "mcp_tool"], matcher: true, condition: false, failure: true },
    ],
    hooks: [
      { id: "user:PreToolUse:0:0", event: "PreToolUse", matcher: "Bash", handler: { type: "command", command: "node /Users/example/scripts/check-command.js", timeout: 30, future: { keep: true } }, source: "/Users/example/.claude/settings.json", pluginId: null, pluginEnabled: null, readOnlyReason: null },
      { id: "plugin:reviewer:0", event: "PreToolUse", matcher: "Edit|Write", handler: { type: "prompt", prompt: "检查这次变更是否符合项目约定。" }, source: "/Users/example/.claude/plugins/cache/team-tools/reviewer/1.2.0/hooks/hooks.json", pluginId: "reviewer@team-tools", pluginEnabled: false, readOnlyReason: "插件声明仅供查看；随整个插件启停。" },
    ],
  };
}
