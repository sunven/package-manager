---
version: 1
slug: "src-components-codexskillspage-tsx"
primary_target: "src/components/CodexSkillsPage.tsx"
related_targets: ["src/hooks/useCodexSkills.ts","src/App.tsx"]
---

# Codex Skills 管理

Mode: Operate. 按已确认 PRD Q1–Q16 扩展现有 Codex 页面；既有 Panel、表格、筛选和确认流程继续使用。

## Direction contract

THESIS: 先识别技能来源与维护资格，再确认对单个技能的动作。

OWN-WORLD: 沿用 Codex Hooks 与插件页的浅深主题、Outfit 正文、JetBrains Mono 路径、Panel、Table、Button 和 Radix 确认框，不修改全局设计系统。

STORY: 浏览原生技能清单，按来源或启停筛选，展开原始说明；从 GitHub 或本地检查一个安装副本，再确认安装、更新或卸载。

FIRST VIEWPORT: Codex 三页签下方是目录与范围说明，右侧刷新和安装按钮；随后是搜索与筛选、技能名称/来源/启用/操作四列表格。来源和只读原因在同一行可辨。

FORM: 用户已确认的现有表格扩展（seed: not-applicable-confirmed-extension）。签名交互是展开原始技能说明后查看确认中固定的来源版本；失效清单保留内容并关闭写操作。窄桌面窗口局部滚动，模态框恢复触发焦点。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

无新视觉体系、素材或开放的构图决定；文档终审按普通扩展保留既有全局文件。

## Documentation verification · 2026-10-17

结论：普通扩展，设计系统 No changes。核对 `CodexSkillsPage.tsx`、`useCodexSkills.ts`、`App.tsx` 与 `PRODUCT.md` 的 Skills 能力说明；沿用 `src/styles.css`、`src/components/ui.tsx` 和共享 Button、Input、Card、Table、AlertDialog 原语，并对照 `CodexHooksPage.tsx` 及既有 Hooks 文档复核。清单失效后保留结果、禁用维护，原始说明只读，来源版本进入确认框，关闭确认框恢复触发焦点，均与本页合同一致。

视觉证据：对照 `../review/codex-hook-configuration/light-1180.png`，检查 `../review/codex-skills/` 中全部 9 张截图：浅／深主题的 1180px 与 960px 清单、安装表单、展开说明、卸载确认、保存后刷新失败和所属插件跳转。截图保留“合成数据验证 · 不连接本机 Codex”标记，仅作为渲染与状态展示证据，不代表真实本机维护执行。

- Palette：沿用蓝灰浅／深背景、白／深色面板及既有主色、弱化文字与危险操作色，无新增颜色。
- Type ramp：沿用 Outfit 与中文后备字体；标题 16px、正文 14px、辅助说明 12px，路径、版本及原始说明使用 JetBrains Mono。
- Layout rule：沿用 16px 面板间距、可换行工具栏及 Table 容器局部横向滚动；本页 680px 最小表宽和安装表单双列布局不提升为全局规则。
- Surface rule：沿用共享边框、无阴影覆盖与面板 8px／控件 6px／对话框 12px 圆角；卸载沿用危险色与确认动作。
- Interaction rule：沿用共享焦点描边、Radix 确认流程和焦点返回；本页的来源资格、只读状态及操作／刷新分开反馈属于产品语义，无新增全局命名规则。

未规范化或修复的漂移：`DESIGN.md` 与 `.impeccable/design.json` 确认仍为既有缺失；本轮没有获准变更全局视觉体系，因此不创建或修复它们。既有 Hooks 复核记录中的外壳与文档漂移保持原状，没有将本页布局值或缺陷固化为全局规范。
