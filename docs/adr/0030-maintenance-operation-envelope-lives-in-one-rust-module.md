# 维护操作外壳集中在一个 Rust 模块，闭包集共享生命周期

四个单命令维护领域（会话记录移除、OpenCode 永久删除、VS Code 工作区存储移除）与 manager 维护在 `lib.rs` 中各自重复 begin → 逐目标追加 → finish/abort，五份实现已经出现顺序差异，且都不在测试覆盖内。决定由新的 `maintenance_operation` 模块拥有维护操作外壳与 `Receipt`，由新的 `maintenance_adapters` 模块拥有各领域的确认范围冻结、执行、逐目标记录和结束摘要；`maintenance_history` 退回为存储，只保留记录读写、保留上限、迁移、列表/详情与快照存在性核对。外壳通过一组闭包（执行、记录、结束）驱动，而不是 trait；结束闭包接收 `Completed` 或 `Aborted` 两种结果。

## Considered Options

- 定义带关联类型的 `OperationAdapter` trait：四个调用点只有一份 interface 实现，关联类型只增加仪式感；闭包集已经被 manager 的 `run` 验证。否决。
- 保持闭包内联在各 `lib.rs` 命令里：编排去重了，但领域记录策略仍留在 IPC 层。否决。
- 现在就支持「begin 返回 handle、稍后追加/结束」：唯一需要它的项目清理正在被合并为单一批次命令。否决。
- 本次一并迁移项目清理：会把结构重构与批次停止/失败语义的改动混在一起。否决。
- 新模块 + 适配器模块 + 闭包集：采纳。

## Consequences

- 适配器的执行返回 `Err` 表示没有任何操作目标被执行；中途失败必须转成 `Ok` 加逐项结果。外壳据此在 `Err` 时把记录结束为 `NotExecuted`。现有四个领域均满足该契约。
- 历史写入失败只记首条警告（begin → 逐项 → finish），且不改变操作结果；逐目标写入继续，使中断记录保留已写入的部分结果。
- 命令名、参数与 `Receipt` 的扁平形状保持不变，前端零改动。
- `update_maintenance_verification` 与 `record_followup` 随领域记录语义移入适配器；存储只暴露窄化的快照存在性核对。
- 适配器入口接受注入的执行依赖，测试用假执行驱动；外壳与适配器各用外部 `*_tests.rs` 文件覆盖。
- `MaintenanceHistoryState` 名称保留，角色由模块边界区分。
- 项目清理等待其批次命令合并后再迁入外壳；ADR-0023 与 ADR-0027 继续有效。
