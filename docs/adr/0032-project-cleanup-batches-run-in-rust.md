# 项目清理批次在 Rust 中执行，扫描与测量留在前端

已确认的项目清理批次此前由前端串起 `begin_project_cleanup_history`、逐项 `clean_project_data_candidate` 和 `finish_project_cleanup_history` 三个命令；停止、逐项结果、effect failure 与最终摘要都只存在于 TypeScript 视图。决定改由一个 `run_project_cleanup_batch` 命令执行冻结批次，新增 `request_project_cleanup_stop` 按批次标识设置停止标志；逐项进度通过 Channel 回传，history 的开始、逐项追加与结束都在 Rust 执行点完成。扫描与测量仍由前端驱动，本次不合并。

## Considered Options

- 保留逐项清理命令，仅把 history 编排抽成共享模块：前端仍拥有批次停止与部分失败状态，视图消失时批次可能留下未关闭的记录。否决。
- 同时把扫描与测量合并成一个 Rust 命令：会把只读观察的停止、记录与完整性规则混进维护操作，扩大这次改动的边界。否决。
- 前端传入冻结的候选快照供 Rust 写 history：让 WebView 成为确认范围的权威，违背 ADR-0027。否决。
- history scope 无法冻结时直接失败：让历史写入失败改变清理结果，与 ADR-0027 冲突。否决。
- 单一批次命令 + 停止命令 + 进度通道 + 执行点写 history：采纳。

## Consequences

- 停止请求按当前活动批次匹配；当前目标完成后不再开始下一项，未开始的目标保留给后续批次。
- 批次开始时清空停止标志；上一批的停止请求不会影响下一批。
- 逐项目标结果在写入时进入维护历史；history 写入失败只作为最终回执的警告，不改变清理执行结果。
- 进度项区分真实的 `ProjectCleanupResult` 与 effect failure；最终回执只含摘要，UI 根据顺序和完成数标记未开始项。
- 旧的三条项目清理历史/单项命令及其回执类型移除；单项清理逻辑保留为 Rust 函数供批次调用。
- 批次入口接受注入的 runner 与 deleter，测试可在临时目录上覆盖成功、失败和停止。
- 扫描与测量仍是独立的观察流程，ADR-0003、ADR-0004、ADR-0016 继续有效；本次补上 ADR-0030 留下的项目清理迁移。
