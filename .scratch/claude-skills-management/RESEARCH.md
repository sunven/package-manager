# Claude Code 技能管理：事实核查

核查日期：2026-10-17。原始核查用于设计访谈；实现阶段补充了隔离初始化实验，见「实现阶段验证」及 [VERIFICATION.md](VERIFICATION.md)。以下原始核查段落保留当时的观察范围；没有发送推理消息、调用技能或修改用户真实技能／配置。

## 关键结论

- **存在原生单项可见性设置**：`skillOverrides` 支持 `on`、`name-only`、`user-invocable-only`、`off`，可写入用户设置；并非只有 frontmatter 调用限制。插件技能明确不受该设置影响。[1][2]
- **尚未找到完整技能管理清单接口**：本机顶层帮助没有 `skill`/`skills` 子命令；SDK 的机器可读数组只是会话可调用表面，明确遗漏部分技能，不能当成完整维护清单。[3]
- **没有发现通用独立技能安装、更新或卸载 CLI**：官方对个人/项目技能的移除指引是删除对应目录；插件技能和 claude.ai 同步技能分别由插件与账户管理。[4]
- **当前本机是 2.1.302**，仓库既有 Claude 写入 gate 仍只接受 2.1.300。新增技能能力的核实不意味着现有市场、插件和 Hook 操作已完成 2.1.302 兼容验证。

## 原生设置：可见性、调用限制与范围

官方 `skillOverrides` 是从技能名到状态的对象，作用域为 **Any file**，包括用户 `~/.claude/settings.json`。交互式 `/skills` 菜单按 Space 切换，退出后默认写 `.claude/settings.local.json`；这是该菜单的写入目的地，不代表设置只能用于项目。[1][2]

| 值 | 模型收到的技能清单 | 用户 `/` 菜单 |
| --- | --- | --- |
| `on` | 名称与描述 | 显示 |
| `name-only` | 仅名称 | 显示 |
| `user-invocable-only` | 隐藏 | 显示 |
| `off` | 隐藏 | 隐藏 |

未配置视为 `on`。`off` 也从 Remote Control 与 SDK 命令列表隐藏；通过完整名称调用会返回 `skillOverrides` 错误。官方两处明确 **plugin skills 不受 skillOverrides 影响**，应通过 `/plugin` 管理。用户、项目、local 设置按技能名匹配；托管设置与 `--settings` 对内置技能别名还有额外规则，不宜把普通技能与内置命令别名混同。[1][2]

普通设置优先级为 managed > `--settings` > project local > shared project > user。用户文件是跨项目的默认设置，不能展示成当前任意会话的最终状态；项目覆盖和更高层设置仍可能改变结果。[5]

**对同名的设计推论**：`skillOverrides` 以名称为键，不以某个 `SKILL.md` 绝对路径为键。写入用户 `deploy=off`，不能承诺只限制用户选中的一个物理副本；它也可能限制其他项目上下文中按相同名称解析到的技能。官方没有提供按安装副本 ID 启停的契约。具体目录名、frontmatter 显示名、嵌套限定名及别名如何命中，写入前仍需隔离实验，不应自行归一化成路径身份。[1][6]

frontmatter 的两种调用限制不是完整停用：[7]

| 字段 | 官方语义 | 能否当成完整禁用 |
| --- | --- | --- |
| `disable-model-invocation: true` | 模型不能自行调用，用户仍可直接 `/name`；也阻止子代理预加载和以该技能为 prompt 的定时任务 | 否 |
| `user-invocable: false` | 用户不能直接 `/name`，模型仍可调用 | 否 |

`on`、作者 frontmatter 限制、权限规则及组织策略是不同事实；此轮没有实测它们的组合，不宣称设置 `on` 就能强制所有调用路径可用。技能内容一旦被调用，会留在对话上下文；移除目录或改变配置也不能承诺清除已经进入对话的内容。[7][8]

## 发现范围与身份

| 来源 | 官方位置或行为 |
| --- | --- |
| 用户 | `~/.claude/skills/<name>/SKILL.md` |
| 项目 | 项目 `.claude/skills/<name>/SKILL.md`；启动目录向上到仓库根目录 |
| 嵌套项目 | 启动目录下方的技能通常在 Claude 首次读取或编辑该子目录文件后才加载，之后留在本会话 |
| 附加目录 | `--add-dir` / `/add-dir` 所给目录下 `.claude/skills/`；单纯 `permissions.additionalDirectories` 只授予文件访问、不加载配置 |
| 托管 | managed settings directory 中 `.claude/skills/<name>/SKILL.md` |
| 插件 | 插件 `skills/<name>/SKILL.md`，或插件根 `SKILL.md`；随插件加载，通常以 `/plugin-name:skill-name` 命名 |
| claude.ai 同步 | 下载到 `~/.claude/skills/synced/`，由账户与同步规则控制，终端自动同步要求 2.1.273+ |
| 内置 | Claude Code 自带 bundled skills；另有 `disableBundledSkills` 总设置 |

