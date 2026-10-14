---
version: 1
slug: "src-components-codexmarketplacespage-tsx"
primary_target: "src/components/CodexMarketplacesPage.tsx"
related_targets: ["src/App.tsx", "src/hooks/useCodexMarketplaces.ts"]
---

# Codex 市场源管理

Mode: Operate. 按 `.scratch/codex-marketplace-management/PRD.md` 中已确认的十项决定，扩展既有 Codex 插件页。

THESIS: 在市场来源列表中核对当前环境、来源与可维护范围，再逐项添加、刷新或移除。

OWN-WORLD: 沿用 CodexPluginsPage 的蓝灰浅色与深色主题、字体、Panel、Table、Button、Radix Tabs 与确认框；不修改全局设计系统。

STORY: 从「已安装／市场源」页签进入，查看来源与只读原因；添加在原页表单完成，刷新和移除在确认目标与影响后执行。清单读取与 Git 同步分开命名，结果与重读失败分别表达。

FIRST VIEWPORT: 顶部页签、当前 Codex 目录与重新读取；下方市场列表和添加入口。市场名称展开实际目录，来源地址换行，操作和受限原因直接可见。

FORM: 沿用既有列表构成；窄窗口只允许表格局部滚动，表单换行，确认框支持键盘操作并恢复焦点。无需图像或新增装饰。

FINISH: 完成浏览器交互、主题及尺寸验证，独立审阅与沿用设计文档记录。
