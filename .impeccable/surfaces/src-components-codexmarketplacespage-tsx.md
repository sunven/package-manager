---
version: 1
slug: "src-components-codexmarketplacespage-tsx"
primary_target: "src/components/CodexMarketplacesPage.tsx"
related_targets: ["src/App.tsx", "src/components/CodexPluginList.tsx", "src/hooks/useCodexMarketplaces.ts", "src/hooks/useCodexPlugins.ts"]
---

# Codex 插件市场管理

Mode: Operate. 按 `.scratch/codex-plugin-marketplace-organization/PRD.md` 中已确认的方案，合并已安装插件与市场源管理。

THESIS: 以市场组织已安装插件，在同一列表中核对来源、展开插件并逐项管理；两类对象的资格与读取结果分别表达。

OWN-WORLD: 沿用既有蓝灰浅色与深色主题、字体、Panel、Table、Button、Radix Tabs 与确认框；不修改全局设计系统。

STORY: 从「插件市场／Hooks」进入，市场行展开其已安装插件与来源详情，插件可进一步展开来源并确认单项启停。添加市场在原页表单完成，刷新和移除在确认目标与影响后执行。空市场保留，未匹配插件按原市场名保留分组。清单读取与 Git 同步分开命名，结果与重读失败分别表达。

FIRST VIEWPORT: 顶部两个页签、当前 Codex 目录、用户默认范围与重新读取；下方市场列表和添加入口。市场名称展开已安装插件和实际目录，来源地址换行，操作和受限原因直接可见；插件列表放在来源目录详情之前。

FORM: 沿用既有列表构成；窄窗口只允许表格局部滚动，表单换行，确认框支持键盘操作并恢复焦点。无需图像或新增装饰。

FINISH: 完成浏览器交互、主题及尺寸验证，独立审阅与沿用设计文档记录。
