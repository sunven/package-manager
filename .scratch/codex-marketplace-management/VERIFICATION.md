# Codex 市场源管理验证记录

日期：2026-10-14。需求：[PRD](PRD.md)。接入调查：[CLI-INVESTIGATION.md](CLI-INVESTIGATION.md)。接入决策：[ADR-0012](../../docs/adr/0012-marketplace-refresh-follows-codex-sync-semantics.md)。

## 交付

- 「Codex 插件」入口内分为「已安装／市场源」两个页签，共用当前 Codex home 范围说明；既有插件启停能力保留。
- 市场源列表展示名称、来源类型、来源地址或路径、可执行操作与只读原因；展开显示市场本地副本或实际本地目录，以及用户配置路径。
- 添加入口支持 Git 仓库简写或 URL、本地市场根目录（目录选择器），在原页表单内核对后提交；已有来源提示已存在，同名异源拒绝替换，不自动串联移除。
- 仅 Git 市场提供「刷新市场」，执行前确认名称、来源、Codex 目录及「可能同步已禁用插件内容」的影响；本地来源只通过重新读取反映变化。
- 移除确认后只调用官方 `marketplace remove`；Git 市场本地副本由官方命令移除，不追加插件卸载、插件启用设置清理或原始来源删除。
- 可维护资格要求官方来源、用户配置与 `app-server` 只读 `config/read` 归属三者一致；默认、受管理、归属不明或配置读取失败时市场只读并显示原因。
- 执行前复核快照、home、来源与资格，外部变化或复核期间配置变化时中止旧操作并要求重新确认。命令结果与随后清单读取结果分别报告；读取失败保留上次结果并标记过期、暂时禁止操作。市场操作可能改变插件内容时使「已安装」页失效并在再次显示时重读。
- CLI 缺失、版本不兼容、清单读取失败与空清单分别表达，不伪装为空清单，也不影响既有能力的独立判断。

