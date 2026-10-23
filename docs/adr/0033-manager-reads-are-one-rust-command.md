# 管理器一次读取在 Rust 完成并陈述问题

管理器读取此前由 `scan_manager`、逐路径 `measure_path_size`、可选的 Homebrew/pip 补充和 `save_manager_snapshot` 串成多次 IPC；前端自己维护读取/补充阶段，并用 `scanProblems` 从状态和失败重新拼错误文案。决定由一个 `scan_manager` 命令完成清单扫描、全部路径测量和 Homebrew/pip 补充，通过进度通道报告阶段；Rust 把补充合并进完整快照，并返回 `problems`、诊断和总耗时。历史归档与观察台账仍由前端调用。

## Considered Options

- 保留逐路径/逐补充命令，只把最终状态合并：前端仍拥有阶段、路径计数和问题文案，重复推导不会消失。否决。
- 连历史归档也并入扫描命令：会把一次只读观察变成读加历史写入；`SnapshotDraft` 的完整性与观察元数据仍在前端，边界反而更碎。留作独立改动。否决。
- Rust 只返回原始补充预览，前端继续合并：pip 的可更新信号规则仍跨两个执行点。否决。
- 测量与补充并行执行：进度阶段会交错，并行遍历磁盘也可能互相拖慢；先用顺序实现。否决。
- 一次读取命令 + 进度通道 + Rust 合并与问题陈述：采纳。

## Consequences

- `ManagerScanSnapshot` 增加 `problems`；前端删除 `scanProblems`，只渲染 Rust 陈述的文案。`Ready/Partial/Missing/Failed` 仍描述清单读取，路径测量与补充失败进入 `problems`。
- 进度事件为 `reading`、`measuring { completed, total }`、`hydratingHomebrew`、`hydratingPip`；前端据此更新阶段与「正在统计/加载」提示。
- `measure_path_size`、`hydrate_homebrew_cleanup`、`hydrate_pip_outdated` 三条命令移除；补充重试改为整次 `readFull(manager)`。
- pip 的 `Outdated` 信号与 `outdatedStatus/count/message` 合并移入 Rust；Homebrew 直接替换 cleanup 预览。
- `scan_duration_ms` 覆盖整个读取；诊断在补充完成后收集。
- 历史归档、观察台账和 manager 内部 `scan_*_with_runner*` wrapper 本次保持不动；wrapper 与统一测试 seam 留作后续机械重构。
