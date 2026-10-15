# Claude Code 管理：事实核查

核查日期：2026-10-15。本文件保留实现前的设计依据与参考基线；确认范围以 [PRD](PRD.md) 为准，后续实现状态和验证结果见 [VERIFICATION.md](VERIFICATION.md)。

## 本仓库参考基线

已核实源码：Codex 侧栏入口下有「插件市场 / Hooks」，插件列表位于市场展开区域。市场支持来源添加、逐个同步与移除；插件支持详情、安装、重新安装、卸载与用户默认启停；Hooks 支持用户定义表单新增、编辑、删除，以及原生启停和只读插件定义。

主要依据：`src/components/Shell.tsx`、`src/App.tsx`、`src/components/CodexMarketplacesPage.tsx`、`src/components/CodexPluginList.tsx`、`src/components/CodexHooksPage.tsx`、`src/components/CodexHookEditor.tsx`，以及 `src-tauri/src/codex_{marketplaces,plugins,hooks,hook_definitions}.rs`。

ADR-0015 的「产品接入尚待实现」已落后于源码及 `.scratch/codex-hooks-configuration/PRD.md` 的 done 状态；市场插件补全 PRD 页头也落后于其正文与验证记录。此次以实际接线和验证记录作为参考范围，不将旧迭代的非目标套用于新需求。

核查时 Claude 仅有会话记录入口，已支持解析 `CLAUDE_CONFIG_DIR`；当时尚无市场、插件或 Hooks 管理适配。

## Claude 原生能力

本机版本为 **Claude Code 2.1.300**。初步核查运行版本与 CLI 帮助、读取官方文档；后续进行下述隔离 fixture 实验。没有读取私人设置、启动会话或修改真实市场、插件及配置。

| 对象 | 已核实事实 | 设计影响 |
| --- | --- | --- |
| 市场清单 | `claude plugin marketplace list --json` 提供已配置市场；普通 JSON 不包含声明 scope 的完整信息 | 不能将清单可见等同于当前用户可维护；需另行核实来源归属 |
| 市场维护 | add/remove 可显式传 user/project/local scope；remove 省略 scope 会移除所有 scope | 用户范围操作必须显式限定 scope |
| 市场移除 | 从最后一个声明 scope 移除时会级联卸载市场插件，并删除缓存及可删除的插件选项、秘密与数据 | 不能复制 Codex「仅移除市场来源」的影响文案 |
| 市场刷新 | 文档明确交互面板的 Update marketplace 会同时更新插件，无名 shell `marketplace update` 只刷新目录；2.1.300 隔离 fixture 中具名 shell update 也仅刷新目录 | 不能套用交互面板结论；单版本 fixture 不构成跨版本保证 |
| 插件清单 | `plugin list --json --available` 返回 installed/available，安装记录含 scope、projectPath、installPath | 必须区分用户安装与项目安装；enabled 是合并后的值，不是用户显式选择 |
| 插件维护 | install/enable/disable/update/uninstall 均有官方 CLI 和 JSON；enable/disable 省略 scope 会按 local→project→user 寻找声明 | 使用原生操作并显式指定 user，不能照搬 Codex 手写配置启停 |
| 依赖 | 安装可能带依赖，启用可能连带启用依赖，禁用可能因被依赖而拒绝 | 成功与失败反馈不能假设只影响一行 |
| 插件身份 | 除 `name@marketplace` 外，还有 `@skills-dir`、`@synced`、`@inline` 等来源，部分没有安装记录 | 需确认首版是否仅管理市场插件 |
| Hook 枚举 | 会话内 `/hooks` 是只读浏览器；未发现公开的非会话 JSON inventory CLI | 不能照搬 Codex 原生 hooks/list，也不能为了扫描启动代理会话 |
| Hook 启停 | 官方明确无法保留定义同时禁用单个 Hook；未发现逐定义 enabled/trusted_hash 或插件单 Hook 覆盖的公开契约 | 单项停用若保留定义，需要本工具额外保存机制；这是新设计，不能伪装成原生状态 |
| Hook 来源 | user/project/local/managed 设置、插件、skill/subagent frontmatter；另有 mod 函数 Hook | 文件定义集合不等于完整会话运行清单 |
| Hook 类型 | JSON 定义含 command/http/mcp_tool/prompt/agent | 事件与类型组合及表单字段应按 Claude 契约设计 |
| 插件 Hook 声明 | 默认 hooks/hooks.json 与 manifest 附加路径、内联对象、混合数组均需考虑 | 只读默认文件会漏定义；声明与当前会话是否加载分别表达 |
| 总开关与信任 | disableAllHooks 不等于单项状态，用户层不能关闭 managed hooks，项目 false 可能覆盖用户值；信任是工作区/会话机制 | 不移植 Codex 逐定义 hash 信任；不宣称用户开关是全局绝对禁用 |