以上为当前官方发现契约。[6][9] `CLAUDE_CONFIG_DIR` 替换官方目录文档中所有 `~/.claude` 路径，因此用户技能与用户设置应对应同一个当前 Claude 配置目录。[10]

同目录/文件名的优先级：enterprise > personal > project；技能优于旧 `.claude/commands/` 命令文件；根项目与嵌套同名技能可同时加载，嵌套技能获得目录限定名；插件技能因命名空间可共存。个人/项目技能的 frontmatter `name` 可以提供菜单名与调用名，目录名仍可用于调用，遇到已有名称还要遵循碰撞规则，不能只拿 frontmatter `name` 当唯一文件身份。[6]

旧 `.claude/commands/*.md` 继续工作，行为已合并到技能体系；命令文件支持相同 frontmatter，但不支持 `name` 和 `paths`。子目录命令名使用冒号，例如 `commands/frontend/component.md` → `/frontend:component`。[6][7]

**共享目录与符号链接**：官方允许 enterprise/personal/project 的 `<skill-name>` 目录项为符号链接，从目标读取 `SKILL.md`，多个位置指向同目标时只加载一次。当前 skills、SDK skills 与目录文档没有把 `~/.agents/skills` 或项目 `.agents/skills` 列为自动发现位置。因此，不能从 `.agents/skills` 有文件就断言 Claude 已发现；通过 `.claude/skills` 符号链接暴露是另一种情况。[6]

插件安装处理链接另有规则：插件内目标保留相对链接；同市场其他位置的目标复制内容；市场外目标跳过。不能把个人技能的链接发现规则套到插件安装副本。[11]

此外，`synced` 为保留目录名，`anthropic-skills` 为保留命名空间；在技能目录中增加 `.claude-plugin/plugin.json` 会把它变为 `<name>@skills-dir` 插件，可包含 agents/hooks/MCP。扫到 `SKILL.md` 不足以证明它是独立技能。[6]

## 清单和维护接口

本机 `claude --version` 输出 `2.1.302 (Claude Code)`。只读帮助核实如下：

| 检查 | 观察 |
| --- | --- |
| `claude --help` | 没有独立 `skill`/`skills` 管理子命令；有 `--disable-slash-commands` 总限制 |
| `claude plugin --help` | 插件有 install/update/uninstall/enable/disable；这些是插件生命周期，不是通用独立技能生命周期 |
| `claude plugin list --help` | 支持 `--json`，对象为插件 |
| `claude plugin details --help` | 提供插件组件清单及 token 估算，帮助没有 `--json` |
| `claude plugin validate --help` | 可验证目录中的 skills/agents/commands，支持 `--json` 与 `--strict`；验证报告不是加载清单 |

官方 SDK 确有机器可读发现表面：[3]

- `system/init.skills` 包含有 `description` 或 `when_to_use` 的用户可调用技能及 bundled skills；明确不含 `user-invocable: false` 技能，后者仍可能供模型使用。
- `system/init.slash_commands` 混合内置命令、bundled skills、用户可调用技能、旧 commands，也可能含 MCP prompts；不含终端交互专用命令与 `user-invocable: false` 技能。
- `skillOverrides=off` 会从 SDK 面向调用者公布的命令列表隐藏。[1]

因此，“原生会话暴露了某技能”“磁盘存在一个定义”“本应用持有一个技能安装副本”不能互相替代。当前未发现类似 Codex `skills/list`、同时带来源路径并覆盖停用项的通用管理契约。这里是**本轮发现范围内未找到**，不宣称不存在任何内部或未来接口。

本轮没有运行 SDK 示例或 `claude -p`。官方 SDK 文档指出，2.1.274+ 对未知 `/name` 会作为普通消息发给模型并消耗一轮；不能拿猜测命令名做无副作用探测。[3]

## 对已有文件及安装副本的影响

以下是由事实推导出的设计边界，不构成独立的产品决策；后续访谈已确认的范围以 [PRD.md](PRD.md) 为准：

1. 已有 `.agents/skills`、`.claude/skills`、第三方安装目录或符号链接目标，不因被观察就成为应用的技能安装副本。沿用仓库 ADR-0019 的“文件归属与原生发现分离”词汇有依据，但 Claude 的清单与名称启停契约须单独设计。
2. 从共享来源复制到当前 Claude 配置目录可形成独立安装副本；直接编辑或更新共享源/链接目标会影响其他代理。写 Claude `skillOverrides` 不需要改共享 `SKILL.md`，但其影响按技能名而非物理路径界定。
3. 独立技能若由应用负责安装、更新和卸载，需要应用自己的来源、所有权与修改检测记录；官方没有为通用独立技能提供对等的安装来源账本或更新命令。`plugin validate` 可以作为后续候选验证机制，仍需验证其报告、错误容忍与副作用边界。
4. claude.ai 同步目录只下载、不上传，手工修改可能被下一次同步覆盖或移除，手工删除可被重新下载；不能把同步缓存认领成应用维护副本。[9]
5. 有 `.claude-plugin/plugin.json` 的技能目录按插件识别，插件技能按插件整体管理，不能通过独立技能按钮绕过插件状态。[1][6]

