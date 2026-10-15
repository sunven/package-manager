import type { CodexHook, CodexHookScan } from "../codexHooks";

// Synthetic review/test data only; never a production fallback.
export function codexHookFixture(overrides: Partial<CodexHook> = {}): CodexHook {
  return {
    key: "/Users/example/.codex/hooks.json:stop:0:0", currentHash: "sha256:fixture",
    eventName: "stop", handlerType: "command", source: "user",
    sourcePath: "/Users/example/.codex/hooks.json", pluginId: null,
    enabled: true, isManaged: false, trustStatus: "trusted", displayOrder: 0,
    matcher: null, timeoutSec: 30, statusMessage: "完成后通知",
    additionalContextLimit: null, command: "/Users/example/scripts/notify.sh",
    server: null, tool: null, async: false, readOnlyReason: null, ...overrides,
  };
}

export function codexHookScanFixture(): CodexHookScan {
  return {
    snapshotId: "hooks-1", directory: "/Users/example/.codex",
    configPath: "/Users/example/.codex/config.toml", status: "Ready",
    featureEnabled: true, warnings: [], configError: null, message: null,
    hooks: [
      codexHookFixture(),
      codexHookFixture({
        key: "/plugins/review/hooks.json:postToolUse:0:0", eventName: "postToolUse",
        source: "plugin", sourcePath: "/Users/example/.codex/plugins/cache/team-tools/review/local/hooks/hooks.json",
        pluginId: "review@team-tools", statusMessage: "检查文件变更",
        command: "/Users/example/.codex/plugins/cache/team-tools/review/local/scripts/check.sh",
        matcher: "Edit|Write|apply_patch", enabled: false, displayOrder: 1,
      }),
      codexHookFixture({
        key: "/Users/example/.codex/config.toml:sessionStart:0:0", eventName: "sessionStart",
        sourcePath: "/Users/example/.codex/config.toml", statusMessage: "加载项目上下文",
        handlerType: "mcpTool", server: "workspace", tool: "load_context", command: null,
        trustStatus: "untrusted", readOnlyReason: "待信任：请在 Codex 的 Hooks 界面审查，再刷新此页。",
        displayOrder: 2,
      }),
    ],
  };
}

export function codexHookDefinitionScanFixture(): CodexHookScan {
  const scan = codexHookScanFixture();
  scan.definitions = {
    snapshotId: "definitions-1", defaultSource: null, readOnlyReason: null,
    sources: [
      { format: "json", path: scan.directory + "/hooks.json", hasDefinitions: true, error: null },
      { format: "toml", path: scan.configPath, hasDefinitions: true, error: null },
    ],
    entries: scan.hooks.filter((hook) => hook.source === "user").map((hook) => ({
      id: hook.handlerType === "command" ? "hooks.json:Stop:0:0" : "config.toml:SessionStart:0:0",
      source: hook.handlerType === "command" ? "json" : "toml", sourcePath: hook.sourcePath,
      event: hook.eventName[0].toUpperCase() + hook.eventName.slice(1), matcher: hook.matcher,
      handler: hook.handlerType === "command" ? {
        type: "command", command: hook.command, commandWindows: "powershell -File C:\\scripts\\notify.ps1",
        statusMessage: hook.statusMessage, timeout: 30,
      } : { type: "mcp_tool", server: hook.server, tool: hook.tool, input: { project: "${cwd}", options: { concise: true } } },
      nativeKey: hook.key, enabled: hook.enabled, trustStatus: hook.trustStatus, readOnlyReason: null,
    })),
  };
  return scan;
}
