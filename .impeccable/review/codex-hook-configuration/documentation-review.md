专用 documenter 角色不可用，本次由独立代理按 `reference/degraded/documenter.md` 与 `reference/document.md` 执行替代复核。

设计系统：No changes。本轮为普通扩展（Hooks 清单获得用户定义的新增／编辑／删除，经由新 `CodexHookEditor` 表单对话框），继续以 `src/styles.css`、`src/components/ui.tsx` 及根级 `components/ui/{dialog,input,button,alert,alert-dialog,card,table,tabs}.tsx` 为依据；新对话框完全组合共享原语与既有 CSS 变量，没有需要持久化为全局规则的新设计决定，不创建 `DESIGN.md` 或 `.impeccable/design.json`（两文件确认不存在，与上一轮 `codex-hooks/documentation-review.md` 的决定一致）。

持久化依据：已通读 `src/styles.css`、`src/components/ui.tsx`、`components/ui/dialog.tsx`、`components/ui/input.tsx`，逐行核对 `CodexHookEditor.tsx` 与 `CodexHooksPage.tsx`，并抽样 `CodexMarketplacesPage.tsx` 的原生表单控件与确认框模式、`App.tsx` 第 168 行的 prepareDefinition／commitDefinition 接线；对照 `PRODUCT.md`、`.impeccable/surfaces/src-components-codexhookspage-tsx.md` 与上一轮文档复核记录。编辑器的原生 select／textarea 以 Tailwind 工具类逼近共享 Input 原语，是兄弟页面已有的做法；`details`／`summary` 高级选项折叠、`max-h-64` 等宽 JSON 预览块、`onCloseAutoFocus` 焦点回退均为单一 surface 内的表单工效，不构成系统规则。

Palette：沿用浅色蓝灰背景／白色面板与深色蓝灰背景／深色面板；强调色分别为 `#2f62e4`／`#9db7ff`，状态语义沿用 pastel 色对公司；编辑器未引入任何新颜色。
Type ramp：沿用 Outfit 与中文后备字体；对话框标题 16px、表单正文 14px、辅助说明 12px，命令、路径与 JSON 预览使用 JetBrains Mono。
Layout rule：沿用 16px 面板间距与共享 Table 容器局部滚动；编辑器 `max-w-3xl` 配 `sm:grid-cols-2` 双列栅格是本对话框的数据布局，不提升为全局断点。
Surface rule：沿用共享边框、无阴影覆盖及 8px／6px／12px 圆角（styles.css `!important` 裁定）；删除操作沿用 ghost 按钮＋`text-destructive` 的既有语义。
Interaction rule：沿用共享 2px ring 焦点描边、Radix 对话框关闭后焦点回触发行元素、处理中禁用关闭与外部点击、`prefers-reduced-motion` 全局降级；「先检查影响、预览确认再保存」的两段式流程是产品语义而非视觉新规则。

未规范化或修复的漂移：编辑器原生 select／textarea 保留 Tailwind `shadow-xs`，而共享 Input 原语的阴影被 styles.css 压平为 none，形成细微内阴影不一致（页面级，未修复以免越权改动共享原语）；清单最小表宽由上一轮记录的 700px 变为 740px（两轮均为页面局部数据布局，从未 canonize 为系统规则）；README「个人自用」定位差异与外壳渐变对比度未判定项继续沿用上一轮记录，不由本轮修复。
