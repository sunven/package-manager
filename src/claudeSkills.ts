import type { SkillSource } from "./codexSkills";
export type { SkillSource, SkillOutcome } from "./codexSkills";

export type SkillMode = "on" | "name-only" | "user-invocable-only" | "off";
export type SkillOperation = "Install" | "SetMode" | "Update" | "Uninstall";
export type ClaudeSkill = {
  name: string; description: string; path: string; kind: "independent" | "legacy" | "plugin" | "synced";
  settingKey: string | null; names: string[]; pluginId: string | null; pluginEnabled: boolean | null;
  problem: string | null; disableModelInvocation: boolean; userInvocable: boolean;
  mode: SkillMode | null; modeUnknown: boolean; managed: boolean; sourceLabel: string | null; revision: string | null;
  settingBlocked: string | null; updateBlocked: string | null; uninstallBlocked: string | null;
};
export type SkillScan = {
  snapshotId: string; directory: string; version: string | null; skills: ClaudeSkill[];
  warnings: string[]; writeBlocked: string | null; installBlocked: string | null;
};
export type SkillIntent = { operation: SkillOperation; path?: string; source?: SkillSource; mode?: SkillMode | null };
export type SkillPreview = {
  planId: string; operation: SkillOperation; name: string; path: string; settingKey: string | null;
  previousMode: SkillMode | null; mode: SkillMode | null; sourceLabel: string | null; revision: string | null; message: string;
};
export const skillOperationLabel: Record<SkillOperation, string> = { Install: "安装", SetMode: "调整调用设置", Update: "更新", Uninstall: "卸载" };
export const skillModeLabel: Record<SkillMode, string> = { on: "正常展示", "name-only": "仅展示名称", "user-invocable-only": "仅手动调用", off: "关闭" };
export function skillSourceLabel(skill: ClaudeSkill) {
  return skill.kind === "plugin" ? "插件技能" : skill.kind === "synced" ? "同步技能" : skill.kind === "legacy" ? "旧版命令" : skill.managed ? "本应用安装" : "已有独立技能";
}
