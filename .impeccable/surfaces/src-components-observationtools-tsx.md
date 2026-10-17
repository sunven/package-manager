# Observation tools

Primary target: src/components/ObservationTools.tsx
Related targets: src/components/GlobalSearch.tsx, src/App.tsx, src/components/Shell.tsx
Mode: Operate

## Direction contract

THESIS: 搜索、路径诊断和历史对比帮助用户追溯本机观察的来源与时间。所有结论附着于具体对象与完整性。

OWN-WORLD: 继承当前蓝灰色桌面外壳、Outfit 界面字体、JetBrains Mono 路径、Phosphor 图标和现有 Radix 表单／页签／对话框；保留明暗主题。

STORY: 用户通过顶部搜索快速定位对象，在总览页签查看命令优先级和历史变化，再回管理器确认维护。

FIRST VIEWPORT: 顶部搜索按钮位于主题按钮之前。总览内部保留概览，并增加环境诊断、历史页签；诊断与历史沿用紧凑工具栏、全宽结果行和可展开详情。搜索弹窗将输入、覆盖范围、结果和定位动作放在同一键盘流程中。

FORM: 已批准计划内的既有界面扩展，code-led；无概念抽签。搜索定位后的焦点与短暂高亮是主要反馈，不增加装饰动效。

FINISH: completed — [finish review](../../.scratch/p1-environment-observation/FINISH-REVIEW.md) verdict `ship`, including the narrow archive-warning correction; [design documentation review](../../.scratch/p1-environment-observation/DESIGN-REVIEW.md) records no new system drift, the pre-existing DESIGN.md / sidecar absence, 18 reviewed base screenshots plus the supplemental [light 960×620 archive-warning capture](../review/p1-observation/archive-errors-light-960.png), and their isolated-fixture provenance; no new shipping raster assets.
