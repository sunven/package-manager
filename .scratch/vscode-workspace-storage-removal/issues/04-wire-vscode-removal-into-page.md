Status: done

# 把选择、确认、进度和结果接入 VS Code 占用页

## Parent

.scratch/vscode-workspace-storage-removal/PRD.md

## What to build

在 `src/components/VscodeStoragePage.tsx` 接上 issue 03 的 workflow，完成用户可见的移除流程。布局沿用现有页面和 `SessionRecordsPage` 的交互模式。

### 页面状态与徽标

- 页头徽标从「只读」改为「可移除」；范围说明保持不变。
- 四张汇总卡片保持不变，不新增「可移除」卡片。
- 编辑器状态不是 `"Stopped"` 时，在页头与汇总卡片之间显示提示：
  - `Running`：「VS Code 正在运行」；说明退出 VS Code 后才能移入废纸篓，运行中的扩展宿主可能在退出时回写工作区存储。
  - `Unknown`：「无法确认 VS Code 是否运行」；说明请退出 VS Code 后刷新重试。
  - 首次检测尚未完成（`editorStatus === null` 且正在检查）时不要闪现 `Unknown` 横幅；按钮保持禁用即可。
- 扫描错误、`Partial` 统计、骨架屏和空状态的现有文案与行为不变。

### 选择

- 表格增加一列复选框；只有 `workspace.removable` 为 true 的行可勾选。
- 不可移除的行保持复选框禁用，并在 `aria-label` 和 `title` 中给出 `removalBlockReason`，不能只靠状态徽标解释（例如符号链接记录的状态仍是「未识别工作区」）。
- 使用 `useSessionSelection`，`records` 传当前搜索/排序后的 `workspaces`，`isSelectable` 为 `workspace.removable`，`completedIds` 来自 `outcome?.completedIds`。这样搜索会裁剪隐藏的选择，与会话记录页一致。
- 表头是视觉隐藏的「选择」列标题；不增加表头全选框。

### 工具栏

在「工作区记录」面板内、表格上方增加工具栏：

- 「全选可移除」：只选当前搜索结果中可见且可移除的记录；没有可选记录或已全选时禁用。
- 「取消选择」：没有选择时禁用。
- 「移除 N 项」：destructive；没有选择、正在扫描、正在检测编辑器、编辑器不是 `Stopped` 或操作进行中时禁用；执行中显示「正在移入废纸篓」。
- 扫描进行中禁用选择与工具栏，避免对旧快照操作。
- 点击「移除 N 项」时调用 `workflow.request({ workspaces: selectedWorkspaces })`：
  - 返回 `true`：`operation` 进入 `confirming`，打开确认框。
  - 返回 `false`：不打开确认框；编辑器横幅已经由 `checkEditor()` 更新，保持当前选择。
- 记下触发按钮的 ref，关闭确认框后把焦点还给该按钮（按钮若已禁用则不强行聚焦）。

### 确认框

使用 `AlertDialog`，打开条件为 `operation !== null`：

- 标题「确认移入废纸篓」。
- 说明包含条数和合计占用，使用 `summarizeVscodeRemoval` + 现有 `formatFootprint`（统计不完整时带 `≥`）。
- 冻结的目标列表（`operation.target.workspaces`）放在可滚动、可聚焦的 `role="list"` 中，每项展示：
  - 项目/工作区名称，项目路径或「项目位置未知」。
  - 状态徽标，沿用页面的 `projectStatusLabels`。
  - 存储目录 ID 与经过 `formatHomePath` 的路径。
  - 目录占用，不完整时带下限。
- 风险说明：
  - 「路径不存在」可能是外接磁盘未挂载或项目被移动。
  - 「未识别」记录可能仍包含扩展数据。
  - 执行时会重新检查，项目路径恢复或记录变化的目标会被跳过。
  - 移除期间请保持 VS Code 退出。
  - 清空废纸篓前可恢复；移入废纸篓不代表磁盘空间立即释放。
- 只对有对应状态存在的风险显示提示；废纸篓和复核说明始终显示。
- 执行中（`operation.phase === "executing"` 且有进度）显示：
  - `vscodeRemovalProgressText` 文案。
  - `role="progressbar"`、`aria-valuemin`/`aria-valuemax`/`aria-valuenow` 和可视进度条。
  - `vscodeRemovalProgressDetail` 的已移入/跳过/失败计数。
