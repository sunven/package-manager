# Grok Build 会话记录验证

日期：2026-10-27。实现范围以 [PRD.md](PRD.md) 与 [ADR-0030](../../docs/adr/0030-grok-session-removal-preserves-local-recovery-boundary.md) 为准。

## 自动化

- `cargo test --manifest-path src-tauri/Cargo.toml --quiet`：355 项通过，10 项忽略，无失败。Grok 模块包含 15 项测试，另有维护历史回归测试。见 [后端日志](backend-test.txt)。
- `pnpm run build`：TypeScript 与 Vite 生产构建通过。Vite 仍提示主 bundle 超过 500 kB，本次未调整打包策略。
- `pnpm exec vitest run --maxWorkers=2`：60 个文件、448 项测试中，445 项通过，3 项既有界面测试触发 5 秒超时，没有断言失败。随后对两个相关文件用 `--maxWorkers=1 --testTimeout=30000` 复跑，17 项全部通过，包含这 3 项；未改动测试或全局超时设置。见 [全量日志](frontend-test.txt) 与 [复跑日志](frontend-recheck.txt)。
- 新后端模块通过 `rustfmt --check --edition 2021 src-tauri/src/grok_sessions.rs`；既有 Rust 文件仅格式化本次改动范围，保留无关格式。

## 行为覆盖

- [后端测试](../../src-tauri/src/grok_sessions.rs)：跨项目摘要读取、整目录大小、缺失字段降级、身份不一致诊断、严格年龄边界、执行前时间重读、明确选择的独立资格、链接与路径穿越拒绝。
- 运行中与未知状态阻止移除；批次中启动后停止剩余项并保留已成功项；文件被打开时保留对应记录；单条废纸篓失败后继续其他记录。
- 独立关联记录不级联，目录外索引不进入移除目标；关系元数据只输出关联标识，不输出提示正文。
- 指定 UUID、原工作目录和同一 `GROK_HOME` 的启动命令；路径引号处理；恢复日志缺失和标识不明确时拒绝继续。测试不启动真实会话。
- macOS 系统探测测试实际执行只读 `ps`／`lsof`：大于管道容量的输出可正常排空；临时文件打开／关闭可被识别；路径别名映射与超时处理已覆盖。
- [前端交互测试](../../src/components/GrokSessionRecords.test.tsx)：来源运行限制与逐条使用中分别显示、继续会话、确认与取消、搜索后按年龄仍覆盖整个来源、冻结来源与年龄门槛、保留未执行选择、测量不完整和继续资格降级。
- [维护历史回归](../../src-tauri/src/maintenance_history.rs)：未执行项正确计数、确认范围持久化、后续读取失败不覆盖移除结果、旧历史结构仍可读取。观察覆盖度目录更新为 26 项。

## 界面证据

上一轮使用 agent-browser 检查真实页面组件及 Hook，Tauri IPC 使用 [preview.tsx](preview.tsx) 中明确标识的合成数据；没有连接真实 Grok 会话执行移除。

- [桌面](../../.impeccable/review/grok-build/desktop.png)
- [窄窗口](../../.impeccable/review/grok-build/compact.png)
- [搜索后的整个来源年龄确认](../../.impeccable/review/grok-build/age-confirmation.png)
- [Grok 运行时的来源限制](../../.impeccable/review/grok-build/running.png)

浏览器检查确认桌面和窄窗口无横向溢出；搜索不缩小按年龄移除范围，取消不调用移除；运行限制没有把每条记录误标为使用中。截图保留合成数据标识。

独立界面审查 disposition 为 `ship`，无待修正项，覆盖上述四张截图与相关页面源码，未独立实测原生后端。详见 [REVIEW.md](../../.impeccable/review/grok-build/REVIEW.md)。当前环境未提供专用 Impeccable 审查角色，由不继承开发上下文的新代理按同一角色定义完成审查。

独立文档核对已完成，证据附于 [页面简报](../../.impeccable/surfaces/src-components-sessionrecordspage-tsx.md)。源码、共享样式、四张 Grok 截图及既有会话页截图均已对照，确认沿用现有字体、主题、控件和响应式列表。未新增全局视觉系统文件或修复无关文档漂移。

## 验证边界

- 支持格式依据本机 Grok Build 1.0.70 随附文档与匿名化结构夹具，不承诺所有版本兼容；自定义非 UUID 标识禁用继续。
- 文件移除测试使用临时 home 与注入的废纸篓替身，没有对真实用户会话或系统废纸篓进行删除实验。没有实际通过 Terminal 继续真实会话，也没有验收打包后的原生窗口。
- 系统探测及模拟状态测试覆盖识别、未知状态和批次停止；没有逐一启动真实交互、headless、agent 与 Grove 宿主进行端到端删除实验。检查与 Grok 启动之间不具备原子互斥。
- 移除保留目录外搜索索引、远端副本及未选中的独立关联记录；不保证搜索结果彻底消失、物理空间立即释放或所有关联记录原生恢复能力不受影响。

## 用户反馈修正：结果路径可读性

- 用户截图显示逐条结果直接展示 `%2FUsers%2F.../UUID`。已在合成结果中复现，页面 DOM 可读路径断言在修正前失败、修正后通过。
- 当前结果与维护历史共用 Grok 记录 ID 的显示格式：仅解码工作目录部分一次，保留会话标识；中文、空格、百分号可读。非法编码回退原文，其他来源不套用 Grok 的编码规则。操作参数、原始结果、历史持久化 ID 与 React key 保持原值。
- 浏览器验证包含五种边界输入：字面百分号不重复解码、非法编码不抛错、会话标识不被解码、其他来源及普通未编码分组保持原样。窄窗口无横向溢出，预览没有调用任何移除命令。
- `pnpm exec vitest run src/components/GrokSessionRecords.test.tsx src/components/HistoryPage.test.tsx src/sessionRecords.test.ts --maxWorkers=1 --testTimeout=30000`：20 项通过；`pnpm exec tsc --noEmit` 通过。
- 修正效果：[桌面结果](../../.impeccable/review/grok-build/readable-path-desktop.png)、[窄窗口结果](../../.impeccable/review/grok-build/readable-path-compact.png)，均为合成数据。
- 已将用户截图和修正截图交给新的独立代理按同一 Impeccable 审查定义复核（专用角色不可用），disposition 为 `ship`，无待修正项；维护历史显示在源码层核对。见 [复核报告](../../.impeccable/review/grok-build/READABLE-PATH-REVIEW.md)。独立文档核对已将本次显示修正补入页面简报，视觉系统未改变。
