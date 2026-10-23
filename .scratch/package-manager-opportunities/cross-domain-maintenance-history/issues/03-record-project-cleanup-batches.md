Status: ready-for-agent

# 记录项目清理批次

## Parent

.scratch/package-manager-opportunities/cross-domain-maintenance-history/PRD.md

## What to build

项目清理的批次边界只存在于前端。为本领域增加由 Rust 验证的批次记录：开始批次时从当前扫描会话派生确认范围，每个候选清理后追加结果，批次结束或停止时关闭记录。历史写入失败不得阻止清理，也不得改变批次结果。

### Rust

- 在维护历史模块中增加项目清理负载写入能力，复用 issue 01 的 v2 存储、保留、中断和摘要规则。
- 新增命令 `begin_project_cleanup_history({ scanId, batchId, candidateIds })`：
  - 校验 `scanId` 是当前授权扫描会话，`candidateIds` 按确认顺序包含当前会话中的候选且不重复。
  - 从服务端扫描会话派生 `ProjectCleanupCandidateSnapshot`：候选 ID、类型、项目路径、目录路径、顺序、确认时字节、测量是否完整。不要信任前端提交的路径或测量。
  - 创建记录并返回 `historyId`；失败返回 `historyWarning`，不阻止后续清理。
- 修改 `clean_project_data_candidate`，增加可选 `historyId`：
  - 在既有清理结果产生后追加 `ProjectCleanupTargetResult`。
  - 只保存状态、命令、前后字节、清理字节、测量状态、消息和失败消息；不保存 stdout／stderr。
  - 追加失败只返回历史警告，不改变 `ProjectCleanupResult`。
- 新增命令 `finish_project_cleanup_history({ historyId, finish, effectFailures, message })`：
  - `finish` 为 `completed` 或 `stopped`。
  - `effectFailures` 是前端捕获的 IPC 失败 `{ candidateId, message }[]`；只接受当前记录 `scope.candidates` 内的 ID，写入状态为 `Failed`、`effectFailureMessage` 非空的子结果。
  - 派生执行摘要并设置 `finishedAt`：首个目标前停止为 `notExecuted`；有成功且存在失败／跳过／未开始为 `partial`；全部成功为 `succeeded`；没有成功但有失败为 `failed`。
  - 记录不存在或已关闭时返回警告。
- 项目清理记录不写 `followUpRead` 或 `verification`。

### 前端工作流

- 扩展 `ProjectCleanupEffects`：新增 `beginHistory`、`finishHistory`；`clean` 参数增加可选 `historyId`。
- 在 `runCleanupBatch` 进入循环前调用 `beginHistory`，参数为当前 `scanId`、`batchId` 和已冻结的候选顺序。
  - 失败时保留 `historyWarning`，继续执行清理；`historyId` 为 null 时后续不调用 `finishHistory`。
- 每次 `effects.clean` 传入 `historyId`。
- 循环结束后调用 `finishHistory`：
  - `finish` 使用批次已确定的 `completed` / `stopped`。
  - `effectFailures` 收集循环中 `effect-failed` 的候选与消息。
  - 关闭失败追加警告，不改变批次结果。
- 批次结果（`CleanupBatchSummary` 或新的回执类型）携带 `historyId` 与 `historyWarning`，供 issue 07 的结果区回链；本 issue 不新增可见 UI。
- 历史写入失败不能影响选择、候选状态、清理字节或批次摘要。

### 测试

- Rust：
  - 开始命令拒绝过期扫描、跨会话候选、重复 ID 和顺序不符。
  - 开始范围从服务端派生，忽略前端伪造字段。
  - 逐候选追加成功、失败、部分完成与测量不完整。
  - IPC 失败通过 `effectFailures` 写入，且拒绝范围外 ID。
  - 完成、停止、首个目标前停止、中途停止的摘要派生。
  - 历史写入失败不改变清理结果。
- TypeScript：
  - `beginHistory` 在首个候选前调用一次；失败时继续清理。
  - `clean` 收到 `historyId`；`finishHistory` 收到完成／停止、effect failures 与消息。
  - 批次摘要保留原计数与字节，并附加历史回执字段。
  - 现有项目清理工作流测试不回归。
- `cargo test`、`pnpm test`、`pnpm build` 通过。

## Acceptance criteria

- [ ] 项目清理批次创建一条记录，确认范围来自服务端当前扫描会话与前端冻结顺序。
- [ ] 每个候选完成后写入独立结果；IPC 失败通过受校验的 `effectFailures` 写入。
- [ ] 批次完成、停止、首个目标前停止的摘要符合 PRD。
- [ ] 项目清理记录没有后续读取或核对字段。
- [ ] 历史写入失败只产生警告，不影响清理执行、候选状态或批次结果。
- [ ] 批次回执携带 `historyId` / `historyWarning`，供后续 UI 回链。
- [ ] stdout／stderr 不进入历史。

## Blocked by

- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/01-add-unified-maintenance-history-store.md

## Comments

- 2026-10-23：由设计访谈创建。批次开始点定在 `runCleanupBatch` 进入循环前，不在确认框打开时。