用户配置位于 `~/.claude/settings.json`，`CLAUDE_CONFIG_DIR` 会迁移用户配置、插件与历史位置。插件通常需 `/reload-plugins` 或新会话才加载变更；Hook 定义变更通常自动重载，不能据本工具保存成功断言某个既有会话的实际执行状态。

CLI 文档给出的机器可读版本界限：插件生命周期 JSON 从 2.1.268 起，市场变更 JSON 从 2.1.287 起；JSON 是 stdout 最后一行，需同时检查退出码。帮助与文档不构成跨版本行为实验。

## 2.1.300 隔离市场实验

使用 `/private/tmp/claude-market-probe-p8ooe_8w/` 中纯本地 Git 市场与静态 skill 插件，无 Hook、MCP 或安装脚本。Claude/Git 进程使用临时 `CLAUDE_CONFIG_DIR`，HOME 保持原值；sandbox-exec 禁网络、禁止读取真实 `.claude`、`.claude.json`、`.codex`、`.agents` 及系统 Claude 管理配置，只允许临时目录写入，另允许 Git 所需 `/dev/null` 非持久写入。负向探针验证上述限制确实生效。

| 场景 | 实验结果 |
| --- | --- |
| 市场插件源从 1.0.0 升到 2.0.0，具名 `marketplace update --json` | 市场副本刷新；两个分别启用、禁用的 user 插件均仍是 1.0.0；安装记录、安装文件、启用设置逐字节不变 |
| 在项目 A 内移除 user 市场声明，A 仍声明同一市场 | 保留全部安装 |
| 恢复 user 声明后，从项目外移除同一 user 市场 | 该市场全部 user/project/local 安装记录被删除；项目市场声明与启用设置原样保留，成为已声明但未安装；市场副本被删除，fixture 插件缓存文件仍留存 |
| 从项目外运行 `plugin list --json` | 仍能列出 project/local 安装与 projectPath，enabled 则是当前上下文值，不代表其他项目中的实际启用状态 |

因此 `remove --scope user` **只限定市场声明写入位置，不限定卸载影响范围**。本轮用户范围设计需要读取全作用域安装记录进行影响检查；这不意味着给项目提供管理入口。存在非 user 安装或无法判明影响时，不执行市场移除。官方描述与本机缓存残留观察应分别呈现，不能承诺准确删除文件集合或回收空间。

原始证据索引：`/private/tmp/claude-market-probe-p8ooe_8w/EVIDENCE.md`；关键日志为同目录 `logs/12-market-update-named.json`、`logs/26-remove-user-projectless.json`、`logs/checks.json`。本节保留了不依赖临时文件长期存在的结论。未验证其他 CLI 版本、managed、claude.ai 或 command 来源。

## Hook 编辑约束

