专用 documenter 角色不可用，本次由独立子代理按 `reference/degraded/documenter.md` 与 `reference/document.md` 执行替代复核。

设计系统：No changes。普通扩展继续以 `src/styles.css`、`src/components/ui.tsx` 及 `components/ui/{button,card,table,alert-dialog,tabs}.tsx` 为依据；与 `CodexPluginsPage.tsx`、`CodexMarketplacesPage.tsx` 对比后，没有需要持久化为全局规则的新设计决定，不创建 `DESIGN.md` 或 `.impeccable/design.json`。

持久化依据：已检查 `PRODUCT.md`、`README.md` 的 Codex 管理说明、`.scratch/codex-hooks-management/PRD.md`、Hooks surface brief、`finish-review.md`，并对照 `CodexHooksPage.tsx`、`useCodexHooks.ts`、`App.tsx` 与 `Shell.tsx`。三个页签、原生清单范围、单项确认、只读限制、过期状态及保存／重读结果分离均有对应实现和文档。沿用终审记录的截图与交互证据，本轮不新增浏览器验证。

Palette：沿用浅色蓝灰背景／白色面板与深色蓝灰背景／深色面板；强调色分别为 `#2f62e4`／`#9db7ff`，未引入局部颜色体系。
Type ramp：沿用 Outfit 与中文后备字体；面板标题 16px、正文 14px、辅助信息 12px，命令和路径使用 JetBrains Mono。
Layout rule：沿用 16px 面板间距和摘要表格；Hooks 的 700px 最小表宽仅是本页数据布局，窄窗口由共享 Table 容器局部滚动，不提升为全局断点。
Surface rule：沿用共享边框及无阴影覆盖；面板 8px、按钮 6px、确认框 12px 圆角，无新增材质或装饰资产。
Interaction rule：沿用语义化展开按钮、单项 Radix 确认、关闭后焦点恢复、共享焦点描边及减少动态效果规则；信任状态和保存结果的区分属于产品语义。

未规范化或修复的漂移：README 历史「个人自用」定位与 PRODUCT 已确认受众的差异，以及既有外壳渐变对比度的自动检查未判定项，均不由本次 Hooks 扩展修复或写成新的设计规则。
