# Codex Marketplace 接入调查

日期：2026-10-14。实测版本：`codex-cli 0.162.1`。以下实测只证明对应版本与场景，不是最低版本声明或跨版本契约。

## 官方能力

| 能力 | 命令与范围 |
| --- | --- |
| 市场清单 | `codex plugin marketplace list --json`，顶层 `marketplaces` |
| 添加来源 | `add <SOURCE> --json`，支持 Git 或包含 `.agents/plugins/marketplace.json` 的本地市场根目录 |
| 刷新 Git 市场 | `upgrade <MARKETPLACE_NAME> --json`；省略名称会处理全部已配置 Git 市场 |
| 移除来源 | `remove <MARKETPLACE_NAME> --json`，按名称移除已配置来源 |

清单行具有 `name`、`root` 与可选 `marketplaceSource`；本机来源字段包含 `sourceType` 和 `source`，没有配置层级或可写性字段。Git 来源支持仓库简写、HTTP/HTTPS 与 SSH Git URL；CLI 另支持 ref 与 sparse 选项，本次产品首版不提供这些选项。

官方配置参考说明市场刷新可能安装或刷新已配置插件，即使插件被禁用；该说明未直接限定到某个 CLI 子命令。

实现阶段进一步核实了官方 `codex app-server` 的 `config/read`：`includeLayers: true` 返回有效配置和逐字段 `origins`，本机来源记录含 `name.type`、`name.file`、`name.profile`。接入只读取这些归属信息，结合当前用户配置和市场来源核对可维护资格；来源字段被其他层覆盖或信息不足时保持只读，不向前端发送完整配置。该调用已在临时 home 中通过真实 CLI 生命周期测试。

## 隔离实验

实验使用专属临时目录、自建市场与无外部能力的虚拟插件。每个 Codex 子进程显式使用临时 `CODEX_HOME`，工作目录为 `/`；Git 全局与系统配置及凭据交互被禁用。Git 实验只对子进程配置 URL 重写，以虚拟 HTTPS 地址访问自建本地 Git 仓库，并用 `GIT_ALLOW_PROTOCOL=file` 限制协议。未修改用户实际配置、市场或已安装插件。

| 场景 | 观察结果 |
| --- | --- |
| 首次添加本地源 | 成功，`alreadyAdded: false` |
| 再次添加相同本地源 | 成功，`alreadyAdded: true` |
| 不同根目录包含同名市场 | 退出码 1，要求先移除旧来源 |
| 移除包含已安装插件的本地市场 | 市场配置被移除；原始目录、已安装插件缓存、插件启用配置保留；`installedRoot: null` |
| 移除后再读市场清单 | 被移除市场不再出现；再次移除报未配置或未安装 |
| 刷新包含已禁用插件的 Git 市场 | `upgrade` 成功且 `errors: []`；已安装插件缓存内容随源提交变化，`enabled: false` 保持不变 |
| 移除 Git 市场 | 市场配置及 Git 快照被移除；原 Git 仓库、已安装插件缓存、插件启用配置保留；结果返回快照路径 |
| 通过命令行配置注入来源 | 清单同样包含 `marketplaceSource`；移除被拒绝，指出来源属于 `session-flags` |
| 人工配置键与市场目录名称不同 | 清单 `name` 使用目录中的市场名，不能只按名称关联用户配置或确定操作身份 |

## 仍未验证的范围

- 默认／官方隐式来源的移除与再次发现行为。隔离实验没有成功发现构造的隐式项目来源，不能用这个结果推断所有默认市场。
- 所有配置层级、覆盖关系、故障场景与 CLI 版本。清单字段和用户配置相符不应被描述为官方提供了完整的配置归属信息。
- Git 快照删除后的物理空间回收量；本次只核对目录存在性。

对接时应保留官方市场及来源身份，不能仅凭 `list.name` 或 `marketplaceSource` 字段存在与否推断用户所有权。不能明确归属的市场按已确认需求只读，执行时仍需处理官方命令的拒绝及部分失败结果。

原始临时实验记录及 JSON 输出保存在 `/var/folders/38/s1qf24m11tn897xgx9khf2gm0000gn/T/codex-marketplace-fixture-4wraj2ad/`；临时目录可能被系统清理。本文件保存了供后续实现使用的主要观察，未将实验环境当作持久测试套件。

## 官方来源

- [CLI marketplace reference](https://developers.openai.com/codex/cli/reference#codex-plugin-marketplace)
- [Add a marketplace from the CLI](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli)
- [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [App server config/read](https://developers.openai.com/codex/app-server#config-rpc-examples-for-app-settings)
- [Restrict plugin marketplace sources](https://developers.openai.com/codex/enterprise/managed-configuration#restrict-plugin-marketplace-sources)
