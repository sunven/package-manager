Status: ready-for-agent

# 新增观察覆盖度页与概览摘要

## Parent

.scratch/observation-coverage/PRD.md

## What to build

在健康页新增「观察覆盖度」页签，接入 issue 06 的模型和 issue 02–05 的实时状态与台账，替换概览页的管理器状态卡为覆盖度摘要卡。页面只读，不执行维护，打开时不触发任何来源读取。

### 页面骨架

- `src/App.tsx` 的健康页页签增加 `coverage`，顺序为「概览 / 环境诊断 / 观察覆盖度」。
- 新增 `src/components/ObservationCoveragePage.tsx`：
  - 顶部标题与说明；
  - 汇总条：按主徽章状态计数，不显示百分比、不显示全局最后更新时间；
  - 固定顺序的分组卡片：管理器、环境诊断、项目派生数据、VS Code、会话记录、Codex、Claude Code；
  - 管理器组内分「已启用 / 已停用」，默认展开；Codex 与 Claude 默认折叠，组头显示需注意数量；其他组默认展开；
  - 行内容按 PRD：名称、主徽章、观察/尝试时间、范围、完整性/原因、范围变化提示、「本次会话尚未读取」、操作按钮；
  - 空台账仍显示完整 25 项地图，并显示顶部提示；
  - 台账读取/写入警告以非阻塞提示呈现；来源错误只显示摘要，完整错误留在来源页；
  - 分组折叠可键盘操作，徽章文本不依赖颜色。
- 不做搜索、筛选、全局刷新或维护入口。

### 数据接线

- 在 App 层调用 issue 01 的 `useObservationLedger` 与范围描述加载；台账在应用启动时加载，范围描述在启动和已启用管理器变化时加载。页面本身不调用任何 Tauri 命令。
- 用各现有 hook 的当前状态构造 `ObservationFacts`（issue 06），再用 `buildObservationCoverage` 生成模型；使用 `useMemo` 避免无谓重建。
- 把模型和警告传给 `ObservationCoveragePage` 与概览摘要卡。
- 现有来源 hook 继续按原 `activeView` 决定自动读取；覆盖度页不激活任何来源 hook，也不改变现有自动读取时机。
- 若某个来源的状态尚未加载，模型只使用台账并显示「上次观察」或「未观察」。

### 操作与导航

- **查看**：
  - 管理器行：选择管理器并进入 `managers`；
  - 环境诊断：切到健康页 `environment` 页签；
  - 项目派生数据：进入 `cleanup`；
  - VS Code：进入 `vscode`；
  - 会话记录：进入 `sessions`；
  - Codex：进入 `plugins`，并按观察项切到 `marketplaces`、`hooks` 或 `skills`；
  - Claude Code：进入 `claude`，并切到对应页签。
- **调整范围／设置**：
  - 管理器行（含已停用）：按钮文案为「设置」，进入 `settings`；
  - 项目扫描行：按钮文案为「调整范围」，进入 `cleanup`；
  - 其他来源不显示该按钮。
- **刷新**：
  - 管理器组头：调用现有 `refreshEnabled()`；扫描中或维护中禁用；
  - 环境诊断：调用现有环境刷新；
  - VS Code：调用现有刷新；
  - 会话记录：按观察项调用 `refresh(["codex"])`、`refresh(["claude"])` 或 OpenCode 刷新；
  - Codex：调用 issue 05 暴露的单项读取（市场、插件、Hooks、Skills）；
  - Claude Code：调用现有按页签刷新（市场/插件、Hooks、Skills）；
  - 项目扫描：不提供刷新；
  - 刷新只更新对应行/组，不切换页签；读取中禁用重复操作；维护中禁用所有刷新；
  - 没有全局刷新。
- 打开覆盖度页、切换分组或展开折叠不得调用任何来源读取；只有用户点击刷新时才调用。

### 概览页摘要

- 从 `OverviewDashboard.tsx` 移除「管理器状态」卡片列表及其仅用于该卡片的 props（`managerSnapshots`、`scanStates` 若不再使用）。
- 新增「观察覆盖度」摘要卡：
  - 已观察数量（含部分）；
  - 需注意数量；
  - 未观察/部分/失败的简要分解（仅在非零时显示）；
  - 已停用管理器数量；
  - 「查看观察覆盖度」按钮。
- 保留三张统计卡、开发健康信号、目录占用 Top 5 和「扫描已启用管理器」按钮。
- 不复制覆盖度页的行列表，不显示全局最后更新时间。

### 测试

- 页面：25 项渲染、分组顺序、默认折叠、组头需注意计数、管理器已启用/已停用、主徽章优先级、时间与范围文案、空台账、台账警告、只读边界。
- 接线：打开页签不调用任何命令（包括 `scan_*`、`inspect_environment`、会话/扩展读取、台账与范围描述）；台账与范围描述在 App 启动时已加载。启用管理器变化时允许重新加载范围描述。
- 操作：每个查看按钮进入正确页面/页签；每个刷新按钮调用正确来源且不切换页签；刷新中禁用；项目扫描没有刷新；没有全局刷新。
- 概览：管理器状态卡被摘要卡替换；三张统计卡仍在；摘要计数与覆盖度页一致；入口可用。
- 回归：现有健康页、环境诊断、管理器、项目清理、VS Code、会话、Codex、Claude 与历史页测试不回归。
- `pnpm test`、`pnpm build`、`cargo test` 通过。

## Acceptance criteria

- [ ] 健康页第三个页签为「观察覆盖度」，概览页管理器状态卡已替换为摘要卡。
- [ ] 25 项按固定分组与折叠规则显示，空台账仍显示完整地图。
- [ ] 主徽章、时间、范围、完整性、需注意计数与 PRD 一致。
- [ ] 查看与调整范围进入正确页面/页签；逐项刷新只触发对应来源。
- [ ] 打开页签不调用任何命令，也不触发来源读取；没有全局刷新、搜索、筛选或维护入口。
- [ ] 已停用管理器不计入需注意，仍保留上次观察并可去设置。
- [ ] 台账与来源错误以非阻塞方式呈现，不遮蔽可用内容。
- [ ] 三张统计卡、健康信号和 Top 5 保持；现有测试不回归。

## Blocked by

- .scratch/observation-coverage/issues/02-record-manager-observations.md
- .scratch/observation-coverage/issues/03-record-environment-and-project-observations.md
- .scratch/observation-coverage/issues/04-record-vscode-and-session-observations.md
- .scratch/observation-coverage/issues/05-record-codex-and-claude-observations.md
- .scratch/observation-coverage/issues/06-build-observation-coverage-model.md

## Comments

- 2026-10-23：由设计访谈创建。页面只读；打开页签只读取台账和范围描述，来源读取必须由用户点击刷新触发。
