# 终审：Codex 市场源管理

日期：2026-10-14。审阅对象：`.scratch/codex-marketplace-management/PRD.md`、[ADR-0012](../../../docs/adr/0012-marketplace-refresh-follows-codex-sync-semantics.md)、方向契约 `.impeccable/surfaces/src-components-codexmarketplacespage-tsx.md`、基线对照 `.impeccable/review/codex-plugins/{light-1180,dark-960}.png`。

VERDICT: pass

审阅方式：逐文件阅读实现（前端 3 个新/改文件、App 接线、Rust 3 个文件与既有 codex_plugins 的复用点），逐张检视 9 张截图（含与基线对照裁切比较按钮与表格节奏），核对 `interaction-checks.json`、两份 a11y 报告、VERIFICATION.md 的声明，并单独重跑了新组件测试文件（14 项通过）作为抽样复核。未修改仓库中除本报告外的任何文件。

## 1. 需要修复的问题（按严重度排序）

**没有发现问题通过审查。** 逐条尝试的攻击面与结论如下，供反证：

- **越权写入**：写入路径要求「前端 `disabled` 门 + Rust 复核」双保险。前端 `disabled` 需要 `status === "Ready"`、`snapshotId` 非空、无 `error`/`configError`（`src/components/CodexMarketplacesPage.tsx:46-47`）；Rust 侧 `change_with` 一次性消费快照、比对 id 与当前 home、重新执行 `list` 并逐字段比对来源与资格、比对配置视图（`src-tauri/src/codex_marketplaces.rs:360-385`、`407-420`），任一处不符即 `Conflict` 且 `executed: false`。
- **归属判定被绕过**：`read_only` 要求 CLI 清单来源、用户配置键、`config/read` 的 `origins` 三者一致且全部字段归属用户文件，`ref`/`sparse_paths` 也参与比对（`src-tauri/src/codex_marketplaces.rs:124-204`）。名称与配置键不一致、无 `marketplaceSource`、地址被改都会落到只读，方向是安全侧。
- **应用自行动手**：`codex_marketplaces.rs` 只调用官方 `add`/`upgrade`/`remove`，自身不做 Git 拉取、不写配置、不删目录；`read_config` 为纯读且不会创建缺失的 config.toml（`src-tauri/src/codex_plugins.rs:451-484`），进入市场源页无副作用。
- **凭据泄露**：`diagnostic` 清除 URL 中 `://…@` 段并截断控制字符（`src-tauri/src/codex_cli.rs:161-182`）；Git 提示与凭据交互被环境变量关闭（`GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、`SSH_ASKPASS_REQUIRE=never`），并有 120s 超时与子进程组清理（`src-tauri/src/codex_cli.rs:39-49`、`24-34`），不会无限等待交互。
- **误报成功/误报未执行**：`operation_result` 解析 JSON 而非退出码，`errors` 非空但 `upgradedRoots` 非空且仅选中目标时判 `Partial`；无法确认时用「命令已结束，但无法确认返回结果」「操作未成功，仍可能已产生变更」表述，不宣称未执行也不宣称已回滚（`src-tauri/src/codex_marketplaces.rs:496-595`）。
- **命令与重读结果混淆**：hook 先 `setResult(outcome)` 再 `read()`，读取失败只置 `error` 并保留旧清单、清空 `snapshotId`（`src/hooks/useCodexMarketplaces.ts:19-30`、`52-56`）；页面标题在 `Succeeded/AlreadyExists` 时写作「操作已完成，但清单读取失败」，并在有旧行时追加「下方为上次结果，已过期，暂时不能操作。」（`src/components/CodexMarketplacesPage.tsx:91-95`）。
- **插件页失效**：仅在 `outcome.executed` 时递增 `pluginRevision`，`Conflict` 不自增；`useCodexPlugins` 在回到「已安装」且 revision 变化时重读（`src/hooks/useCodexPlugins.ts:44-46`），有测试覆盖（`CodexMarketplacesPage.test.tsx:145-160`）。
- **视觉回归 / 世界一致性**：新页完全复用 `Panel`/`PanelHead`/`Table`/`Button`/`Alert`/`AlertDialog`/`Input`/`EmptyState`/`SkeletonRows`，未改 `src/styles.css`，无新装饰、无图像。裁切比对确认行内按钮与基线同款（outline 变体、同底色、同尺寸）；面板节奏（标题行 + 4 行说明 + 列表）、告警位置（面板之上）、列宽比例（24/13/36/27，`table-fixed` + `min-w-[700px]`，对应基线的 5 列 27/13/18/22/20 + `min-w-[680px]`）、展开行 `bg-muted/30` 与 `dl` 栅格，均与基线同构。「添加市场源」用 primary 填充按钮与全站主操作一致（如 `OverviewDashboard.tsx:25` 的「扫描已启用管理器」）。
- **无障碍回归**：`CodexPluginsPage` 由 `<main>` 改为 `<section>` 后，`main` 地标改由 Tabs 根承载（`src/App.tsx:153`）。已核实 Radix `Tabs.Root` 把 props 展开到容器 `div`（`@radix-ui/react-tabs@1.1.21` dist/index.js:91-97），`role="main"` 不会丢失；其余页面仍各自使用 `<main>`，同一时刻仍只有一个 `main`。j/k 焦点行为：取消/Escape 恢复焦点、`pending` 期间不允许关闭以及 `onCloseAutoFocus` 回退到「重新读取」（`CodexMarketplacesPage.tsx:179-183`）经交互检查与测试双重确认。

## 2. 非阻断观察（不影响放行）

1. **页签在任意 Codex 读取/维护期间被禁用**（`src/App.tsx:54`、`155-156`）。`codexBusy` 同时包含两个 hook 的 `scanning`，因此「市场源」首次扫描或手动重读期间两个页签都不可切换。具体场景：CLI 卡住时（`list` 20s + 能力探测 3×5s + `config/read` 15s，最坏约 50s），用户无法从「市场源」切回「已安装」，只能离开整个入口再从侧栏回来。侧栏导航本身在扫描期间始终可用，Rust 侧 `OPERATIONS` 互斥也已串行化 CLI 调用，因此读操作期间禁用页签比必要更严；把禁用范围收窄到 `pending`/`saving`（维护）即可，风险低。不违反 PRD，仅属交互严格度。
2. **两处文案/状态小摩擦**：
   - 重复来源时标题与正文同义：「市场来源已存在」+「该市场来源已存在。」（`src/components/CodexMarketplacesPage.tsx:49-52` 与 `src-tauri/src/codex_marketplaces.rs:560-562`）。建议正文改为陈述影响（如「未新增来源，现有来源保持不变。」）。
   - 清单为空且 `configError` 存在时（例如 CLI 缺少 `marketplace` 子命令的 `--json`），空态仍写「添加 Git 仓库或本地市场目录以开始管理。」，而此时「添加市场源」是禁用的。建议空态文案也受 `!scan?.configError` 约束（既有插件页有同样的潜在问题，不是本次引入的回归）。
3. **能力失败走 `configError` 通道**（`src-tauri/src/codex_marketplaces.rs:237-249`、`303-304`）。能力探测失败时 `status` 仍为 `Ready`，因此标题是「市场来源暂时只读」而非「Codex CLI 版本不兼容」；原因文本已明确写出「当前 Codex CLI 不支持完整市场管理命令，请更新 CLI 后重新读取。」，用户可据此行动，故不构成 PRD 违背，只是分类语义偏软。
4. **单选按钮不带全站 `--ring` 焦点样式**：全局 `:focus-visible` 规则覆盖 `[data-slot=button|input|checkbox|tabs-trigger]` 等，但不含原生 `input[type=radio]`（`src/styles.css:340-347`），键盘聚焦时依靠浏览器默认焦点环。可见、可用，仅与全站风格略有差异。
5. **验证边界（承接 VERIFICATION.md 的自述）**：展开行（市场本地副本／实际本地目录＋用户配置路径）没有任何截图或交互检查覆盖，是本次唯一无视觉证据的分支；其代码与既有插件页展开行逐行同构，风险低。所有界面证据来自注入模拟 IPC 的生产预览，原生目录选择器（`choose_codex_marketplace_directory`，`src-tauri/src/lib.rs:56-65`）未做原生窗口端到端验证，但它沿用了应用既有的 `blocking_pick_folder` 用法（`src-tauri/src/lib.rs:180`）。`check_capabilities` 依赖 `--help` 把 `--json` 打到 stdout、认证失败文案依赖 stderr 子串匹配，均为单版本（0.162.1）事实，失败时退化为原始（已脱敏）stderr，不会误报成功。

## 3. 验收场景追溯

PRD「验收场景」表 20 行全部可追溯到实现或已声明的验证边界，无遗漏行。逐行落点：空市场仍展示（`marketplace list --json` 为唯一清单来源，Rust 测试 `visible_empty_markets_are_not_derived_from_installed_plugins`）；CLI 缺失/不兼容/读取失败（`PluginScanStatus` 分流 + 保留旧行 + 前端 `does not confuse %s with an empty source list`）；空清单与添加入口（`empty-1180.png`）；默认/受管理/归属未知只读（`managed-tools` 行 + 只读原因）；配置损坏或名称与配置键不一致只读（Rust `unknown_sources_mismatched_names_and_changed_addresses_are_read_only`）；有效 Git/本地来源展示官方身份（重读清单回填）；无效本地目录给出校验原因（`validate_source` 与单元测试，界面侧展示于结果告警）；私有来源认证不可用（环境变量关闭交互 + 超时 + `diagnostic` 认证文案，单版本边界见 ADR-0012）；重复来源提示已存在；同名异源拒绝替换（`diagnostic` 映射「先明确移除」）；纯重读不调用 `upgrade`（测试断言全部调用均为 `scan_codex_marketplaces`）；本地来源无 Git 刷新（前后端各有一道门）；刷新确认文案含禁用插件影响（`confirm-refresh-1180.png`）；含已安装插件仍可移除且不追加动作（对话框文案 + RPC 只发 `remove`）；Git 市场移除本地副本由官方命令完成（`real_cli_marketplace_lifecycle_in_temporary_home` 断言原始来源目录保留、清单清空）；取消不执行（`interaction-checks.json` 的 `writes: 0`）；执行前重核与外部变化中止（`change_with` 的 Conflict 分支与测试 `stale_snapshot_changed_home_and_changed_sources_never_execute`）；部分失败与未确认结果如实呈现（`operation_result` 与 `executed` 标志）；成功但重读失败分别呈现并标记过期（`success-read-failed-1180.png`）；刷新后「已安装」页失效重读（`pluginRevision` + 测试）。仅第 8 行（私有 Git 认证）的具体文案依赖 stderr 措辞匹配，属已声明的单版本边界，行为本身（结束操作、说明原因、不保存凭据）已实现。
