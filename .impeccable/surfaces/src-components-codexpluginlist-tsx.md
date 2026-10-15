---
version: 1
slug: "src-components-codexpluginlist-tsx"
primary_target: "src/components/CodexPluginList.tsx"
related_targets: ["src/components/CodexMarketplacesPage.tsx", "src/hooks/useCodexPlugins.ts"]
---

# 市场内的已安装 Codex 插件

Mode: Operate. Surface: `src/components/CodexPluginList.tsx`，嵌入市场展开区域。

按 `.scratch/codex-plugin-marketplace-organization/PRD.md` 合并入口，启停边界沿用 `.scratch/codex-plugin-management/PRD.md`。用户在自己的 macOS 电脑上展开市场、查看其已安装插件并确认单个启停；沿用应用当前浅色与深色主题，无新视觉体系或系统改动。

## Direction contract

THESIS: 让用户分清用户默认启用设置与会话运行状态，并在同一个列表完成核对与操作。

OWN-WORLD: 沿用现有蓝灰背景、蓝色操作强调、Panel、Table、Button 和 Radix 确认框；保留现有字体、间距及主题令牌。来源与配置路径使用现有等宽字。

STORY: 用户在「插件市场」展开市场行，阅读插件名称、版本和用户默认设置，展开来源详情，明确选择启用或禁用并确认。市场归属由外层分组表达，确认时仍显示完整插件与市场身份。

FIRST VIEWPORT: 外层市场页面统一呈现目录、覆盖提示、重新读取与反馈。市场展开区域先显示已安装插件列表，再显示市场目录详情；名称列展开插件来源，版本、默认设置和操作依次排列。错误和未知状态就近解释，不用指标卡占据列表空间。

FORM: 直接扩展现有桌面管理页面，已由 PRD 指定列表、详情和逐项确认；无概念抽签或种子。窄窗口允许表格局部滚动，长名称和来源路径换行，确认框可键盘取消并恢复焦点。

FINISH: 验证分组、单项确认、独立维护资格、焦点恢复及窄窗口滚动；复核结果见 `../review/marketplace-plugins/finish-review.md`，文档沿用结果见 `../review/marketplace-plugins/documentation-review.md`。

无需图像资产。既有系统尚无 DESIGN.md，本次是普通扩展，不新增或改写全局设计规则。检查沿用结果并报告既有文档缺口。
