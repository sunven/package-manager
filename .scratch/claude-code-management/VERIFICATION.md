# Claude Code 管理验收记录

日期：2026-10-15。范围以 [PRD](PRD.md) 的 Q1–Q13 为准。

## 已实现

- 独立 Claude Code 入口，插件市场与 Hooks 两页签；沿用当前 Codex 的市场内插件浏览结构与现有明暗主题。
- 用户范围市场添加、更新目录、移除，以及插件安装、更新、卸载、启用和禁用。使用项目外上下文、结构化参数、显式 user scope；执行前复核来源、身份、配置与全作用域安装记录。
- 五类用户 Hook 定义的表单编辑、预览、保存与删除；插件声明只读，包含禁用插件。保留未编辑定义、未知字段、用户总开关与无关配置的原始字节，不执行 Hook 或删除引用脚本。
- 读取、操作和刷新失败分别反馈；失效快照不可提交，配置冲突保留草稿，不自动重放写入。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `pnpm build` | 通过 TypeScript 与 Vite 生产构建；主包约 693 kB，保留 Vite 的大于 500 kB 提示 |
| `pnpm test` | 30 个文件、223 项测试通过，无失败 |
| `cargo test --quiet` | 201 通过、6 忽略，无失败 |
| `cargo test --quiet claude_` | 25 通过、1 忽略，无失败 |
| `pnpm exec vitest run src/components/ClaudeCodePage.test.tsx` | 最后一次界面修正后 18 通过 |
| 原生 `claude_plugins::tests::native_user_lifecycle` | 在下述操作系统沙箱中单独运行，通过 |
| `git diff --check` | 通过 |

Rust 回归覆盖安装事实与用户启用选择的区分、跨作用域市场移除拦截、来源不符只读、缺失作用域／版本拒绝读取、旧确认不可重放、目录更新参数、Git ref/sparse 校验、默认与附加插件 Hook 声明、五类字段／事件限制、共享 matcher 拆组、未知字段保护、引用脚本保留、CLI 缺失只读、外部修改与符号链接替换拦截，以及无关配置字节与权限保留。

前端回归覆盖市场连带影响确认与取消、插件搜索／详情／安装确认、失败保留输入、五种表单、预览后提交、MCP JSON 校验、配置冲突保留草稿、禁用插件只读、用户总开关关闭仍可编辑、成功后重读失败不重放、`*` 匹配全部、异常非对象处理程序只读展示，以及首次读取失败不冒充空清单。

## 真实 CLI 隔离验证

Claude Code **2.1.300**，静态本地市场及 skill fixture，无 Hook、MCP 或安装脚本。实际调用本次 Rust 实现的 CLI 适配器，完成添加市场 → 安装 → 禁用 → 启用 → 更新插件 → 更新目录 → 卸载 → 移除市场，并重读安装与用户启用状态。

- 复测结果：[native-smoke-result.json](native-smoke-result.json)。退出码 0，1 项测试通过，耗时 9.08 秒。
- 沙箱规则：[native-smoke-sandbox.sb](native-smoke-sandbox.sb)。禁网络，禁止读取真实 `.claude`、`.claude.json`、`.codex`、`.agents` 和系统 Claude 管理配置，写入仅限临时验证目录及 `/dev/null`。
- `HOME` 保持原值；由测试设置临时配置目录，运行时使用临时 `TMPDIR` 和 `PM_CLAUDE_NATIVE_SANDBOX=1`。
- 原始证据目录：`/private/var/folders/38/s1qf24m11tn897xgx9khf2gm0000gn/T/pm-claude-smoke-s17dqnoa/`。复现须先建立适配本机临时目录的同等 OS 沙箱，再调用构建后的测试可执行文件；测试默认忽略，不在真实配置下直接运行。

目录更新与跨作用域移除的前期原生实验见 [RESEARCH.md](RESEARCH.md)。认证、联网下载和真实依赖关系未进行端到端操作；这些路径通过原生 CLI 委托与参数／结果测试验证，未宣称已验证所有远程来源。

## 界面与交互

使用 `agent-browser` 运行真实 React App，注入[合成 Tauri bridge](browser-fixture.js)；页面明确标注“合成测试数据 · 不连接本机 Claude”。本轮不是原生 Tauri 窗口端到端测试，也没有通过界面修改真实 Claude 配置。

截图位于 [.impeccable/review/claude-code](../../.impeccable/review/claude-code/)：1180×760 浅色市场、详情、Hooks、HTTP 表单与保存预览；960×620 深色市场、Hooks、MCP 表单上下部与市场移除确认；390px 窄布局；通配 matcher、异常处理程序和首次读取失败状态。每张截图均已打开核对。

- 390px 时 document 宽度为 390px，市场表格在 356px 容器内局部滚动到 720px；960px 时 document 宽度为 960px，Hooks 表格局部滚动到 760px。
- Escape／取消后焦点恢复到触发按钮；短窗口表单底部操作可滚动到达。
- 设计 hook 未报告确定性问题。独立评审采用技能提供的 fallback reviewer contract，完整审查记录见 [finish-review.md](../../.impeccable/review/claude-code/finish-review.md)。首轮唯一问题为首次 Hook 读取失败的空状态文案，已修正并补测试，复评确认解决。

## 兼容与验证边界

- 写操作仅开放给已经验证的 **Claude Code 2.1.300**；不将单版本结果扩大为跨版本兼容承诺。其他版本只读，CLI 缺失仍可展示可读取的用户 Hook 定义。
- 只管理当前用户。项目／local 安装只用于市场移除影响核查；不提供项目维护、claude.ai 托管市场添加、特殊插件来源管理或局部技能／子代理 Hook 管理。
- Hook 清单是定义清单，安装与启用也不代表现有会话已加载。需在 Claude 中重新加载或开启会话核对，不在本工具测试执行。
- 本轮没有打包发布、签名或公证；验证范围为当前实现与上述测试。

## 收尾结果

- 最终复评 [verdict-pass.md](../../.impeccable/review/claude-code/verdict-pass.md) 的 disposition 为 **ship**，范围为所列修复项，不扩大为原生 Tauri 全流程验证。
- 独立[文档核验](../../.impeccable/review/claude-code/documentation-check.md)完成，保留既有蓝灰主题、字体、Panel／Table／Dialog 体系；此次为普通扩展，未创建新全局设计系统。既有样式覆盖差异仅记录，未扩大修改范围。
- 最终完整前端 223 项、Rust 201 项测试通过；构建、真实 CLI 沙箱复测及 diff 检查通过。本次浏览器与 Vite 检查会话已关闭。
- PRD 状态更新为 done。
