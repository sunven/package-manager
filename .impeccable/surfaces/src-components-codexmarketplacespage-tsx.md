---
version: 1
slug: "src-components-codexmarketplacespage-tsx"
primary_target: "src/components/CodexMarketplacesPage.tsx"
related_targets: ["src/App.tsx", "src/components/CodexPluginList.tsx", "src/hooks/useCodexMarketplaces.ts", "src/hooks/useCodexPlugins.ts"]
---

# Codex 插件市场管理

Mode: Operate. 沿用 `.scratch/codex-plugin-marketplace-organization/PRD.md` 的合并入口，按 `.scratch/codex-marketplace-plugin-completion/PRD.md` 补齐市场目录与插件生命周期。

THESIS: 以本机市场组织插件目录，在同一列表中核对来源、浏览已安装与未安装插件并逐项管理；市场源和插件的资格与读取结果分别表达。

OWN-WORLD: 沿用既有蓝灰浅色与深色主题、字体、Panel、Table、Button、Radix Tabs 与确认框；不修改全局设计系统。

STORY: 从「插件市场／Hooks」进入，展开市场后搜索插件目录、按安装状态筛选、查看详情并确认单项安装、启停、重新安装或卸载。添加市场在原页表单完成，Git 分支／标签与多个稀疏检出目录收进「Git 高级选项」，本地目录兼容两种市场布局。同步和移除在确认目标与影响后执行。空市场保留，未匹配插件按原市场名保留分组。清单读取与 Git 同步分开命名，结果与重读失败分别表达。

FIRST VIEWPORT: 顶部两个页签、当前 Codex 目录、用户默认范围与重新读取；下方市场列表和添加入口。市场名称展开插件目录和实际目录，来源地址换行，操作和受限原因直接可见。插件目录先呈现搜索、安装状态筛选和列表，再显示市场目录、配置路径及已配置的 Git 选项。

BEHAVIOR: 仅管理当前 Codex home 的用户级范围。Git 市场同步可能影响多个已配置插件，即使已禁用，不承诺取得上游最新版；本地目录只需重新读取。市场源移除与插件卸载分别确认。插件重新安装会启用选定插件，远程详情不可读时明确说明，不为预览自动安装。不加入发布、项目配置、批量或认证管理。

FORM: 沿用既有列表构成；窄窗口只允许表格局部滚动，表单换行，确认框支持键盘操作并恢复焦点。无需图像或新增装饰。

FINISH: 2026-10-15 独立审阅为 `ship`，已逐张查看 `.impeccable/review/codex-completion-*.png` 的 7 张截图。证据覆盖 1180×760 和 960×620 桌面窗口、明暗主题、详情、组件、重新安装确认与 Git 高级选项；范围与自动化结果见 `.scratch/codex-marketplace-plugin-completion/VERIFICATION.md`。不外推完整原生 Tauri E2E 或完整 WCAG AA 合规。沿用现有视觉系统，不新增或改写全局设计规则。
