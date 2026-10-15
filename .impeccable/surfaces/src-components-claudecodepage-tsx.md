---
version: 1
slug: "src-components-claudecodepage-tsx"
primary_target: "src/components/ClaudeCodePage.tsx"
related_targets: ["src/components/ClaudeMarketplacesPage.tsx","src/components/ClaudeHooksPage.tsx","src/components/ClaudeHookEditor.tsx","src/hooks/useClaudeCode.ts","src/App.tsx"]
---

# Claude Code 管理

Mode: Operate. 当前用户的市场、插件与 Hook 定义维护；范围和状态以 `.scratch/claude-code-management/PRD.md` 的 Q1–Q13 为准。

## Direction contract

THESIS: 以市场组织插件，以来源区分 Hook 定义，让每次用户范围操作的对象和影响可核对。沿用用户已确认的 Codex 页面组织。

OWN-WORLD: 保持现有蓝灰明暗主题、Outfit 与代码等宽字体、Panel、Table、Radix Tabs、表单及确认框。状态用现有文字与颜色表达，不修改全局令牌。

STORY: 用户从 Claude Code 入口展开市场，搜索插件、查看详情并单项维护；在 Hooks 中查看用户与插件定义，通过表单编辑用户定义，再核对变更预览。

FIRST VIEWPORT: 页签位于上方，页面标题、重新读取、当前用户目录和读取状态组成紧凑信息区；下方市场表或 Hooks 表，添加操作位于表头右侧。展开行保留上下文，所有受限操作显示具体原因。

FORM: 用户在 Q13 锁定的既有页面扩展；code-led，无 concept-seed。桌面 1180×760 与 960×620，窄布局表格仅局部横向滚动；表单可换行，键盘关闭恢复触发点。沿用既有展开与表单反馈交互。

FINISH: 2026-10-15 独立终审见 `.impeccable/review/claude-code/finish-review.md`；首次 Hook 读取失败误报空清单的唯一评分修正已复核，`verdict-pass.md` 在该修正范围给出 `ship`，不外推整页或原生 Tauri E2E。文档复核见 `.impeccable/review/claude-code/documentation-check.md`。实现继承现有令牌、共享组件和 Codex 页面模式，无获批的全局系统变更，因此不新增 DESIGN.md 或 design.json。截图为带合成数据标识的验证证据，未引入交付用栅格素材。
