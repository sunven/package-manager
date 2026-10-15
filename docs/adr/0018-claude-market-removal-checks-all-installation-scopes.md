---
status: accepted
---

# Claude Code 市场移除检查全部安装作用域

Claude 首版仅管理当前用户，却不能只凭 `--scope user` 判断市场移除的影响范围。2.1.300 隔离实验中，从项目外移除 user 市场声明会删除该市场的 user/project/local 安装记录，即使其他项目仍保留市场声明；scope 只限定声明写入位置。

本工具继续委托官方 CLI 维护市场，但移除前读取该市场全作用域安装记录；存在非 user 安装、归属不明或无法确定影响时阻止操作。仅影响用户范围时列出连带插件并说明数据影响后确认，不另行实现市场移除或默认扩大用户管理授权。这接受读取非用户安装记录以保护边界，不因此提供项目管理。

取舍由 [Q1、Q4](../../.scratch/claude-code-management/PRD.md) 确认，整体设计已通过 Q13 确认。现已实现全作用域复核、跨范围拦截和用户范围连带影响确认。实验只覆盖 2.1.300 与静态本地 fixture，详细依据见[事实核查](../../.scratch/claude-code-management/RESEARCH.md)和[验收记录](../../.scratch/claude-code-management/VERIFICATION.md)。
