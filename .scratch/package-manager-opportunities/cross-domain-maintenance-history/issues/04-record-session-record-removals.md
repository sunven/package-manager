Status: ready-for-agent

# 记录 Codex／Claude 会话记录移除

## Parent

.scratch/package-manager-opportunities/cross-domain-maintenance-history/PRD.md

## What to build

会话记录移入废纸篓的两种入口（单条／选中、按年龄）写入统一维护历史。确认范围区分「逐条冻结」与「只冻结规则」；执行时逐条写入结果；自动重扫结束后把重扫状态写入后续读取。本 issue 不新增可见 UI，结果区回链在 issue 07。

### Rust

- 扩展 `remove_session_records` 与 `remove_session_records_older_than` 的参数：
  - 单条／选中：`source`、`ids`，以及 `confirmedRecords` 展示快照（`id`、`title`、`workingDirectory`、`lastActivityMs`）。后端校验每个 ID 仍指向该来源内的普通会话记录；展示字段只用于历史，不参与资格判断。
  - 按年龄：`source`、`days`、`confirmedCount`。不接收记录 ID。
- 在执行循环开始前创建记录：
  - `domain = "sessionRecord"`、`operation = "removeToTrash"`、`scope.source`、`scope.mode`。
  - 单条／选中写 `confirmedRecords`；按年龄写 `days` 与 `confirmedCount`，`confirmedRecords = null`。
  - 执行时扫描得到的候选总数写入 `detail.executionTotal`。
- 每个 `SessionRemovalItem` 产生后立即追加到记录；结束后写入 `finishedAt` 并按 PRD 规则派生摘要。
- `SessionRemovalResult`（或回执包装）增加可选 `historyId` / `historyWarning`；历史写入失败不改变移除结果、逐项状态、来源级错误或进度。
- 来源级 `operation_error` 写入 `notExecuted`，不计为目标失败；逐项跳过原因原样保留。
- 不写 `verification`；`followUpRead` 由前端在自动重扫后通过 issue 01 的 `record_maintenance_followup` 写入。

### 前端

- 扩展 `PendingRemoval` 或执行参数，使单条／选中目标携带完整 `SessionRecord` 展示快照；按年龄目标携带 `days` 与确认时条数。
- `useSessionRecords` 的 `execute` 把上述确认范围传给原生命令。
- 扩展共享 `useSessionOperation`：
  - 自动重扫结束后，若结果带 `historyId`，调用适配器的后续读取写入函数；手动刷新不写历史。
  - 写入内容为最终 `SessionRefresh`：`ready` / `failed`；若领域允许 `notRequested` 也写入。
  - 写入失败只产生 UI 警告，不改变操作结果。
- 适配器通过 `record_maintenance_followup` 原生命令写入；本 issue 先由会话记录适配器实现，issue 06 复用同一机制。
- 页面结果对象保留 `historyId` / `historyWarning`，供 issue 07 渲染回链。

### 测试

- Rust：
  - 单条、选中、按年龄三种模式写出的 `scope` 字段。
  - 按年龄的 `confirmedCount` 与执行时 `executionTotal` 可以不同。
  - 逐条 `Moved / Skipped / Failed` 与原因保留；来源级 `operation_error` 生成 `notExecuted`。
  - 历史开始、逐条追加或关闭失败不影响移除结果与进度。
  - 后续读取命令拒绝非会话领域、未关闭记录、重复写入和非法状态。
- TypeScript：
  - `execute` 发送确认范围；单条／选中包含展示快照，按年龄不发送 ID。
  - 自动重扫 `ready` / `failed` 后各写一次后续读取；手动刷新不写。
  - `historyId` 缺失时不调用后续读取；写入失败只显示警告。
  - 现有 `useSessionOperation` 会话相关测试不回归。
- `cargo test`、`pnpm test`、`pnpm build` 通过。

## Acceptance criteria

- [ ] 单条、选中、按年龄三种会话移除各生成一条维护记录。
- [ ] 单条／选中保存逐条展示快照；按年龄只保存来源、门槛和确认时条数。
- [ ] 执行时逐条结果与跳过原因写入历史，来源级错误不折算成目标失败。
- [ ] 自动重扫后写入一次后续读取；手动刷新不回写。
- [ ] 历史写入失败不改变移除结果、进度或来源级错误。
- [ ] 移除记录不写核对字段。
- [ ] 结果对象携带 `historyId` / `historyWarning`，供后续 UI 回链。

## Blocked by

- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/01-add-unified-maintenance-history-store.md

## Comments

- 2026-10-23：由设计访谈创建。按年龄模式只冻结规则，不能伪造逐条确认范围。
