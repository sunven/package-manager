---
status: accepted
---

# Claude Code 钩子维护原生定义，不引入单项停用状态

Claude Code 没有已公开的「保留定义并禁用单个 Hook」契约，Codex 的逐项启用与信任状态不能直接移植。Claude 首版维护用户 Hook 定义，插件 Hook 只读；接受没有单项启停，插件 Hook 随整个插件启停。

曾考虑将停用定义移出原生配置、由本工具另存并恢复。这会引入第二套定义存储及身份、同步和恢复规则，因此本轮选择保留原生配置边界，不建立私有停用状态，也不复制 Codex 的逐定义信任模型。

定义清单来自用户设置与用户已安装市场插件声明，包括禁用插件；它不冒充会话运行清单，技能与子代理的局部 Hook 不展开。用户总开关关闭时仍可维护定义，不自动打开总开关。

以上取舍由 [Q3、Q8–Q9](../../.scratch/claude-code-management/PRD.md) 确认，整体设计已通过 Q13 确认，现已实现于 Claude Code 入口。写入仅开放给已验证的 2.1.300；官方依据与版本局限见[事实核查](../../.scratch/claude-code-management/RESEARCH.md)，实现验证见[验收记录](../../.scratch/claude-code-management/VERIFICATION.md)。
