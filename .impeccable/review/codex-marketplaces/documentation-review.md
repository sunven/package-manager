# Codex 市场源管理文档记录

日期：2026-10-14。结论：**pass —— 既有系统保持不变**。

本表面是既有 Codex 插件页内新增的第二个页签（「已安装／市场源」），实现与方向契约 `.impeccable/surfaces/src-components-codexmarketplacespage-tsx.md` 及 `PRODUCT.md` 中已记录的 Codex 插件能力一致：依赖兼容 CLI，只维护可核实属于当前用户配置的市场来源，逐个添加、Git 刷新与移除，命令结果与重读结果分别反馈。这是既有世界的普通扩展，不是新世界。

未创建 `DESIGN.md` 或 `.impeccable/design.json`。普通扩展的指令优先于表面契约中关于 `DESIGN.md` 的通用收尾措辞；仓库此前也不存在这两份文件。本报告只记录证据，不为后续表面立新的全局规则。

## 系统证据

- 配色：沿用既有浅／深主题 token，新页面只使用 `text-primary`（市场名展开触发器）、`text-muted-foreground`（说明、只读原因、辅助文字）、`text-destructive`（表单内联错误）、`bg-muted/30`（展开详情行）、`accent-primary`（来源类型单选）与 `Alert` 的 destructive 变体。没有市场源专属的颜色声明，也没有新增 CSS 变量。
- 字体：沿用 `--font-heading`（Outfit Variable / PingFang SC 等）、`--font-sans`、`--font-mono`（JetBrains Mono Variable / SF Mono）。面板标题沿用 `.industrial-panel-head [data-slot="card-title"]` 的 1rem / 600 / -0.03em；正文 `text-sm`，辅助文字 `text-xs`，市场来源与本地目录用 `font-mono`。与邻近市场源列表节奏（标题行 + 说明段 + 列表）一致。
- 容器：沿用 `Panel`、`PanelHead`（`industrial-panel`、`industrial-panel-head`）、`CardContent`、`Table` 一族、`EmptyState`、`SkeletonRows`、`Alert`、Radix `AlertDialog`、`Input`、Radix `Tabs`。继承既有边框、紧凑内边距与扁平内容面；展开行 `bg-muted/30` 与「查看来源详情／收起来源详情」子标签是既有插件页的原生手法，逐行同构复用，不是本次引入的装置。
- 操作：次要操作为 `Button` `variant="outline"` `size="sm"`（重新读取、刷新市场、移除、取消添加、取消），主操作为 `Button` 默认变体（添加市场源、确认添加、确认刷新、确认移除），与全站主操作一致；确认框用 `AlertDialogCancel`/`AlertDialogAction` 以 `asChild` 包裹 `Button`。悬停、禁用与焦点态由既有 `buttonVariants` 的 `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30` 与 `disabled:opacity-50` 承担；图标来自既有 `@phosphor-icons/react`，读取中仅用 `motion-safe:animate-spin`。
- 布局：`<section className="view-grid">` 承载（`.view-grid` 为 `display: grid; gap: 1rem`），三段节奏为「目录面板 → 结果／错误告警 → 市场源面板」。表格自带水平滚动包装并使用 `table-fixed` 与 `min-w-[700px]`，长来源换行；展开行用 `dl` 栅格（`sm:grid-cols-2`）。这些是表面行为，不构成新的全局规定。
- 无障碍地标：`CodexPluginsPage` 由 `<main>` 改为 `<section>`，`main` 地标由 Radix `Tabs` 根以 `role="main"` 承载，同一时刻仍只有一个 `main`。这是既有地标契约在页签结构下的延续，不是新的设计规则。

`git diff` 与 `git status` 显示本次功能未改动 `src/styles.css`、`src/components/ui.tsx`，以及所查的 `components/ui/{button,table,alert,alert-dialog,input,tabs}.tsx` 共享原语。

## 已核查的确切证据

源码与产品记录：

- `src/components/CodexMarketplacesPage.tsx`
- `src/App.tsx` —— 页签接线与 `codexBusy` 门
- `src/hooks/useCodexMarketplaces.ts`
- `src/codexMarketplaces.ts`
- `src/components/CodexPluginsPage.tsx`、`src/hooks/useCodexPlugins.ts` —— `<main>` → `<section>`、aria-label 改为「已安装插件管理」、`pluginRevision` 重读
- `src/components/ui.tsx`
- `src/styles.css` —— token 声明（含 `@theme inline` 的 `--font-sans`/`--font-serif`/`--font-mono`/`--font-heading`）、`.view-grid`、`.industrial-panel*`
- `components/ui/{button,table,alert,alert-dialog,input,tabs}.tsx`
- `.impeccable/surfaces/src-components-codexmarketplacespage-tsx.md`
- `PRODUCT.md` —— Codex 插件能力段落
- `.scratch/codex-marketplace-management/PRD.md` 与 `VERIFICATION.md` —— 已确认范围与验收记录；实现状态编辑仍归实现方

本次直接检视的截图（`.impeccable/review/codex-marketplaces/`）：

- `light-1180.png`
- `dark-960.png`
- `narrow-390.png`
- `add-1180.png`
- `confirm-refresh-1180.png`
- `empty-1180.png`

另查 `interaction-checks.json`（9 项检查，取消与 Escape 均记录 `writes: 0`，CLI 缺失时保留旧行并禁用写入）、`a11y-light.json` 与 `a11y-dark.json`（两份均 `violations: 0`，各有 1 项因渐变背景无法判定背景色的 color-contrast 待人工确认，节点为外壳标题与侧栏导航，非本页新增元素）、`finish-review.md`（结论 pass，无阻断项）。

运行规范已读：`.claude/skills/impeccable/reference/document.md`；同世界先例：`.impeccable/review/codex-plugins/documentation-review.md`。

## 证据边界与未变动的缺口

截图与交互记录使用注入合成 `window.__TAURI_INTERNALS__` IPC mock 的生产预览（`vite preview`，`http://localhost:14212/`），只验证呈现与 UI 状态处理，不验证原生配置写入。原生 CLI 接入由 Rust 测试单独验证，包含隔离临时 home 的生命周期测试；本次文档核查未重跑这些测试。原生目录选择器与原生桌面窗口没有端到端截图，也没有原生窗口截图。已测 CLI 版本 `codex-cli 0.162.1` 不声明为最低支持版本。

仓库不存在 `DESIGN.md`／sidecar，这一状况早于本次任务且未改变。外壳标语使用 `--font-serif`（New York 等系统衬线栈）；它在本扩展之外，未写入系统，也未改动。

未写入系统、也未修复的缺陷与漂移：原生 `input[type=radio]`（本页「来源类型」）不在全局 `:focus-visible` 覆盖列表内（`src/styles.css:340-347`），键盘聚焦依赖浏览器默认焦点环——这是既有的全局样式缺口，非本功能引入，按普通扩展不修不改的边界保留；终审记录的其他非阻断候选（读取期间页签禁用范围偏严、重复来源标题与正文同义、能力失败走只读通道、展开行无截图证据）属交互与文案观察，不是设计系统规则，同样未记入。
