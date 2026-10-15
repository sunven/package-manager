# Codex Hook 定义维护事实核查

日期：2026-10-15。需求：[PRD](PRD.md)。本记录描述官方资料和隔离实验，不代表实现已经完成。

## 官方能力

- [Hooks](https://developers.openai.com/codex/hooks) 支持用户 `hooks.json` 与 `config.toml` 内联定义；同层双来源合并并警告，建议只用一种表示。
- 定义结构为事件 → 匹配组 → 处理程序。修改共享组的匹配条件会影响组内所有处理程序。
- [App Server](https://developers.openai.com/codex/app-server) 文档提供原生清单、通用配置写入和通用文件写入，没有专用定义 CRUD 或信任迁移契约。
- [配置 schema](https://developers.openai.com/codex/config-schema.json) 中存在清单未返回的定义字段，例如 `commandWindows` 与 MCP `input`。编辑模型必须保留来源文件中的原始内容，不能从清单摘要重建定义。
- 官方未承诺 Hook key 的构造算法、各字段与 hash 的对应关系，或删除定义后的状态清理规则。

以上官方页面已实际获取；schema 可能超前于发布版本，不能仅据 schema 推断本机支持。

## 本机身份实验

版本：`codex-cli 0.162.1`。使用独立临时 Codex home 和合成定义，调用 `initialize`、`hooks/list`；没有启动会话或轮次，没有执行 Hook，没有修改真实用户配置。JSON 与 TOML 得到一致结果。

基线：首组有 A、B，第二组有 C；三者已信任，A/C 启用，B 禁用。实验只改定义文件，刻意保留原有 `hooks.state`。

| 修改 | 观察结果 |
| --- | --- |
| 仅改 A 的 command | A key 不变、hash 改变、信任变为 modified；B/C 不变 |
| 把首个 A 移至末尾新匹配组 | B 移至 A 原位置，继承旧 A 的启用设置，变为 enabled + modified；C 不变 |
| 删除首个 A | 未修改的 B 同样变为 enabled + modified |
| 删除整个首组 | C 的位置与 key 改变，信任从 trusted 变为 modified |
| A/B 定义完全相同，仅 A 启用；删除 A | 剩余 B 变为 enabled + trusted |
| macOS 上仅改 commandWindows | 清单及 currentHash 均不变 |

该版本 key 实测包含 canonical 来源路径、事件、分组索引与处理程序索引；协议只声明其为字符串，没有稳定性保证。不能把观察到的格式作为跨版本契约，也不能承诺只删除定义就只影响所选条目。

现有清单 DTO 与本机原生元数据字段对应，缺失原始字段并非简单遗漏映射。`currentHash` 也不能代替完整来源文件的外部修改检查。

## 状态与提交续测

同一版本、独立临时 home 的补充实验：

- JSON/TOML 均允许匹配组保留空 `hooks: []`；原生清单无错误或警告。保留空中间组时，后续组的 key、hash、启用与信任状态保持不变。
- 删除尾项但保留旧 state，再于同一位置新增相同定义，会恢复旧启用与信任；新增不同定义也会继承旧启用选择，但信任为 modified。清单读取不会清理这些记录。
- `config/read(includeLayers: true)` 返回完整用户层 `hooks.state`，包括当前清单之外的记录，以及层路径、版本与字段来源。
- `config/batchWrite` 可一次提交同一 TOML 中的定义数组与状态变化。后续编辑路径非法、定义类型非法、版本过期这三类失败，实验中整份文件均保持不变。
- `value: null` 配合 `mergeStrategy: replace` 可删除指定 state 条目。

这些结果不建立稳定身份映射算法，也不等于跨文件事务或崩溃恢复保证。该接口每批只有一个文件目标，未发现 JSON 定义与 TOML 状态一起提交的原生能力；批量替换数组也不能保证保留数组内部原始格式及注释。

## 总开关关闭时的只读核实

同一版本在临时 home 中实测 `codex app-server -c features.hooks=true`：持久配置关闭时，进程级覆盖可返回与持久开启时完全相同的 Hook 元数据，包括来源、key 和 hash。配置文件字节不变，没有启动 thread/turn，也没有执行 Hook。

进程覆盖后，有效配置与功能清单显示开启，但用户配置层仍显示持久关闭。因此用于定义核实的进程覆盖不能被界面展示为用户已打开总开关，也不能写回持久配置。该实验为 Q6 的需求提供本机可行性依据，不构成其他版本保证。

## 实现必须验证的接入边界

- 共享组拆分、删除及新增复用旧位置时，按 Q11 保护其他定义与启用选择，身份变化者重新审查；无法证明影响范围时拒绝写入。
- JSON 定义与 TOML 状态分别落盘时的中间状态及失败处理，不能假定跨文件事务。
- 具体实现仍需证明身份定位、状态保护、内容保留及失败处理；本次隔离实验并未完成产品 CRUD 接入。
