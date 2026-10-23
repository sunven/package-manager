Status: ready-for-agent

# 统一维护历史存储并迁移管理器记录

## Parent

.scratch/package-manager-opportunities/cross-domain-maintenance-history/PRD.md

## What to build

在不改变当前可见界面的前提下，引入 ADR-0027 定义的 v2 跨领域维护历史存储，并让管理器维护写入新存储。本 issue 结束时，现有「总览 > 历史」页仍能显示管理器操作，快照对比不受影响；历史页的跨领域改造留给 issue 02。

### Rust 模型与存储

新增 `src-tauri/src/maintenance_history.rs`：

- 定义线格式类型：`MaintenanceDomain`、`MaintenanceOperation`、`ExecutionSummary`、`FollowUpReadStatus`、`VerificationStatus`、`FollowUpRead`、`Verification`、`MaintenanceRecord`、`MaintenanceRecordSummary`、`ManagerDetail`、`ManagerStep`，以及 PRD 中其余三个领域的 detail 类型。四个领域的类型一次性定义，避免后续 issue 反复改 schema。
- 详情联合由 `detail.kind` 判别：`manager`、`projectCleanup`、`vscodeStorage`、`sessionTrash`、`openCodeDeletion`。
- 文档为 `{ version: 2, items: [...] }`，文件为 `app_data_dir()/manager-history/maintenance-v2.json`。
- 写入沿用现有安全属性：临时文件、`flush`、`sync_all`、原子替换；进程内互斥；损坏或未来版本文件保留原样并返回读取警告，后续写入不得覆盖。
- 保留上限：最多 500 条已关闭记录（`finishedAt != null` 或 `interrupted`），按 `startedAt` 从旧到新裁剪；`finishedAt == null && !interrupted` 的执行中记录始终保留。迁移后同样裁剪。
- 启动时、任何操作开始前，读取 v2 并把上一进程遗留的未关闭记录标记为 `interrupted = true`，保留已写入的逐目标结果与 `execution = "unconfirmed"`。标记失败只产生警告，不阻止启动。

### v1 迁移

- 首次读取时，若 `maintenance-v2.json` 不存在且 `maintenance.json` 存在，读取 v1 并把管理器操作映射为 v2：
  - 保留 `id`、`startedAt`、`finishedAt`、`execution`、`message`、`operation`、`managerId`、`target`、`verification` 与前后快照 ID。
  - `domain = "manager"`、`detail.steps = null`、`followUpRead = null`。
  - `verification` 转为对象；`recordedAt` 为 `null`，消息为原 `verificationMessage`。
  - `finishedAt` 为空的记录标记 `interrupted = true`。
  - 全局包卸载的 `counts.total = 1`，成功／失败按执行摘要映射；旧缓存清理没有结构化步骤，`counts` 全为 0，界面按「无逐步骤数据」展示。
- 写入 v2 后保留 v1 原文件作为备份，不删除、不覆盖。
- v2 已存在时忽略 v1。v1 损坏或版本不支持时不迁移、不覆盖，启动为空历史并提示。
- v2 损坏或版本不支持时保留原文件、提示读取错误；后续写入不得覆盖。

### 读取接口

- 新增 `list_maintenance_history()` → `{ records: MaintenanceRecordSummary[], warnings: string[] }`，按 `startedAt` 倒序，最多 500 条。摘要包含 PRD 定义的 `subject`、`counts`、`followUpReadStatus`、`verificationStatus`。
- 新增 `get_maintenance_record(id)` → `MaintenanceRecord`。记录不存在或已超出保留范围时返回可展示的错误。
- 新增 `record_maintenance_followup(id, status, message)`：仅接受 `sessionRecord` / `vscodeStorage` 领域、已关闭且尚未写入 `followUpRead` 的记录；`status` 限于 `notRequested / ready / failed`。重复写入返回警告，不覆盖第一次事实。该命令供 issue 04 与 06 使用。
- 摘要的 `counts` 从领域负载派生；旧管理器记录没有步骤时返回 0 计数。

### 管理器写入接入

- `manager_history.rs` 继续负责快照，移除或改造操作存储职责；`list_manager_history` 暂时保留现有返回形状（该管理器快照 + 全部管理器操作 + 警告），其中操作从 v2 映射回旧字段，以确保现有 HistoryPanel 不变。
- `run_cache_cleanup`、npm／pnpm 卸载改用新的 `MaintenanceHistoryState` 写入 v2；`receipt.historyId` / `historyWarning` 语义不变。
- 缓存清理把原生 `steps` 转成 `ManagerStep[]` 写入 `ManagerDetail.steps`；全局包卸载保持 `steps = null`。
- `update_maintenance_verification` 改为更新 v2 记录的 `verification`；记录被淘汰时返回现有「维护记录已超出保留范围」类错误。
- 历史写入失败不得改变原生操作结果；管理器现有全局「历史保存提示」继续工作。

### TypeScript

- 新增 `src/maintenanceHistory.ts`，镜像 v2 类型、摘要类型、执行／后续读取／核对标签和计数辅助函数。
- `src/managerHistory.ts` 保留快照类型与差异比较；`ManagerHistory.operations` 暂时保留，由 `list_manager_history` 的旧形状驱动，issue 02 再移除。
- 现有 `MaintenanceRecord` 类型如与新 v2 类型冲突，保留旧类型作为过渡视图模型，避免本轮改动 HistoryPanel。

### 测试

- Rust：v2 序列化往返；原子写入；500 条保留与执行中记录保护；启动中断标记；v1 迁移字段映射与原文件保留；v1／v2 损坏与未来版本保护；并发写入；摘要计数；管理器步骤结构化；旧记录无步骤兼容；后续读取写入的领域、状态与重复写入校验。
- TypeScript：摘要标签与计数辅助函数；现有 HistoryPanel 测试保持通过。
- `cargo test`、`pnpm test`、`pnpm build` 通过。

## Acceptance criteria

- [ ] 新增 v2 统一操作文档，路径与文件名符合 PRD，v1 原文件保留。
- [ ] v1 管理器操作迁移后保留 ID、时间、执行／核对结果和快照链接；旧记录可读。
- [ ] 启动时上一进程未关闭记录被标记为已中断，逐目标结果保留，摘要仍为未确认。
- [ ] 500 条上限只淘汰已关闭记录；执行中记录不被淘汰。
- [ ] 损坏或未来版本文件不被覆盖，读取警告可见。
- [ ] 管理器缓存清理写入结构化步骤；卸载写入目标与结果；核对更新作用于 v2 记录。
- [ ] `list_maintenance_history` 与 `get_maintenance_record` 可用；摘要含领域主题、计数、后续读取与核对状态。
- [ ] 现有 HistoryPanel、快照对比和管理器维护测试不回归。
- [ ] 历史写入失败不改变原生操作结果，回执仍带 `historyId` / `historyWarning`。

## Blocked by

无。

## Comments

- 2026-10-23：由设计访谈创建。实现依据 ADR-0027 与 PRD。
