import type { CodexSkill, SkillScan } from "../codexSkills";

export function codexSkillFixture(overrides: Partial<CodexSkill> = {}): CodexSkill {
  return {
    name: "release-notes", description: "整理提交记录，编写版本说明。",
    path: "/Users/example/.codex/skills/release-notes/SKILL.md", scope: "user", enabled: true,
    pluginId: null, managed: true, sourceLabel: "example/skills · skills/release-notes · branch: main", revision: "abc123",
    toggleBlocked: null, updateBlocked: null, uninstallBlocked: null, ...overrides,
  };
}
export function codexSkillsFixture(): SkillScan {
  return {
    snapshotId: "skills-1", directory: "/Users/example/.codex", status: "Ready", warnings: [], message: null, installBlocked: null,
    skills: [
      codexSkillFixture(),
      codexSkillFixture({ name: "research", description: "记录资料来源并汇总研究结果。", path: "/Users/example/.agents/skills/research/SKILL.md", enabled: false, managed: false, sourceLabel: null, revision: null, updateBlocked: "请回原来源维护", uninstallBlocked: "请回原来源维护" }),
      codexSkillFixture({ name: "writer:docs", description: "为团队编写和维护项目文档。", path: "/Users/example/.codex/plugins/writer/skills/docs/SKILL.md", pluginId: "writer@team-tools", managed: false, sourceLabel: null, revision: null, toggleBlocked: "插件技能只读", updateBlocked: "插件技能只读", uninstallBlocked: "插件技能只读" }),
      codexSkillFixture({ name: "skill-creator", description: "创建或更新技能说明。", path: "/Users/example/.codex/skills/.system/skill-creator/SKILL.md", scope: "system", managed: false, sourceLabel: null, revision: null, toggleBlocked: "内置技能只读", updateBlocked: "内置技能只读", uninstallBlocked: "内置技能只读" }),
    ],
  };
}
