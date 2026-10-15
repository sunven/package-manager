# Codex Hook 配置管理验证记录

日期：2026-10-15。需求：[PRD](PRD.md)（Q1–Q12 已确认）。设计决策：[ADR-0015](../../docs/adr/0015-codex-hook-definitions-use-user-source-files.md)。身份与状态实验：[RESEARCH](RESEARCH.md)。

## 交付

- Hooks 页面支持用户定义的新增、编辑与删除；插件定义保持只读，沿用既有查看与单项启停。表单覆盖 `command` 与 `mcp_tool`，含保存位置、事件、匹配条件、命令／MCP server/tool/input、高级选项（超时、状态提示、执行方式、上下文限制、Windows 命令）与只读原始定义。
- 后端把定义文件与启用、信任状态纳入同一操作计划：`prepare` 基于快照预览变更与受影响条目，`commit` 按可验证顺序执行——先禁用受影响身份并撤销旧信任，再写定义，最后恢复确认的启用选择；中途失败报告实际已保存的变更与恢复步骤，不显示为完整成功。
- 删除与拆组保护其他条目：删除前项后，原本禁用的后项保持禁用；身份变化的条目撤销旧信任，需在 Codex 重新审查，不自动迁移或授予信任。
- 已有定义在原文件原位维护，保留未知字段与 TOML 注释；新增沿用已有单一来源，首次默认 `hooks.json`，双来源并存时要求明确选择。外部修改通过快照与文件身份检测，旧提交被拒绝且不自动覆盖重试。
- 总开关关闭时仍可维护用户定义，明确标记未启用，保存不打开总开关。CLI 缺失、不兼容或原生读取失败时定义只读并说明原因。定义写入限定已验证的 `codex-cli 0.162.1`，其他版本只读。
- 保存结果与重读结果分别反馈；确认框恢复焦点，Escape 与取消均零写入。信任审查继续引导到 Codex CLI `/hooks` 或桌面 App，并在新会话中验证。

主要实现：[定义维护后端](../../src-tauri/src/codex_hook_definitions.rs)、[文档读写](../../src-tauri/src/codex_hook_documents.rs)、[页面](../../src/components/CodexHooksPage.tsx)、[表单](../../src/components/CodexHookEditor.tsx)、[状态与调用](../../src/hooks/useCodexHooks.ts)、[接线](../../src/App.tsx)。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过；包含 TypeScript 检查，保留既有 chunk 大小提示 |
| 前端完整测试 `npm test` | 29 个文件、205 项通过 |
| Hooks 定向测试（`CodexHooksPage` 13 项＋`CodexHookEditor` 8 项） | 通过 |
| Rust 完整测试 `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 173 项通过、0 失败、5 项默认忽略 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib real_cli_definition_crud_preserves_siblings_and_never_executes_hooks -- --ignored --nocapture` | 通过；隔离临时 home 中的定义 CRUD 生命周期 |
| `cargo build --manifest-path src-tauri/Cargo.toml` | 原生 debug 构建通过 |
| `git diff --check` | 通过 |

后端测试覆盖状态保护（删除前项后禁用后项保持禁用）、拆组、JSON 分阶段保存的部分失败、外部修改拒绝旧提交、未知字段与 TOML 注释保留、身份变化撤销信任，以及 CLI 版本门槛。前端测试覆盖表单校验（非法 JSON、SessionEnd×mcp_tool 组合禁用）、变更预览、受影响条目展示、部分保存反馈、快照过期后不能继续提交，以及取消与 Escape 零写入。

并行执行后端测试时，3 项既有 VS Code 存储测试因临时目录互相干扰偶发失败；串行执行全部通过。此为既有测试隔离问题，与本轮改动无关。

## 真实 CLI 验证

本机 `codex-cli 0.162.1`，全部写入位于测试创建的临时 home，未修改真实用户配置（`real_cli_definition_crud_preserves_siblings_and_never_executes_hooks`）。

- 新增与删除定义后，总开关保持关闭；其他条目未被误启用。
- 删除前项后，同组原本禁用的后项保持禁用，且身份变化后需重新审查。
- 管理过程没有启动 thread／turn 或执行 Hook。

该版本是已验证版本，不是最低支持版本；定义读写、身份映射与状态维护能力未在其他 CLI 版本上验证，产品按此设只读门槛。

## 界面验证

使用生产构建预览和显式注入的合成 IPC fixture（[browser-review.html](browser-review.html)，页面固定标注「合成数据验证 · 不连接本机 Codex」），由 `agent-browser` 检查。

- 截图：[浅色清单 1180](../../.impeccable/review/codex-hook-configuration/light-1180.png)、[新建表单](../../.impeccable/review/codex-hook-configuration/create-light-1180.png)、[保存确认](../../.impeccable/review/codex-hook-configuration/create-confirm-1180.png)、[删除确认](../../.impeccable/review/codex-hook-configuration/delete-confirm-1180.png)、[深色 MCP 编辑 960](../../.impeccable/review/codex-hook-configuration/mcp-dark-960.png)、[部分保存失败 960](../../.impeccable/review/codex-hook-configuration/partial-dark-960.png)、[窄窗口 390](../../.impeccable/review/codex-hook-configuration/create-narrow-390.png)。
- 交互核对：确认前零提交（`commitsBeforeConfirm: 0`）；预览明确列出受影响条目及「保持禁用，需重新审查」；Escape 关闭删除确认零写入；部分保存路径报告部分结果而非成功；保存失败后重新核对时表单显示最新启用选择；单侧变更预览使用完整宽度。
- 自动无障碍检查：[浅色](../../.impeccable/review/codex-hook-configuration/a11y-light.json)、[深色](../../.impeccable/review/codex-hook-configuration/a11y-dark.json) 均为 0 violations（axe 4.12.1）；无法自动判定的对比度项涉及既有渐变外壳，不代表已完成全部人工无障碍验证。
- [界面终审](../../.impeccable/review/codex-hook-configuration/finish-review.md)：`ship`，所查范围没有必须修改项。独立终审代理连续三次因 API 400 错误失败，改按技能降级流程在主线程审查，此结果不属于独立终审。
- [文档复核](../../.impeccable/review/codex-hook-configuration/documentation-review.md)：普通扩展沿用既有主题、组件和布局约定，未更改全局 token，未创建 `DESIGN.md` 或设计 sidecar（与上一轮 `codex-hooks` 的决定一致）。

浏览器验证覆盖合成数据下的界面与状态处理，真实 CLI 测试覆盖本机版本的隔离定义生命周期。未对 Tauri 原生窗口做端到端操作验证，未验证已有 CLI／桌面 App 会话的即时重载，也未验证其他 CLI 版本下的定义读写。