## 验证局限与后续依据

现有 `src-tauri/src/claude_cli.rs:130` 对写入严格要求 2.1.300；旧研究 [.scratch/claude-code-management/RESEARCH.md](../claude-code-management/RESEARCH.md) 的实验也只覆盖该版本。当前 2.1.302 只检查版本和帮助，未做隔离 skillOverrides 写入/发现实验，也未认证现有市场与 Hook 写入兼容性。

官方页面未给出 `skillOverrides` 基础能力的最低版本；文中 2.1.260 只对应别名规则改动，不能据此推断其首次支持版本。实现之前仍需核实：四态与 frontmatter/权限的合成、名称与别名命中、用户及项目覆盖、目录外链接身份、无模型请求的观察方式，以及版本能力检测。此核查不修改版本 gate。

## 实现阶段验证

2026-10-17，在 Claude Code **2.1.302** 的临时配置与项目目录中运行 [probe-native.py](probe-native.py)。脚本仅发送 SDK `initialize` 控制请求，不发送用户消息；禁用 Hooks，使用严格空 MCP 配置、假 API key 和不可达的本地 API 地址。结果保存在 [native-probe-results.json](native-probe-results.json)，共 32 组观察。

- 独立技能目录 `probe-original` 的 frontmatter 名为 `probe-alias` 时，SDK 列表展示后者并附目录别名。用户 `skillOverrides["probe-original"] = "off"` 将其隐藏，写 `probe-alias = off` 不生效。实现因此使用目录名称作为实际设置键，展示名另行呈现，且不对歧义名称开放写入。
- 四态和移除覆盖均被该版本接受；`off` 从初始化命令表隐藏目标。该命令表仍携带 description，不能用于证明 `name-only` 的模型提示内容；模型侧四态语义依据官方契约，未发送推理请求验证。
- `user-invocable: false` 在四态及未覆盖时均不进入用户命令表；`on` 没有绕过作者声明。`disable-model-invocation: true` 的技能仍可出现在用户命令表，`off` 将其隐藏。
- 旧命令使用冒号限定键 `frontend:probe-command`；用户 `off` 将其隐藏，项目 local `on` 可覆盖该用户选择。
- 本应用后端的真实 CLI 测试在另一临时配置目录完成本地复制安装、插件清单读取、技能扫描与用户设置保存。未触碰用户真实安装。
- 独立定义使用本地 YAML frontmatter 与文件身份校验，不把 `plugin validate` 误当通用独立技能验证接口。来源插件身份、保留名称、未知值及名称冲突会限制操作。

仅技能写入开放 **2.1.302**；现有市场、插件与 Hooks gate 仍为 **2.1.300**。未实测真实账户同步、组织策略、运行中会话、模型侧提示、桌面系统选择器与真实废纸篓。完整自动化、Git 与界面证据见验证记录。

## 来源

1. [Skills — Override skill visibility from settings](https://code.claude.com/docs/en/skills#override-skill-visibility-from-settings)
2. [Settings reference — skillOverrides](https://code.claude.com/docs/en/settings-reference#skilloverrides)
3. [Agent SDK skills — Confirm skills loaded / Discover available commands](https://code.claude.com/docs/en/agent-sdk/skills#discover-available-commands)
4. [Skills — Remove a skill](https://code.claude.com/docs/en/skills#remove-a-skill)
5. [Settings — Settings precedence](https://code.claude.com/docs/en/settings#settings-precedence)
6. [Skills — Choose where skills load / Resolve skills that share a name / How a skill gets its command name](https://code.claude.com/docs/en/skills#where-skills-live)
7. [Skills — Frontmatter reference / Control who invokes a skill](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill)
8. [Skills — Skill content lifecycle](https://code.claude.com/docs/en/skills#skill-content-lifecycle)
9. [Skills — Skills synced from claude.ai](https://code.claude.com/docs/en/skills#how-synced-skills-behave)
10. [Claude directory reference](https://code.claude.com/docs/en/claude-directory) 与 [CLAUDE_CONFIG_DIR](https://code.claude.com/docs/en/env-vars#variables)
11. [Plugin marketplace — Share files with symlinks](https://code.claude.com/docs/en/plugins/host-marketplace#share-files-within-a-marketplace-with-symlinks)

本机 CLI 帮助是上文 shell 命令的直接输出；没有把当前在线文档对新版本的描述当成对 2.1.300 的验证结果。
