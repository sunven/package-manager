---
version: 1
slug: "src-components-codexpluginspage-tsx"
primary_target: "src/components/CodexPluginsPage.tsx"
related_targets: ["src/hooks/useCodexPlugins.ts"]
---

# Codex 插件管理

Mode: Operate. Surface: `src/components/CodexPluginsPage.tsx`.

按已确认的 `.scratch/codex-plugin-management/PRD.md` 实现。用户在自己的 macOS 电脑上查看已安装插件并确认单个启停；沿用应用当前浅色与深色主题，无新视觉体系或系统改动。

## Direction contract

THESIS: 让用户分清用户默认启用设置与会话运行状态，并在同一个列表完成核对与操作。

OWN-WORLD: 沿用现有蓝灰背景、蓝色操作强调、Panel、Table、Button 和 Radix 确认框；保留现有字体、间距及主题令牌。来源与配置路径使用现有等宽字。

STORY: 用户从独立导航入口进入，核对 Codex 目录与用户默认范围，阅读插件名称、版本和市场，展开来源详情，明确选择启用或禁用并确认。

FIRST VIEWPORT: 上方紧凑标题与刷新按钮，其下展示实际目录、覆盖提示与读取反馈；主体是可扫描的插件列表。名称列展开详情，版本与市场位于中间，默认设置和操作位于右侧。错误和未知状态就近解释，不用指标卡占据列表空间。

FORM: 直接扩展现有桌面管理页面，已由 PRD 指定列表、详情和逐项确认；无概念抽签或种子。窄窗口允许表格局部滚动，长名称和来源路径换行，确认框可键盘取消并恢复焦点。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

无需图像资产。既有系统尚无 DESIGN.md，本次是普通扩展，不新增或改写全局设计规则。检查沿用结果并报告既有文档缺口。
