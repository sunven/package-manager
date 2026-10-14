# Codex 插件管理验证记录

日期：2026-10-14。需求：[PRD](PRD.md)。接入决策：[ADR-0011](../../docs/adr/0011-codex-plugins-use-cli-inventory-and-user-config.md)。

## 交付

- 侧栏「Codex 插件」进入独立页面，首次读取、手动刷新、操作后重读。
- 展示安装清单、版本、所属市场、来源位置和用户默认启用设置；不同市场的同名插件分别管理。
- 单个确认启停，仅更新当前 Codex home 用户配置的目标 `enabled`。保留其他配置、注释和文件权限；使用临时文件原子替换，并保留已有配置符号链接。
- 保存前复核清单身份、配置目标和原启用值；检测到外部修改时中止旧操作。配置异常和未知来源禁止修改，未显式设置允许确认后指定。
- CLI 缺失、不兼容、读取失败、空清单分别表达；配置保存结果与后续刷新结果分别报告。

主要实现：[Rust 接入](../../src-tauri/src/codex_plugins.rs)、[页面](../../src/components/CodexPluginsPage.tsx)、[状态与调用](../../src/hooks/useCodexPlugins.ts)。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `pnpm build` | 通过；保留既有 Vite chunk 大小提示 |
| 前端完整测试 | 25 个文件、155 项通过 |
| 最终页面修改后的定向测试 `pnpm exec vitest run src/components/CodexPluginsPage.test.tsx` | 10 项通过 |
| Rust 完整测试，`cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` | 142 项通过、1 项默认忽略 |
| 最终后端修改后的定向测试 `cargo test --manifest-path src-tauri/Cargo.toml codex_plugins --lib` | 13 项通过、1 项默认忽略 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo build --manifest-path src-tauri/Cargo.toml` | 通过 |
| 真实 CLI 只读 smoke：`cargo test --manifest-path src-tauri/Cargo.toml reads_real_codex_inventory_without_changing_user_config --lib -- --ignored` | 通过；CLI 0.162.1，用户 `config.toml` 前后字节一致 |

后端测试覆盖同名插件、CLI 有效值与用户默认值分离、无显式设置、无关外部修改保留、目标冲突、清单身份变化、配置损坏、符号链接与权限保留、持久化前冲突及失效快照。前端测试覆盖首次读取、确认与取消、未知设置、只读状态，以及保存和刷新失败的独立反馈。

所有写入测试均使用临时配置，未对用户实际插件执行启停。原生桌面窗口未进行端到端操作验证。

既有检查限制：严格 Clippy 检查被 `command.rs`、`managers/docker.rs`、`project_cleanup.rs`、`session_records.rs` 和 `lib.rs` 中的既有警告阻断，新增插件模块没有该次报告的警告。完整 Rust 并行测试曾因既有会话记录测试的临时符号链接名称碰撞失败；改为串行后全部通过，未修改无关代码。

## 界面验证

使用隔离浏览器会话和显式模拟的 IPC 数据，检查 1180×760 和 960×720 窗口、浅深主题、来源详情、确认框、长路径、空状态、CLI 缺失及保存后刷新失败。键盘 Escape 取消不写入并恢复焦点；保存后刷新失败时旧列表不可操作；长内容没有页面横向溢出。

- 独立界面评审：**ship**，无必须修改项，结论限于上述模拟浏览器场景。
- 独立文档复核：[pass，沿用既有设计系统](../../.impeccable/review/codex-plugins/documentation-review.md)。
- 当前深色页面自动无障碍检查：[0 violations，22 passes](../../.impeccable/review/codex-plugins/a11y-dark.json)。同目录的 `a11y.json` 是修复状态文字对比度前的历史记录。
- 截图：[浅色列表](../../.impeccable/review/codex-plugins/light-1180.png)、[深色列表](../../.impeccable/review/codex-plugins/dark-960.png)、[确认框](../../.impeccable/review/codex-plugins/confirm-light-1180.png)、[长来源详情](../../.impeccable/review/codex-plugins/details-dark-960.png)、[保存后刷新失败](../../.impeccable/review/codex-plugins/saved-refresh-failed-1180.png)、[CLI 缺失](../../.impeccable/review/codex-plugins/missing-cli-1180.png)、[空清单](../../.impeccable/review/codex-plugins/empty-1180.png)。

浏览器模拟验证界面与状态处理；真实 CLI 只读测试验证本机清单接入；临时目录下的 Rust 测试验证配置写入行为。保存成功表示配置已持久化，不表示现有 Codex 会话已加载插件。