- 底部按钮：
  - 「取消」：执行中禁用；关闭且仍在 `confirming` 时调用 `workflow.cancel(operation.id)`。
  - 「移入废纸篓 N 项」：执行中禁用并改为「正在移入废纸篓」；点击阻止默认关闭并调用 `workflow.confirm(operation.id)`。
- `onOpenChange` 只在 `confirming` 阶段响应关闭；`executing` 阶段不能关闭。
- 执行阶段对话框保持打开；进入刷新阶段后关闭，先显示结果，再显示列表刷新状态（与会话记录移除一致）。

### 结果与刷新

- `outcome` 存在时，在页面中显示结果 `Alert`：
  - `vscodeRemovalResultText` 的已移入/跳过/失败摘要。
  - `result.operationError` 或 `outcome.error` 时使用 destructive 样式。
  - `result.message`（例如「VS Code 已启动，剩余 N 项未处理」）原样展示。
  - 用 `<details>` 列出逐项结果：记录 ID（能从冻结目标中找到时带名称）、状态、`vscodeRemovalReasonLabel` 和消息。
- 刷新状态与会话记录页一致：
  - `outcome.refresh.status === "refreshing"`：显示正在刷新列表。
  - `"failed"`：单独显示「列表刷新失败」和消息，不覆盖操作结果。
  - `"ready"`：不额外显示成功提示。
- 完成后扫描自动更新；被移动的记录不再出现。下一次 `request` 会清空上一次结果（由 `begin` 完成）。

### 无障碍与测试

- 复选框、工具栏按钮、进度条和结果列表都有可读的 `aria-label`；不可移除原因可被读屏获取。
- 更新 `VscodeStoragePage.test.tsx`：
  - 删除「页面没有 checkbox / 清理 / 删除」的只读断言。
  - 保留并调整重复项目、缺失/未知汇总、下限、空状态和保留上次结果的断言。
  - 新增：可移除行有可用复选框；不可移除行禁用并带原因；「可移除」徽标；四张卡片不变；编辑器 `Running`/`Unknown` 横幅与移除按钮禁用。
- 新增 jsdom 交互测试（沿用 `SessionRecordsPage.interaction.test.tsx` 的 Tauri mock 方式）：
  - 勾选单行、全选当前结果、取消选择；搜索后隐藏的选择被裁剪。
  - 编辑器 `Running` 时点击移除不打开确认框。
  - 确认框列出完整目标、合计占用、风险说明和按钮文案。
  - 确认后显示进度、执行中按钮禁用；模拟进度回调后计数变化。
  - 结果区显示已移入/跳过/失败与逐条原因；刷新失败单独提示。
  - 关闭确认框（仅 `confirming`）后焦点回到触发按钮。
- 组件测试不要调用真实的 Tauri 命令。

## Acceptance criteria

- [ ] 页头显示「可移除」，四张汇总卡片保持不变。
- [ ] 表格有复选框列；只有可移除记录可选，不可移除记录禁用并说明原因。
- [ ] 工具栏的「全选可移除」只覆盖当前搜索结果中的可移除记录；「取消选择」和「移除 N 项」状态正确。
- [ ] VS Code 运行中或状态未知时显示横幅，移除按钮禁用；点击移除会重新检测，不是 `Stopped` 就不打开确认框。
- [ ] 确认框显示条数、合计占用、完整目标列表、废纸篓/外接盘/未识别风险和执行时复核说明。
- [ ] 执行中显示流式进度和已移入/跳过/失败计数；不能取消或关闭对话框。
- [ ] 结果区区分已移入、跳过、失败，展示逐条原因和部分完成消息；完成后自动重扫。
- [ ] 重扫失败单独提示，不覆盖操作结果。
- [ ] 关闭确认框后焦点回到触发按钮；不可移除原因可被读屏获取。
- [ ] 原有扫描、搜索、排序、空状态和保留上次结果行为不变。
- [ ] `pnpm test` 与 `pnpm build` 通过。

## Blocked by

- .scratch/vscode-workspace-storage-removal/issues/03-add-vscode-removal-lifecycle.md

## Comments

- Added the checkbox column, toolbar, "可移除" badge, editor banner, confirmation dialog, streamed progress, result Alert, and refresh notice.
- Only backend-removable rows are selectable; disabled checkboxes expose the reason through `aria-label` and `title`.
- The dialog closes when execution ends and refresh starts, matching the session-record pattern; the result is shown while the list refreshes. The issue text was updated to record this.
- Replaced the old read-only assertions. 7 static page tests and 5 interaction tests pass; the full frontend suite (372 tests) and `pnpm build` pass.
