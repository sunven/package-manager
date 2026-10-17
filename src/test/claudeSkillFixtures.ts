import type { ClaudeSkill, SkillScan } from "../claudeSkills";

export function claudeSkillFixture(overrides: Partial<ClaudeSkill> = {}): ClaudeSkill {
  return {
    name: "release-notes", description: "整理提交记录，编写版本说明。", path: "/Users/example/.claude/skills/release/SKILL.md",
    kind: "independent", settingKey: "release", names: ["release", "release-notes"], mode: "on", modeUnknown: false, managed: true,
    sourceLabel: "example/skills · skills/release · branch: main", revision: "abc123", pluginId: null, pluginEnabled: null,
    problem: null, disableModelInvocation: false, userInvocable: true,
    settingBlocked: null, updateBlocked: null, uninstallBlocked: null, ...overrides,
  };
}
export function claudeSkillsFixture(): SkillScan {
  return { snapshotId: "claude-skills-1", directory: "/Users/example/.claude", version: "2.1.302", warnings: [], writeBlocked: null, installBlocked: null,
    skills: [
      claudeSkillFixture(),
      claudeSkillFixture({ name: "research", description: "核对资料来源并整理结论。", path: "/Users/example/.claude/skills/research/SKILL.md", settingKey: "research", names: ["research"], mode: "off", managed: false, sourceLabel: "共享技能目录", revision: null, updateBlocked: "请回原来源维护", uninstallBlocked: "请回原来源维护" }),
      claudeSkillFixture({ name: "reviewer:review", description: "核对代码变更。", path: "/Users/example/.claude/plugins/reviewer/skills/review/SKILL.md", kind: "plugin", settingKey: null, names: ["reviewer:review"], mode: null, managed: false, sourceLabel: null, revision: null, pluginId: "reviewer@team-tools", pluginEnabled: false, settingBlocked: "插件技能随整个插件管理。", updateBlocked: "插件技能只读", uninstallBlocked: "插件技能只读" }),
      claudeSkillFixture({ name: "front:build", description: "旧版自定义命令。", path: "/Users/example/.claude/commands/front/build.md", kind: "legacy", settingKey: "front:build", names: ["front:build"], mode: null, managed: false, sourceLabel: null, revision: null, updateBlocked: "原来源维护", uninstallBlocked: "原来源维护" }),
      claudeSkillFixture({ name: "account-notes", description: "来自账户同步的技能。", path: "/Users/example/.claude/skills/synced/account-notes/SKILL.md", kind: "synced", settingKey: null, names: ["account-notes"], mode: null, managed: false, sourceLabel: null, revision: null, settingBlocked: "请在同步来源维护。", updateBlocked: "请回原来源维护", uninstallBlocked: "请回原来源维护" }),
    ],
  };
}
