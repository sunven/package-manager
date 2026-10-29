export type ObservationGroupId =
  | "managers"
  | "environment"
  | "project"
  | "vscode"
  | "sessions"
  | "codex"
  | "claude";

export type ObservationItemId =
  | "manager:npm"
  | "manager:pnpm"
  | "manager:yarn"
  | "manager:nvm"
  | "manager:homebrew"
  | "manager:maven"
  | "manager:pip"
  | "manager:cargo"
  | "manager:docker"
  | "manager:bun"
  | "manager:uv"
  | "manager:fvm"
  | "environment"
  | "project-scan"
  | "vscode-storage"
  | "session:codex"
  | "session:claude"
  | "session:opencode"
  | "session:grok"
  | "session:qoder"
  | "session:qoder-cn"
  | "codex:marketplaces"
  | "codex:plugins"
  | "codex:hooks"
  | "codex:skills"
  | "claude:extensions"
  | "claude:hooks"
  | "claude:skills";

export interface ObservationItem {
  id: ObservationItemId;
  group: ObservationGroupId;
  label: string;
}

export const OBSERVATION_GROUPS: { id: ObservationGroupId; label: string }[] = [
  { id: "managers", label: "管理器" },
  { id: "environment", label: "环境诊断" },
  { id: "project", label: "项目派生数据" },
  { id: "vscode", label: "VS Code 工作区存储" },
  { id: "sessions", label: "会话记录" },
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
];

export const OBSERVATION_ITEMS: ObservationItem[] = [
  { id: "manager:npm", group: "managers", label: "npm" },
  { id: "manager:pnpm", group: "managers", label: "pnpm" },
  { id: "manager:yarn", group: "managers", label: "Yarn" },
  { id: "manager:nvm", group: "managers", label: "nvm" },
  { id: "manager:homebrew", group: "managers", label: "Homebrew" },
  { id: "manager:maven", group: "managers", label: "Maven" },
  { id: "manager:pip", group: "managers", label: "pip" },
  { id: "manager:cargo", group: "managers", label: "Cargo" },
  { id: "manager:docker", group: "managers", label: "Docker" },
  { id: "manager:bun", group: "managers", label: "Bun" },
  { id: "manager:uv", group: "managers", label: "uv" },
  { id: "manager:fvm", group: "managers", label: "FVM" },
  { id: "environment", group: "environment", label: "环境诊断" },
  { id: "project-scan", group: "project", label: "项目派生数据扫描" },
  { id: "vscode-storage", group: "vscode", label: "VS Code 工作区存储" },
  { id: "session:codex", group: "sessions", label: "Codex 会话记录" },
  { id: "session:claude", group: "sessions", label: "Claude 会话记录" },
  { id: "session:opencode", group: "sessions", label: "OpenCode 会话记录" },
  { id: "session:grok", group: "sessions", label: "Grok Build 会话记录" },
  { id: "session:qoder", group: "sessions", label: "Qoder 会话记录" },
  { id: "session:qoder-cn", group: "sessions", label: "Qoder CN 会话记录" },
  { id: "codex:marketplaces", group: "codex", label: "Codex 市场" },
  { id: "codex:plugins", group: "codex", label: "Codex 插件" },
  { id: "codex:hooks", group: "codex", label: "Codex Hooks" },
  { id: "codex:skills", group: "codex", label: "Codex Skills" },
  { id: "claude:extensions", group: "claude", label: "Claude 市场与插件" },
  { id: "claude:hooks", group: "claude", label: "Claude Hooks" },
  { id: "claude:skills", group: "claude", label: "Claude Skills" },
];

export const OBSERVATION_ITEM_BY_ID = new Map<ObservationItemId, ObservationItem>(
  OBSERVATION_ITEMS.map((item) => [item.id, item]),
);

export function observationItem(id: ObservationItemId) {
  const item = OBSERVATION_ITEM_BY_ID.get(id);
  if (!item) throw new Error(`Unknown observation item: ${id}`);
  return item;
}

export function managerObservationId(manager: string): ObservationItemId {
  return `manager:${manager.toLowerCase()}` as ObservationItemId;
}

export function sessionObservationId(source: "codex" | "claude" | "opencode" | "grok" | "qoder" | "qoder-cn"): ObservationItemId {
  return `session:${source}` as ObservationItemId;
}