- 定义结构为事件→匹配组→一个或多个 handler；修改共享 matcher 时，单条编辑必须拆出目标 handler 并保留其他定义。数组顺序不等于运行顺序，匹配 handler 可并行执行。
- 用户未知事件/类型只读，已知条目的未知字段原样保留，这是本应用编辑器约束，不是官方对未知字段加载行为的承诺。无法可靠保留结构时不写入。
- 插件默认 `hooks/hooks.json` 与 manifest 附加声明累加。manifest 可为路径、内联事件映射或混合数组；外部文件具有顶层 `hooks` wrapper，而内联对象直接是事件映射。不得仅扫描一处或自动合并去重。
- 总开关只表示用户配置中的选择；项目可以覆盖，managed hooks 另有规则。读取定义不需要打开总开关。

| 类型 | 主要字段与约束 |
| --- | --- |
| command | command；args 存在时为直接 exec；shell、async、asyncRewake、onFailure 按版本与组合约束处理 |
| http | url、headers、allowedEnvVars、onFailure；仅允许列表内的环境变量在 header 中插值 |
| mcp_tool | server、tool、input；插件 server 使用完整名称；配置保存不执行工具或 OAuth |
| prompt | prompt、model、continueOnBlock |
| agent | prompt、model；实验性，不支持 continueOnBlock |

共有字段的 timeout、statusMessage、if 按适用条件展示。if 仅支持 PreToolUse/PostToolUse/PostToolUseFailure/PermissionRequest/PermissionDenied；在其他事件使用会让 handler 不运行。once 仅 skill frontmatter 生效，不作为用户定义表单选项。onFailure 仅 command/http，文档要求 2.1.295+，且并非所有事件或后台模式生效。

不能复用 Codex 事件矩阵。Claude 五类均可用的事件包括 PermissionDenied、PostToolBatch、PostToolUse、PostToolUseFailure、PreToolUse、Stop、SubagentStop、TaskCompleted、TaskCreated、TeammateIdle、UserPromptExpansion、UserPromptSubmit；PermissionRequest 不支持 agent。SessionStart/Setup 仅 command/mcp_tool，且启动及 Setup 时 MCP 尚不可用而跳过，SessionStart 在 clear/compact 后再次触发时才可能运行 MCP。其他事件需按官方矩阵限制 prompt/agent。无 matcher 能力的事件不提供 matcher 编辑，已有原文则保留。

## 可添加市场来源

官方 CLI 支持 GitHub shorthand、Git、含 `.claude-plugin/marketplace.json` 的本地目录、本地 marketplace JSON 文件，以及远程 marketplace JSON URL。GitHub 支持 #ref 或 @ref，Git 使用 #ref；CLI 没有独立 --ref。--sparse 仅适用于 github/git。远程 JSON 只下载目录，所以目录项不能引用相对插件路径。

claude.ai 托管来源使用独立 --claudeai 入口。npm 市场尚未实现；内联及策略 schema 类型不等于 CLI 可添加来源。自定义 Git 市场文件 path 需要另外编辑配置，不能假定普通 add 支持。

官方说明添加市场可能补装现有插件缺失的依赖，因此不能将添加来源称为仅修改市场目录的操作。

## 官方来源

- [插件 CLI reference](https://code.claude.com/docs/en/plugins/cli-reference)
- [安装与管理插件](https://code.claude.com/docs/en/discover-plugins)
- [插件加载与目录](https://code.claude.com/docs/en/plugins/loading)
- [配置文件](https://code.claude.com/docs/en/settings)
- [Hook 配置与禁用](https://code.claude.com/docs/en/hooks#disable-or-remove-hooks)
- [Hook 工作区信任](https://code.claude.com/docs/en/hooks#workspace-trust)
- [插件 Hook 声明](https://code.claude.com/docs/en/plugins-reference#hooks)
- [市场来源](https://code.claude.com/docs/en/plugins/marketplace-reference#marketplace-sources)
- [添加市场](https://code.claude.com/docs/en/plugins/install#add-a-marketplace)
