---
status: accepted
---

# Codex hooks 采用原生清单，只保存用户级启用覆盖

hooks 首版需要查看与单项启停，并保留 Codex 自己的身份和信任判断。清单采用当前 Codex home、项目外上下文中的原生 `hooks/list`，仅展示用户与插件来源；用户接受原生清单不展开禁用插件、总开关关闭时无法枚举的限制，界面必须明确说明，不能将空清单解释为没有定义。不自行扫描插件来重建清单，以免重复实现多种声明格式、身份和加载规则。

官方配置 schema 已公开 `hooks.state` 中的 `enabled` 与 `trusted_hash`。启停使用原生返回的完整 key，经官方通用配置写接口只保存用户配置中的目标 `enabled`，保留信任与无关配置；信任审查继续使用 Codex 原生界面。本机 `codex-cli 0.162.1` 隔离实验已验证用户与插件 hook 的启停、信任保留与配置版本冲突拒绝，见[验证记录](../../.scratch/codex-hooks-management/VERIFICATION.md)，但这不构成最低版本或跨版本保证。

保存前复核目标身份、定义 hash、信任、启用状态和可维护资格，并对用户配置使用版本检查。定义可能来自独立文件，因此配置版本检查不等于跨文件事务；保存成功也不代表运行中的 CLI 或桌面 App 会话立即生效。

依据：[官方 hooks 文档](https://learn.chatgpt.com/docs/hooks)、[官方配置 schema](https://learn.chatgpt.com/docs/config-schema.json)。已确认的整体方案与实验限制见 [PRD](../../.scratch/codex-hooks-management/PRD.md)。
