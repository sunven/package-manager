Status: ready-for-agent

# 新增顶层历史页

## Parent

.scratch/package-manager-opportunities/cross-domain-maintenance-history/PRD.md

## What to build

把「历史」从「总览」的子页签提升为顶层入口，包含「维护记录」与「快照对比」两个分区。维护记录使用 issue 01 的摘要 / 详情接口；快照对比保留现有行为。本 issue 只接管理器领域，项目清理、会话与 VS Code 记录在后续 issue 写入后自动出现在列表中。

### 导航与页面骨架

- 在 `src/components/Shell.tsx` 的 `ViewId`、`views`、`handlers` 和 `src/App.tsx` 的分支中加入 `history`，导航顺序放在「总览」之后。
- 从健康页移除「历史」子页签，健康页只保留「概览」与「环境诊断」。
- 新增 `src/components/HistoryPage.tsx`，顶部提供「维护记录」/「快照对比」两个分区；默认显示维护记录。
- 总览保留「历史」快捷入口，点击进入顶层历史页。
- 导航与页面接受可选请求 `{ domain?: MaintenanceDomain; recordId?: string }`，供领域页回链使用；本 issue 先支持参数解析与选中，实际回链在 issue 07 接线。

### 维护记录数据

- 新增 `src/hooks/useMaintenanceHistory.ts`：
  - 进入页面或 `historyRevision` 变化时调用 `list_maintenance_history()`。
  - 暴露 `records`、`warnings`、`loading`、`error`、`refresh`。
  - 选中记录时调用 `get_maintenance_record(id)`，暴露 `detail`、`detailLoading`、`detailError`；切换记录时丢弃过期响应。
  - 手动刷新同时刷新摘要与当前详情。
- 复用 App 现有 `historyRevision`；本 issue 确保管理器快照保存、管理器维护回执和核对写入仍会递增它。后续领域在各自 issue 中接入同一个修订号。
- 读取失败时保留上一次成功列表并显示错误；`warnings` 以「部分历史无法读取」呈现，不遮蔽列表。

### 维护记录列表

- 按本地日期分组、`startedAt` 倒序。
- 每条显示：时间、领域标签、操作标签、主题（管理器／包名、扫描根目录、来源／模式、目标数量）、执行摘要、目标计数、后续读取／核对状态。
- 领域单选：全部、管理器维护、项目清理、VS Code 工作区存储移除、会话记录操作。
- 状态筛选：全部、已完成、部分完成、失败、未执行、未确认。
- `finishedAt == null && !interrupted` 显示「执行中」；`interrupted` 显示「已中断」；两者都归入「未确认」筛选。
- 客户端筛选摘要；每页 50 条，提供上一页／下一页；筛选变化回到第一页。
- 空状态区分「还没有维护记录」与「当前筛选没有匹配记录」。
- 首版不提供时间范围、全文搜索、⌘K 集成、清空或导出。

### 记录详情

- 主从布局：列表 + 右侧详情；窄窗口用覆盖层展示详情。
- 详情按 PRD 顺序渲染：
  1. 恢复边界说明（按领域与操作映射；未知领域不臆测）。
  2. 确认范围：管理器、项目清理、VS Code、会话的领域字段与目标展示快照；按年龄会话显示确认时条数与执行时总数。
  3. 执行结果：批次汇总 + 逐目标表格；复用领域状态／原因标签；项目清理按 `scope.candidates` 与 `results` 差集显示「未执行（批次停止）」；中断记录显示「未确认」。
  4. 后续读取或核对：状态、时间、消息；管理器提供前后快照入口；没有时显示「无后续读取」/「无核对步骤」。
  5. 关联入口：管理器可跳到快照对比并选中关联快照；其他领域显示对应页面入口。
- 漂移提示：OpenCode 实际完成包含计划外新增后代、按年龄会话确认条数 vs 执行总数、项目清理停止后未开始的目标。
- 空间数字只显示目录占用／测量下限；会话操作没有测量时不显示大小。
- 历史详情不重新读取目标现状。

### 快照对比分区

- 从 `src/components/ObservationTools.tsx` 抽出快照选择、前后快照差异、详情和关联快照导航，保持现有行为与文案。
- 新增或复用管理器快照 hook：进入分区时按当前管理器读取快照；支持手动刷新；读取错误与警告行为不变。
- 移除 `HistoryPanel` 中的维护操作列表，维护操作只由维护记录分区显示。
- 从维护记录详情跳转快照对比时，选中对应管理器与前后快照；快照已超出保留范围时显示现有缺失提示。

### 测试

- 导航：`history` 顶层入口存在；健康页不再有历史子页签；总览快捷入口进入历史页。
- 列表：日期分组、领域／状态筛选、分页、空状态、执行中／已中断标签。
- 详情：摘要选中后调用 `get_maintenance_record`；五个分节；缺失后续读取 / 核对文案；漂移提示；过期响应丢弃。
- 回链参数：携带 `{ domain, recordId }` 时切换到维护记录、应用领域筛选并选中记录。
- 快照对比：现有 `ObservationTools.test.tsx` 中的快照行为迁移后仍通过；从详情跳转能选中快照。
- `pnpm test` 与 `pnpm build` 通过。

## Acceptance criteria

- [ ] 顶层「历史」导航位于「总览」之后，健康页不再有历史子页签。
- [ ] 历史页默认显示维护记录，可切换到快照对比；总览快捷入口可用。
- [ ] 维护记录按日期分组、支持领域／状态筛选与 50 条分页。
- [ ] 选中记录后按需加载详情，五个分节与漂移提示符合 PRD。
- [ ] 执行中与已中断在未确认摘要内可区分。
- [ ] 快照对比行为与现有版本一致，并可从记录详情跳转。
- [ ] 历史读取失败与部分读取警告不遮蔽已加载内容。
- [ ] 不出现全文搜索、时间范围、清空或导出入口。
- [ ] 现有管理器维护与历史测试不回归。

## Blocked by

- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/01-add-unified-maintenance-history-store.md

## Comments

- 2026-10-23：由设计访谈创建。快照对比从总览历史页迁移，避免两个历史入口。