主要实现：[Rust 接入](../../src-tauri/src/codex_marketplaces.rs)、[CLI 调用封装](../../src-tauri/src/codex_cli.rs)、[页面](../../src/components/CodexMarketplacesPage.tsx)、[状态与调用](../../src/hooks/useCodexMarketplaces.ts)、[页签接线](../../src/App.tsx)。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过；保留既有 chunk 大小提示 |
| `npx tsc --noEmit` | 通过 |
| 前端完整测试 `npm test` | 26 个文件、169 项通过 |
| Rust 完整测试 `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 153 项通过、0 失败、2 项默认忽略 |
| 真实 CLI 生命周期测试 `cargo test --manifest-path src-tauri/Cargo.toml real_cli_marketplace_lifecycle_in_temporary_home --lib -- --ignored` | 通过；隔离临时 home 与临时来源 |
| `git diff --check` | 通过 |

后端测试覆盖：可见空市场不从已安装插件推导；官方来源与用户配置必须一致才可写；无 `marketplaceSource`、名称与配置键不一致、地址变化均只读；配置读取失败保留可见市场但不授予写权限；失效快照、home 变化、来源变化以及复核期间配置变化都不执行；刷新与移除只使用已确认目标并消耗批准；读取失败作废旧批准而非伪造空成功；输入校验拒绝 flag、凭据与任意文件；幂等（`alreadyAdded`）、部分失败与未确认结果分别处理；非法清单不当作空成功。前端测试覆盖只读与可写边界、本地来源无 Git 刷新、逐个确认、重复来源、目录选择、移除不设插件数量门槛、成功与重读失败分离、空清单与配置失败、IPC 读取失败保留上次结果，以及市场变更后「已安装」页失效重读。

所有写入测试均使用隔离临时 home 与临时来源；未对用户实际 Codex 配置执行添加、刷新或移除。原生桌面窗口未进行端到端操作验证。

真实 CLI 只读核对（本机 `codex-cli 0.162.1`，与 PRD 相同的单版本事实边界）：

- `codex plugin marketplace list --json` 返回 4 个市场：`pm-skills`、`ponytail` 带 Git `marketplaceSource`；`tengits-plugin-marketplace` 无来源字段；`openai-api-curated` 为默认来源。
- `app-server` 只读 `config/read`（`includeLayers`）显示 `marketplaces.pm-skills.*` 与 `marketplaces.ponytail.*` 归属用户 `config.toml`，而 `tengits-plugin-marketplace` 只有 `last_updated`/`last_revision` 没有来源字段。与预期一致：仅前两者具备可维护资格，后两者只读。
- 该版本是已验证版本，不是已证实的最低支持版本。

## 界面验证

使用生产构建预览（`vite preview`，http://localhost:14212/ ）和显式注入的模拟 IPC 数据，检查 1180×760、960 和 390 宽度、浅深主题、添加入口、刷新与移除确认、成功但重读失败、空清单与 CLI 缺失。

- 确认框取消与 Escape 关闭都不写入并恢复焦点到触发的「刷新市场」按钮；取消添加恢复焦点到「添加市场源」；添加提交发送 `{operation: Add, snapshotId, source, sourceKind: git}`；本地来源输入在目录选择前只读；受管理来源只显示只读原因；本地来源不渲染 Git 刷新动作。记录见 [interaction-checks.json](../../.impeccable/review/codex-marketplaces/interaction-checks.json)。
- 独立界面终审：[pass，无必须修改项](../../.impeccable/review/codex-marketplaces/finish-review.md)；结论限于上述模拟浏览器场景。非阻断观察（扫描期间页签禁用范围偏严、重复来源文案同义、能力失败走只读通道、原生单选焦点样式、展开行无截图证据）保留为后续候选，不在本次改动。
- 独立文档复核：[pass，沿用既有设计系统](../../.impeccable/review/codex-marketplaces/documentation-review.md)；未创建 `DESIGN.md` 或设计 sidecar。
- 自动无障碍检查：[浅色 0 violations](../../.impeccable/review/codex-marketplaces/a11y-light.json)、[深色 0 violations](../../.impeccable/review/codex-marketplaces/a11y-dark.json)。两者的 `incomplete` 项均为应用既有渐变外壳，不属于本页。
- 截图：[浅色列表 1180](../../.impeccable/review/codex-marketplaces/light-1180.png)、[深色列表 960](../../.impeccable/review/codex-marketplaces/dark-960.png)、[窄窗口 390](../../.impeccable/review/codex-marketplaces/narrow-390.png)、[添加表单](../../.impeccable/review/codex-marketplaces/add-1180.png)、[本地来源已选目录](../../.impeccable/review/codex-marketplaces/local-picker-1180.png)、[展开来源详情](../../.impeccable/review/codex-marketplaces/details-1180.png)、[刷新确认](../../.impeccable/review/codex-marketplaces/confirm-refresh-1180.png)、[深色刷新确认 960](../../.impeccable/review/codex-marketplaces/confirm-refresh-dark-960.png)、[移除确认](../../.impeccable/review/codex-marketplaces/confirm-remove-1180.png)、[成功但重读失败](../../.impeccable/review/codex-marketplaces/success-read-failed-1180.png)、[空清单](../../.impeccable/review/codex-marketplaces/empty-1180.png)、[CLI 缺失](../../.impeccable/review/codex-marketplaces/missing-cli-1180.png)、[已安装页签](../../.impeccable/review/codex-marketplaces/installed-1180.png)。
- 终审指出的证据缺口（展开详情、本地来源选择目录、深色确认框、`<main>`→`<section>` 后的「已安装」页签）已按上述截图补齐；`detector.json` 未补，本表面的机器检查记录在 [`.impeccable/hook.cache.json`](../../.impeccable/hook.cache.json)。

浏览器模拟验证界面与状态处理；Rust 测试验证 CLI 接入、归属核实与命令委托；隔离临时 home 的真实 CLI 测试验证实际命令生命周期。刷新成功表示官方命令已执行，不表示已安装插件已在现有会话中生效。
