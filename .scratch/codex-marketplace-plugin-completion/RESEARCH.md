# Codex 市场与插件补全：事实核查

日期：2026-10-15。用于设计访谈，不代表功能已实现。

## 官方资料与实现差距

| 能力 | 官方依据与当前事实 | 本应用现状 |
| --- | --- | --- |
| 市场源 | CLI 支持 GitHub shorthand、Git URL、SSH、本地根目录，以及 ref 和多个 sparse 路径 | 常见来源已支持；`owner/repo@ref`、显式 ref/sparse 和旧版市场布局待补 |
| 市场目录 | `plugin list --available --json` 可纳入未安装项，返回身份、状态、来源、安装及认证策略 | 目前只消费 `installed` |
| 安装／卸载 | 本机 0.162.1 提供 `plugin add/remove --json` | 目前没有对应入口 |
| 更新 | 本机没有独立 `plugin update/upgrade` 子命令；现有市场刷新有连带同步语义 | 不能仅因重复 add 刷新文件，就称其为保留启停状态的更新 |
| 插件详情 | 稳定 CLI 的清单契约未包含简介、作者或完整组件；本机 app-server schema 有更丰富详情 | 目前未展示描述、作者、技能／MCP／Hooks 组成 |
| manifest | 官方支持根 `plugin.json`、`extensions.com.openai` 与兼容 overlay；inline OpenAI 对象存在时完整替代 overlay，不能合并 | 当前不自行解析 manifest；安装与识别由 CLI 承担，不能据此判定不支持 portable 格式 |
| Hooks | 原生清单与用户默认启用维护已独立实现 | 沿用已有信任、来源与枚举边界 |

本机 CLI 帮助确认 `add/remove` 支持 `PLUGIN@MARKETPLACE` 或 `PLUGIN --marketplace NAME`，以及 `--json`。`add` 未提供 `--force`、`--upgrade` 或版本选择参数。这是 0.162.1 的观察，不能据此承诺其他版本。

## 详情接口边界

[官方 app-server 文档](https://developers.openai.com/codex/app-server) 对 `plugin/list`、`plugin/read`、`plugin/install`、`plugin/uninstall` 标明仍在开发中，并要求：

> Don't call this method from production clients yet.

本机临时生成的 schema 中，`plugin/read` 有描述、技能摘要、MCP 名称和 Hooks 事件／key，但这不构成稳定生产接口承诺，也不能证明远程源码未下载时详情完整或读取无副作用。本次没有调用这些插件接口。

Git 源中的 URL、子路径、ref、SHA，以及 npm 源中的包名、版本选择器、registry，并不等于完整插件详情。npm 版本范围不能显示为实际安装版本。后续应分别处理已安装副本、本地可读目录与尚未下载的远程来源。

## 代码依据

- `src-tauri/src/codex_plugins.rs`：官方 CLI 已安装清单、用户默认启停与现有精简 DTO。
- `src-tauri/src/codex_marketplaces.rs`：市场源校验、归属判断、添加／刷新／移除。
- `src/components/CodexMarketplacesPage.tsx`、`src/components/CodexPluginList.tsx`：市场分组与已安装插件列表。
- `docs/adr/0011-codex-plugins-use-cli-inventory-and-user-config.md`：安装事实与用户设置分别读取。
- `docs/adr/0012-marketplace-refresh-follows-codex-sync-semantics.md`：Git 市场刷新可能同步已禁用插件，保留用户禁用设置。
- `docs/adr/0013-codex-hooks-use-native-inventory-and-user-state.md`：Hooks 清单与信任边界。

## 0.162.1 隔离生命周期实验

实验使用纯 skill、本地市场 fixture。正式安装／卸载实验仅为子进程设置临时 `CODEX_HOME` 和 cwd，没有设置 HOME；macOS sandbox 禁止网络和临时目录外写入，并拒绝读取真实 `.codex`／`.agents`。没有修改真实用户配置、市场或插件。

| 场景 | 结果 |
| --- | --- |
| 首次安装 | 创建安装副本，并保存 `enabled=true` |
| 源文件改变、版本号相同，再次 add | 已安装文件被刷新，版本及路径保持相同 |
| 版本从 1.0.0 升至 1.1.0，再次 add | 安装新版本，该插件只剩新版本缓存目录 |
| 已禁用插件再次 add | 刷新文件，同时把 `enabled=false` 改回 `true` |
| 对本地市场执行 upgrade | 失败，提示不是已配置的 Git 市场 |
| 安装策略为 NOT_AVAILABLE | 清单中可见；安装被 CLI 拒绝，配置与缓存不变 |
| 卸载 | 移除目标插件配置表及插件缓存目录，原始插件源码、无关配置和注释保留 |
| 对已移除对象再次卸载 | 仍成功并返回相同身份 JSON，不能从 exit 0 判断本次是否实际移除了文件 |

成功安装 JSON 包含 `pluginId`、`name`、`marketplaceName`、`version`、`installedPath`、`authPolicy`。成功卸载 JSON 只返回三个身份字段，不包含删除路径、字节数或原先已不存在标记。

该 fixture 的兼容 manifest 指定了版本，安装路径使用该版本号。不能根据文档对本地缓存路径的概括硬编码 `local`，应使用官方实际返回的安装位置。

实验边界：没有验证 Git/npm 重装是否取得上游最新版本，没有认证或运行 MCP／Hooks，没有验证插件数据目录、凭据、Hooks 信任记录的卸载行为。卸载目标配置表只有 `enabled`，不能将观察扩大为已验证所有嵌套设置。上述结果不构成跨 CLI 版本保证。

原始临时记录：`/private/tmp/pm-plugin-cli-fixture-zbdjiuje/experiment.jsonl` 和同目录 `context.json`。本节保留了不依赖临时文件长期存在的实验结论。

## 官方来源

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [CLI reference](https://developers.openai.com/codex/cli/reference#codex-plugin)
- [App-server](https://developers.openai.com/codex/app-server)

资料仅用于核实契约与能力。项目中旧 PRD 的非目标描述旧迭代范围，本轮新增范围以新 PRD 的用户确认记录为准。
