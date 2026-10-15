---
version: 1
slug: "src-components-codexhookspage-tsx"
primary_target: "src/components/CodexHooksPage.tsx"
related_targets: ["src/hooks/useCodexHooks.ts","src/App.tsx"]
---

# Codex Hooks 管理

Mode: Operate. 按 PRD Q1–Q12 扩展既有 Codex 管理入口，无未决设计问题。

THESIS: 看清每条 Hook 的事件、操作、来源与信任状态，再确认单项启停。

OWN-WORLD: 继承 CodexPluginList 和 CodexMarketplacesPage 的主题、字体、Panel、Table、Button、Radix Tabs 与确认框；保持全局设计系统。

STORY: 查看当前 home 与清单范围，展开详情，确认后保存。总开关关闭、禁用插件未展开和待信任分别说明；「前往插件市场」进入按市场组织的已安装插件管理。

FIRST VIEWPORT: 顶部「插件市场／Hooks」两个页签；当前目录、刷新与范围提示；下方事件、操作摘要、来源、启用与信任状态、单项操作的表格。

FORM: 继承可展开列表。完整命令在详情与确认框展开，长路径换行，窄窗口表格局部滚动。签名交互为同一行展开定义后确认启停；确认框恢复焦点，沿用 Radix 动画及减少动态效果设置。

FINISH: 首次／手动／操作后读取；保存与重读失败分别反馈；浅深主题、桌面及窄窗口验证，独立终审与文档复核。

局部扩展，无概念抽签或新增视觉体系。
