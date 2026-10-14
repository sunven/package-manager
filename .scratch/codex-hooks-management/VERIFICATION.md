# Codex Hooks 管理验证记录

日期：2026-10-14。需求：[PRD](PRD.md)。接入决策：[ADR-0013](../../docs/adr/0013-codex-hooks-use-native-inventory-and-user-state.md)。

## 交付

- 侧栏统一为「Codex」，包含「已安装插件／市场源／Hooks」三个页签，保留已有插件和市场源管理能力。
- Hooks 使用当前 `CODEX_HOME`（默认 `~/.codex`）及项目外上下文的原生清单，保留每条定义的原生身份，不按事件或命令合并。展示事件、操作摘要、来源、启用与信任状态、只读原因；展开完整命令或 MCP 工具、匹配条件、超时与路径。
- 总开关关闭时明确说明无法枚举；项目配置和已禁用插件不展开，提供已安装插件入口。CLI 缺失、不兼容、读取错误与空清单分别表达。
- 单项确认后只启停已信任、非托管且可核实的 Hook。后端保管并消耗清单快照，复核 home、用户配置目标和版本、原生身份、定义 hash、信任与启用状态；外部变化中止旧操作，不自动覆盖重试。
- 经 `config/value/write` 仅写完整原生 key 对应的用户级 `enabled`，保留 `trusted_hash`、定义、总开关与插件设置。信任仍由 Codex 原生界面审查。
- 首次进入、手动刷新及操作后读取；插件启停和市场维护使 Hooks 清单失效。保存结果与随后读取结果分别反馈，过期数据暂时不能修改。保存不代表运行中会话立即生效。

主要实现：[Rust Hooks 接入](../../src-tauri/src/codex_hooks.rs)、[CLI 连接](../../src-tauri/src/codex_cli.rs)、[页面](../../src/components/CodexHooksPage.tsx)、[状态与调用](../../src/hooks/useCodexHooks.ts)、[页签接线](../../src/App.tsx)。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过；包含 TypeScript 检查，保留既有 chunk 大小提示 |
| 前端完整测试 `npm test` | 27 个文件、182 项通过 |
| 表格宽度调整后的 Hooks 定向测试 | 13 项通过，生产构建再次通过 |
| Rust 完整测试 `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 159 项通过、0 失败、3 项默认忽略 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib real_cli_hooks_user_and_plugin_lifecycle -- --ignored --nocapture` | 通过；隔离临时 home 与用户／插件定义 |
| `cargo build --manifest-path src-tauri/Cargo.toml` | 原生 debug 构建通过 |
| `git diff --check` | 通过 |

后端单元测试覆盖原生清单身份保留、项目来源过滤、非法清单拒绝、待信任／已修改／托管／未知来源或类型只读、配置归属无法核实时只读、全局关闭或读取不完整时不授予写权限，以及定义、信任、启用状态、home、配置目标、版本和快照变化后的拒绝。批准只能使用一次，失败扫描使旧批准失效，原生版本冲突独立报告。

前端测试覆盖摘要与详情、MCP 工具、限制说明、取消无写入、确认提交快照与原生 key、读取及保存状态、CLI 缺失与空清单、保存成功但刷新失败、IPC 失败保留旧数据和作废旧快照，以及相关维护后再次进入时重读。

## 真实 CLI 验证

本机 `codex-cli 0.162.1`，全部写入位于测试创建的临时 home，未修改真实用户配置。

- 临时用户 JSON Hook 与临时插件 Hook 均被原生清单返回。测试只为这两个 fixture 写入初始信任记录，产品实现不提供授予信任能力。
- 对两种来源分别禁用、启用，并通过新的 app-server 连接读取持久结果；每次保存后的信任状态和 `trusted_hash` 保持不变。
- 其他 Hook 的状态、插件启用设置、无关字段、配置注释以及两份定义文件均保留。
- 外部修改用户配置后，旧 `expectedVersion` 被原生 `configVersionConflict` 拒绝，外部变更保留。
- 禁用插件后，其 Hook 不出现在清单中；关闭总开关后原生返回空清单，功能状态为关闭。
- fixture 的 `SessionStart` 命令原本会创建 sentinel 文件，整个测试结束后该文件不存在。管理操作没有启动 thread／turn 或执行 Hook。

该版本是已验证版本，不是最低支持版本。配置版本只保护用户配置文件，定义与插件内容在保存前另外复核，不构成跨文件事务或所有来源层组合的保证。

## 界面验证

使用生产构建预览和显式注入的合成 IPC fixture，由 `agent-browser` 检查 1180、960 和 390 宽度、浅深主题、详情、确认、失败和空状态。浏览器中的写操作仅修改模拟数据。

- 1180px 与 960px 窗口下表格完整显示；390px 窗口没有整页横向溢出，表格局部滚动。详情使用 1180×1000 截图展示完整内容。取消与 Escape 均为零次写入，焦点恢复原按钮；保存成功但重读失败仅提交一次，旧清单操作全部禁用。见 [interaction-checks.json](../../.impeccable/review/codex-hooks/interaction-checks.json)。
- 自动无障碍检查：[浅色](../../.impeccable/review/codex-hooks/a11y-light.json)、[深色](../../.impeccable/review/codex-hooks/a11y-dark.json) 均为 0 violations；无法自动判定的对比度项涉及既有渐变外壳，不代表已完成全部人工无障碍验证。
- [界面终审](../../.impeccable/review/codex-hooks/finish-review.md)：`ship`，所查范围没有必须修改项。独立代理连续两次因平台 resource 错误启动失败，改按技能降级流程在主线程审查，此结果不属于独立终审。
- [文档复核](../../.impeccable/review/codex-hooks/documentation-review.md)：沿用既有主题、组件和布局约定；本次普通扩展未更改全局 token，也未创建 `DESIGN.md` 或设计 sidecar。
- 截图：[浅色列表](../../.impeccable/review/codex-hooks/light-1180.png)、[深色列表 960](../../.impeccable/review/codex-hooks/dark-960.png)、[窄窗口 390](../../.impeccable/review/codex-hooks/narrow-390.png)、[完整详情](../../.impeccable/review/codex-hooks/details-1180.png)、[确认](../../.impeccable/review/codex-hooks/confirm-1180.png)、[深色确认](../../.impeccable/review/codex-hooks/confirm-dark-960.png)、[保存后读取失败](../../.impeccable/review/codex-hooks/saved-read-failed-1180.png)、[总开关关闭](../../.impeccable/review/codex-hooks/global-off-1180.png)、[空清单](../../.impeccable/review/codex-hooks/empty-1180.png)、[CLI 缺失](../../.impeccable/review/codex-hooks/missing-cli-1180.png)、[已安装插件](../../.impeccable/review/codex-hooks/installed-1180.png)、[市场源](../../.impeccable/review/codex-hooks/marketplaces-1180.png)。

浏览器验证覆盖合成数据下的界面与状态处理，真实 CLI 测试覆盖本机版本的隔离配置生命周期。未对 Tauri 原生窗口做端到端操作验证，也未验证已有 CLI／桌面 App 会话的即时重载。
