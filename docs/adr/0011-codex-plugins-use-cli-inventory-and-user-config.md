# Codex 插件清单来自官方 CLI，启停只修改用户默认设置

首版需要查看本机已安装 Codex 插件并启停。清单采用官方 `codex plugin list --json` 的 `installed`，即使用户只使用桌面 App，也要求本机存在兼容 CLI；不从缓存目录或配置项推断完整安装清单，因为官方没有提供这种推断的完整性契约。

已核实的 CLI 没有独立的持久化插件启停子命令，官方通过用户配置中的 `[plugins."name@marketplace"].enabled` 保存选择。因此本工具只修改当前 Codex home 中目标插件的用户默认启用设置，保留无关配置和注释；不修改项目覆盖、插件内容或其他 home。安装清单与用户默认设置分别读取，不把 CLI 返回的有效启用值当作用户显式设置，也不承诺现有会话立即生效。

## Considered Options

直接扫描配置与缓存，以兼容无 CLI 的桌面 App 用户。这能减少依赖，但缓存副本和配置条目不构成已安装清单的可靠契约，会把遗留文件或待安装项误判为已安装。

等待稳定的启停命令再提供写入。这可以避免本工具编辑配置，但无法完成本次已确认的启停闭环；目前采用官方公开的配置字段，将写入范围限定为单个插件的用户默认设置。

## Consequences

- CLI 缺失或不兼容时明确说明，不能回退为目录扫描或显示空清单。
- 同名插件按所属市场区分；操作前重新核实安装身份与目标设置，发现变更后重新确认。
- 用户配置未显式设置启用值时不能自行假定开启或关闭，可由用户明确选择并确认后保存；无法读取或解析配置时不写入。
- CLI 与桌面 App 只有实际使用同一 home 时才共享这份本地配置；工作区托管插件和项目覆盖不纳入此入口。
- 此操作是插件配置维护，不是缓存清理、插件卸载或会话记录移除，不扩展既有删除能力。

官方依据：[CLI reference](https://developers.openai.com/codex/cli/reference.md)、[插件配置](https://developers.openai.com/plugins/build/plugins.md#enable-or-disable-a-plugin-for-a-repo)、[配置优先级](https://developers.openai.com/codex/config-file/config-basic.md#configuration-precedence)。需求见 [PRD](../../.scratch/codex-plugin-management/PRD.md)。
