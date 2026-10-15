---
version: 1
slug: "src-components-codexpluginlist-tsx"
primary_target: "src/components/CodexPluginList.tsx"
related_targets: ["src/components/CodexMarketplacesPage.tsx", "src/hooks/useCodexPlugins.ts"]
---

# 市场内的 Codex 插件目录

Mode: Operate. Surface: `src/components/CodexPluginList.tsx`，嵌入市场展开区域。

按 `.scratch/codex-plugin-marketplace-organization/PRD.md` 合并入口，并按 `.scratch/codex-marketplace-plugin-completion/PRD.md` 补齐目录、详情与单项生命周期；启停边界沿用 `.scratch/codex-plugin-management/PRD.md`。用户在自己的 macOS 电脑上展开市场，浏览已安装与未安装插件并管理当前 Codex home 的用户默认设置；沿用应用当前浅色与深色主题，无新视觉体系或系统改动。

## Direction contract

THESIS: 让用户分清目录项、安装状态、用户默认启用设置与会话运行状态，并在同一个列表完成浏览、核对与单项操作。

OWN-WORLD: 沿用现有蓝灰背景、蓝色操作强调、Panel、Table、Button 和 Radix 确认框；保留现有字体、间距及主题令牌。来源与配置路径使用现有等宽字。

STORY: 用户在「插件市场」展开市场行，按名称或简介搜索，以「全部／已安装／未安装」筛选，阅读版本、安装状态与用户默认设置。插件名称展开详情，按本地可读文件展示元数据、来源和技能名称、MCP 服务名、Hooks 事件；Hooks 提供现有管理页入口。未安装项提供安装，已安装项提供启停、重新安装和卸载，各自确认目标与影响。市场归属由外层分组表达，确认时仍显示完整插件与市场身份。

FIRST VIEWPORT: 外层市场页面统一呈现目录、覆盖提示、重新读取与反馈。市场展开区域先显示搜索、安装状态筛选和插件列表，再显示市场目录详情；名称列展开插件详情，版本、安装状态与默认设置、操作依次排列。错误、未知状态和安装限制就近解释，不用指标卡占据列表空间。

BEHAVIOR: 安装事实来自官方清单；本地详情标明来自安装副本或来源目录。不可读组件显示「尚不可读取」，已读取但没有声明时显示「未声明」，不把组件声明当作加载、连接或信任状态，也不为远程预览自动安装。安装与重新安装会启用插件，重新安装不承诺取得上游最新版；安装策略不允许或无法核实时禁用相应入口。卸载确认说明 Codex 移除安装副本及配置，应用不追加删除原始来源、凭据或插件数据。操作后重读，并使 Hooks 清单失效；操作结果与重读失败分开表达。

FORM: 直接扩展现有桌面管理页面，已由 PRD 指定列表、详情和逐项确认；无概念抽签或种子。窄窗口允许表格局部滚动，搜索与筛选可换行，长名称和来源路径换行；详情沿用行展开与分栏，确认框内部可滚动、可键盘取消并恢复焦点。

FINISH: 2026-10-15 独立审阅为 `ship`，已逐张查看 `.impeccable/review/codex-completion-*.png` 的 7 张截图。证据覆盖 1180×760 和 960×620 桌面窗口、明暗主题、搜索筛选、详情与组件声明、重新安装确认；实现与验证边界见 `.scratch/codex-marketplace-plugin-completion/VERIFICATION.md`。该结论不外推完整原生 Tauri E2E 或完整 WCAG AA 合规。

无需图像资产。既有系统尚无 DESIGN.md，本次是普通扩展，不新增或改写全局设计规则。检查沿用结果并报告既有文档缺口。
