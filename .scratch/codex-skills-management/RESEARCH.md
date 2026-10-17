# Codex 技能管理事实核查

核查日期：2026-10-17。记录设计访谈中的事实与实验限制；已确认方案见 [PRD.md](PRD.md)。

## 官方契约

实际获取 [Build skills](https://learn.chatgpt.com/docs/build-skills.md) 与 [App Server](https://learn.chatgpt.com/docs/app-server.md) 正文；原 developers.openai.com 的 Codex skills/app-server 文档地址重定向到这两个官方页面。

- 技能是包含 `SKILL.md` 及可选脚本、引用资料和资源的目录。插件可分发技能，两者不是同一种管理对象。
- 本地发现文档列出项目 `.agents/skills`、用户 `~/.agents/skills`、管理员 `/etc/codex/skills` 与 Codex 内置技能；支持目录符号链接。同名技能不合并。
- 原生 `skills/list` 接受 `cwds` 和 `forceReload`；`skills/config/write` 按路径保存启用选择。技能指南与写入示例的路径均指向 `SKILL.md`。
- 禁用可保留文件，只通过用户配置的 `[[skills.config]]` 保存 `enabled = false`。用户配置保存与运行中客户端加载是不同事实，技能指南要求修改配置后重启 Codex。
- 官方指南提供 `$skill-installer` 作为本地安装工作流；它是交互技能调用，不是独立 shell 子命令。已查看的官方接口没有给出与插件生命周期对等的通用独立技能安装、更新、卸载接口。
- 两页对于可选元数据格式存在不一致：技能指南写 `agents/openai.yaml`，App Server 页面写 `SKILL.json`。不要在设计中假定自行解析一种格式就能重建原生全部元数据。

## 本机只读验证

- 本机为 `codex-cli 0.163.0`。`codex --help` 未列出独立 skills 安装／更新／卸载子命令；不能据此宣称所有版本均无此能力。
- 在项目外 `/` 启动短期 app-server，仅调用 `initialize` 与 `skills/list`（`cwds: ["/"], forceReload: true`），未创建 thread/turn；返回 74 项，69 项 user、5 项 system，无清单错误。
- 此版本返回技能字段：`name`、`description`、`shortDescription`、`interface`、`path`、`enabled`、`scope`、`pluginId`。该次清单没有插件技能样本，不能据此推断禁用插件的技能是否可枚举。
- 路径分布：39 项位于用户 `.agents`，26 项位于当前 Codex home，9 项位于其他位置。清单调用前后用户 `config.toml` 的 SHA-256 一致。
- 用户 `.agents/skills` 有 39 个普通目录；当前 Codex home 的 `skills` 有 22 个普通目录和 9 个指向 Claude 技能目录的链接；Claude 技能目录有 30 个链接指向 `.agents/skills`。这些是本机案例，说明目录或链接可能跨工具共享，不构成通用安装结构保证。
- 用户 `.agents/.skill-lock.json` 的技能记录包含 `source`、`sourceType`、`sourceUrl`、`skillPath`、`skillFolderHash`、时间戳等字段；仓库 `skills-lock.json` 包含 `source`、`sourceType`、`skillPath`、`computedHash`。尚未确认记录与每个已发现路径的可靠映射，不以文件名或技能名称自动认领来源。
- 本机内置 skill-installer 的 `install-skill-from-github.py` 支持 GitHub 仓库、子目录、ref 与目标目录，默认目标为当前 Codex home 的 `skills`；目标存在时拒绝覆盖，通过复制安装。未发现配套更新或卸载脚本。这是本机脚本事实，不作为稳定公共生命周期 API。

## 实现前仓库接入现状

- [App.tsx](../../src/App.tsx)：Codex 仅「插件市场」「Hooks」页签。
- [CodexPluginList.tsx](../../src/components/CodexPluginList.tsx) 与 [codexPlugins.ts](../../src/codexPlugins.ts)：技能仅是插件详情名称清单。
- [codex_plugin_details.rs](../../src-tauri/src/codex_plugin_details.rs)：从本地可访问插件声明及目录补读技能名称，不提供独立技能清单或状态。
- [codex_cli.rs](../../src-tauri/src/codex_cli.rs)：已有不启动模型任务的短期 app-server 接入，可供后续实现复用评估；Q5 与 Q7 已确认技能清单和启停采用原生接入并要求兼容 CLI。

## 临时环境实验

使用专用临时 Codex home 与只有技能文本的 fixture；macOS sandbox 禁止网络、临时目录外写入及读取真实用户 `.codex`、`.agents`、`.claude`。未运行模型任务或技能脚本，未修改真实用户技能。

- 当前 Codex home 的普通技能目录与指向同一目录的链接，在本次原生清单中合为一个目标 `SKILL.md` 路径。不能仅凭原生路径判断扫描入口是否有链接，维护资格还需核对本应用持有的安装目录。
- `skills/config/write` 以原生返回的 `SKILL.md` 路径写入 `enabled: false`，返回 `effectiveEnabled: false`，随后 `skills/list` 重读为禁用；其他配置保留、并发冲突等尚未完成验证。
- 本地安装的插件技能返回 `scope: user`，同时提供 `pluginId`，名称带插件前缀。因此不能把 `scope: user` 等同于可维护的独立技能，须优先判断插件归属。
- 后续以临时用户配置中的持久禁用值验证：启用插件时，`skills/list` 返回其技能，带 `scope: user`、非空 `pluginId` 与 `enabled: true`；禁用后，新 app-server 不再返回该插件技能，而不是保留一条 `enabled: false` 的记录。
- 此次禁用同时经 `plugin list --json` 与原生 `config/read` 核对：插件仍为 `installed: true`，启用配置为 `false`，技能清单无错误。实验没有依赖进程级 `-c` 覆盖；结论限定 0.163.0 的本地纯技能插件，不代表所有来源和版本。
- 普通独立技能为 `scope: user`、`pluginId: null`；此次看到的 5 个内置技能为 `scope: system`、`pluginId: null`。没有管理员来源样本。

## 实现前尚需验证

- 更复杂的链接、重复路径与原生身份关系；其他插件来源及 CLI 版本的清单覆盖范围，管理员来源的实际返回形式。
- 当前版本启停写入的配置冲突行为及其他配置保留；需要继续在专用临时环境验证，不修改真实技能或用户设置。
- 新安装的来源记录与副本身份校验仍需实现验证；Q9 已确认不接管旧技能，因此不将其他工具的锁文件作为本应用的维护授权。

## 实现阶段补充核查

- Codex CLI 0.163.0 生成的 `SkillsListParams` schema（包括 experimental 输出）仅包含 `cwds`、`forceReload`。实测 `perCwdExtraUserRoots` 不让待安装目录进入清单；实现不依赖该字段，改用临时 Codex home 的 `skills/<name>`，由同一原生解析器验证。
- 隔离的真实 Codex 生命周期验证已通过：本地复制安装、新装启用、禁用、更新保留禁用、移出安装目录；用户配置中的无关模型设置与注释保留。并发配置、目录和记录变更由应用的快照与提交检查拒绝，不宣称跨进程事务保证。
- 真实 Git 进程在无网络沙箱中用 URL 映射读取本地 fixture 仓库，验证子目录提取、分支取得新提交，以及标签被移动后仍固定原提交。未访问真实 GitHub 或测试私有仓库凭据。
- 来源记录、副本身份、内容基准、同名路径、已有技能不接管和 Trash 失败等行为已有自动化测试。Finder 废纸篓采用替身验证边界和失败处理，未操作真实用户技能；详见 [VERIFICATION.md](VERIFICATION.md)。
