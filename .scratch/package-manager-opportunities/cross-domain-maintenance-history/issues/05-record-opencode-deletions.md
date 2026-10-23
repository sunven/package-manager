Status: ready-for-agent

# 记录 OpenCode 会话永久删除

## Parent

.scratch/package-manager-opportunities/cross-domain-maintenance-history/PRD.md

## What to build

OpenCode 永久删除已有 Rust 侧准备计划与 `planId`。在 commit 时把计划中的冻结根／级联快照写入维护历史，逐根写入结果，记录实际完成 ID，并在自动重扫后写入后续读取。历史必须显示执行时新增的后代与冻结计划之间的漂移。

### Rust

- `commit_opencode_deletion` 在消费计划前取得并冻结历史范围：
  - `domain = "sessionRecord"`、`operation = "deletePermanently"`。
  - `scope.source = "opencode"`、`scope.planId`、`scope.days`、`scope.cutoffMs`。
  - `scope.mode`：把原生 `kind` 映射为 `single / selected / olderThan`。
  - `scope.confirmedRoots` 与 `scope.confirmedAffected` 保存计划中的完整会话展示快照（ID、标题、工作目录、最后活动时间、归档、父会话 ID）。
- 创建记录后逐根写入 `OpenCodeDeletionItem`；结束后写入 `detail.completedIds` 与 `finishedAt`，并按 PRD 规则派生摘要。
- 若 `preflight_error` 非空：记录 `notExecuted`，不写目标成功；没有删除目标时结果仍保留错误信息。
- 若首个失败后剩余根为 `NotAttempted`：摘要按「无成功且有失败」→ `failed`；有成功且存在失败／未开始 → `partial`。
- 计划在 commit 时被消费，历史只保存 `planId` 与冻结快照；不要依赖计划在 commit 后仍可读取。
- `OpenCodeDeletionResult`（或回执包装）增加可选 `historyId` / `historyWarning`；历史失败不改变删除结果、完成集合或预检错误。
- 不写 `verification`；后续读取由前端写入。

### 漂移判定

- 详情和列表摘要都能看出实际完成集合与冻结计划的关系：
  - `completedIds` 中属于 `confirmedRoots` 或 `confirmedAffected` 的为计划内完成。
  - `completedIds` 中不属于 `confirmedAffected` 且不在 `confirmedRoots` 中的 ID 标记为「计划外新增后代」。
- 计划外新增后代不是失败，也不改变执行摘要；详情单独提示数量与标题（若历史中保存了其展示信息）。历史只保存计划快照，无法为未保存的 ID 补标题时显示 ID。

### 前端

- `useOpenCodeSessions` 的结果保留 `historyId` / `historyWarning`。
- 自动重扫：
  - `shouldRefresh` 为 true 时，重扫完成后通过 issue 01 的 `record_maintenance_followup` 写入 `ready` / `failed`。
  - `preflight_error` 导致 `shouldRefresh` 为 false 时，写入 `notRequested`。
- 复用 `useSessionOperation` 在 issue 04 增加的「自动重扫后写后续读取」能力；本 issue 只提供 OpenCode 适配器的字段映射。
- 本 issue 不新增可见 UI；回链在 issue 07。

### 测试

- Rust：
  - 单条、选中、按年龄计划写入 `planId`、门槛、冻结根／级联快照。
  - `completedIds` 包含根与级联后代；计划外新增后代可被识别。
  - `preflight_error` 生成 `notExecuted`；部分成功／首败停止的摘要正确。
  - 历史写入失败不改变删除结果与 `completed_ids`。
  - 计划已被消费后仍能通过历史读取冻结范围。
- TypeScript：
  - `preflight_error` 时写入 `notRequested`；成功／部分成功自动重扫后写入 `ready` 或 `failed`。
  - `historyId` 缺失时不调用后续读取。
  - 现有 OpenCode 删除测试不回归。
- `cargo test`、`pnpm test`、`pnpm build` 通过。

## Acceptance criteria

- [ ] OpenCode 永久删除生成一条维护记录，操作类型为 `deletePermanently`。
- [ ] 确认范围保存 `planId`、门槛、冻结根与级联快照，不依赖 commit 后的内存计划。
- [ ] 逐根结果、实际 `completedIds` 与执行摘要写入历史。
- [ ] 计划外新增后代在详情中可见，但不计为失败。
- [ ] 预检失败记录为 `notExecuted`；自动重扫关闭时后续读取为 `notRequested`。
- [ ] 历史写入失败不改变删除结果或完成集合。
- [ ] 结果对象携带 `historyId` / `historyWarning`，供后续 UI 回链。

## Blocked by

- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/01-add-unified-maintenance-history-store.md

## Comments

- 2026-10-23：由设计访谈创建。计划在 commit 时消费，历史必须在消费前冻结范围。
