---
version: 1
slug: "src-components-claudeskillspage-tsx"
primary_target: "src/components/ClaudeSkillsPage.tsx"
related_targets: ["src/hooks/useClaudeSkills.ts","src/components/ClaudeCodePage.tsx","src/App.tsx"]
---

# Claude Code Skills

Mode: Operate. 当前用户的技能定义观察与单项维护。产品规则以 `.scratch/claude-skills-management/PRD.md` Q1–Q13 为准，用户已确认沿用现有管理体验。

## Direction contract

THESIS: 把技能定义、名称调用设置和安装副本归属分别呈现，使操作前能核对名称、来源与影响。

OWN-WORLD: 继承现有 Claude 与 Codex 管理页面的蓝灰明暗主题、Outfit、路径等宽字体、Panel、Table、Tabs、表单与确认框；不改变全局令牌。

STORY: 从 Claude Code 的 Skills 页签查看和筛选定义，展开只读说明，调整原生调用设置或检查安装来源，然后预览确认并核对结果。名称显示与实际设置名称分别呈现是本页的核心交互细节。

FIRST VIEWPORT: 页签下是紧凑标题、刷新和安装动作、当前用户目录与范围说明；随后是筛选栏与定义表。定义名称和来源先于维护按钮，调用模式独立成列。保留首次读取、部分读取、空清单、过期结果和只读限制。

FORM: 已确认的局部扩展；code-led，无 concept-seed。沿用列表展开与保护性确认。桌面 1180×760、960×620，同时核对窄浏览器布局；表格可局部横向滚动，表单换行，取消确认恢复焦点。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Documentation verification

2026-10-17：独立委派的 Documenter 使用降级角色说明完成核对。源码与浅色 1180、深色 960、窄屏安装 390 截图一致：沿用蓝灰明暗主题、Outfit 界面字体和 JetBrains Mono 路径字体；共享标题 16px/600、正文与控件 14px、辅助信息 12px。Panel 使用 8px 圆角，按钮与输入 6px，确认框 12px，以边框与底色区分层级。沿用 16px 区块间距、局部横向滚动表格、窄屏单列表单及焦点恢复；设置名称独立显示是本页交互，不提升为全局规则。

依据为 `src/styles.css`、`src/components/ui.tsx`、`components/ui/` 共享控件、Claude/Codex Skills 与 Claude 市场页面，以及 `PRODUCT.md`。本次是现有体系的局部扩展，未创建或改写 `DESIGN.md`、`.impeccable/design.json`。共享组件圆角／阴影工具类被全局样式覆盖的重复定义早已存在，未修复或固化为新规则。截图仅为合成数据验证，不代表本机 Claude 执行证据。

## Finish record

2026-10-17 已完成。上方 FINISH 是工作流原始约定；本次为用户已确认的局部扩展，按 ordinary-extension 边界保留现有视觉系统，不因缺少 DESIGN.md 而创建全局设计文档；没有新增随产品交付的位图资产。

一次 detector 无发现，页面截图覆盖浅色 1180×760、深色 960×620、窄屏 390px 及确认／安装状态。独立评审初审 disposition 为 fix：安装预览取消后收起表单的焦点恢复、调用设置确认标题两项。修复与重拍后，两项均为 resolved，verdict disposition 为 ship，范围仅为所列修复。Documenter 已完成上节记录。专用角色不可用，两个交接均由不继承开发对话的新代理按同一角色说明执行。

证据见 `.impeccable/review/claude-skills/` 和 `.scratch/claude-skills-management/VERIFICATION.md`。前端 265 项、Rust 249 项常规测试通过，真实隔离 Claude CLI 与共享 Git 流程各 1 项通过，生产构建通过。
