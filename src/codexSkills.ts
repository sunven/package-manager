export type SkillSource = { kind: "local"; path: string } | { kind: "github"; repo: string; subdirectory: string; reference: string; referenceKind: "branch" | "tag" };
export type SkillOperation = "Install" | "Enable" | "Disable" | "Update" | "Uninstall";
export type CodexSkill = {
  name: string; description: string; path: string; scope: string; enabled: boolean; pluginId: string | null;
  managed: boolean; sourceLabel: string | null; revision: string | null;
  toggleBlocked: string | null; updateBlocked: string | null; uninstallBlocked: string | null;
};
export type SkillScan = {
  snapshotId: string | null; directory: string; status: "Ready" | "MissingCli" | "Incompatible" | "Failed";
  skills: CodexSkill[]; warnings: string[]; message: string | null; installBlocked: string | null;
};
export type SkillIntent = { operation: SkillOperation; path?: string; source?: SkillSource };
export type SkillPreview = { planId: string; operation: SkillOperation; name: string; path: string; sourceLabel: string | null; revision: string | null; enabled: boolean; message: string };
export type SkillOutcome = { status: "Succeeded" | "Saved" | "Unchanged" | "Partial" | "Conflict" | "Failed"; message: string };
export const skillOperationLabel: Record<SkillOperation, string> = { Install: "安装", Enable: "启用", Disable: "禁用", Update: "更新", Uninstall: "卸载" };
export function skillSourceLabel(skill: CodexSkill) {
  return skill.pluginId ? "插件技能" : skill.scope === "system" ? "Codex 内置" : skill.scope !== "user" ? "非用户来源" : skill.managed ? "本应用安装" : "已有独立技能";
}
