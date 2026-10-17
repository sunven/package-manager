# Claude Code Skills 验证记录

日期：2026-10-17。功能已实现，范围以 [PRD.md](PRD.md) 为准。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 35 个文件，265 项通过；见 [前端日志](frontend-test.txt) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 249 项通过，9 项按要求忽略；见 [后端日志](backend-test.txt) |
| `pnpm build` | TypeScript 与生产构建通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml real_cli_scans_and_maintains_an_isolated_copy -- --ignored --nocapture` | 真实 Claude CLI 2.1.302，临时配置与本地来源，1 项通过 |
| `python3 .scratch/codex-skills-management/run-isolated.py real_git_branch_tag_subdirectory_lifecycle` | 共享 Git 获取／复制流程，1 项通过；操作系统拒绝网络，GitHub URL 重定向到临时本地仓库 |

构建仍提示主 bundle 超过 500 kB；非测试 Rust 构建仍有既有 `codex_hook_definitions.rs` 未使用导入警告。本次未做无关调整。

## 行为覆盖

- 后端覆盖当前配置目录、独立／旧命令／禁用插件／同步来源、未知设置、缺失或未验证 CLI、四态及移除用户覆盖、目录键与展示别名、无关配置保留。
- 安装、更新和卸载测试覆盖原来源与用户设置保留、内容基准、同名冲突、名称变化、本地修改停止更新、链接替换、预览后外部修改、重复提交、废纸篓失败回滚。
- 插件默认及声明路径有测试；插件目录外链接不读取，指向插件或同步定义的用户链接不取得独立设置权限；插件身份与保留名称不能作为独立来源安装。
- 共享 Git 测试覆盖子目录、分支更新、固定标签及标签移动后仍使用原提交。它验证 Claude 复用的获取／暂存模块，完整生命周期测试入口仍是 Codex 测试；没有访问真实 GitHub 认证或远程仓库。
- 前端覆盖搜索与筛选、只读原文、未知设置与未覆盖区分、确认前不提交、取消恢复焦点、重复点击只执行一次、安装来源输入、CLI 缺失时定义可读、完成结果与刷新失败分开、插件维护使 Skills 失效。
- App 集成测试覆盖 Skills → 所属插件定位、插件操作后技能重读、技能设置变更后插件清单重读；缺失的插件目标会显示原因。

## 原生契约

[probe-native.py](probe-native.py) 在临时用户配置和项目目录执行 32 组 SDK 初始化观察，结果见 [native-probe-results.json](native-probe-results.json)。只发送 `initialize` 控制请求，未发送用户消息或推理请求，未调用技能；禁用 Hooks、使用空 MCP 配置、假 key 及不可达的本地 API 地址。

确认独立技能实际设置键为目录名，frontmatter 名作为展示／调用别名；旧命令键为冒号限定的相对路径。`off` 从初始化命令表隐藏目标，项目 local 设置可覆盖用户设置，`on` 不会使 `user-invocable: false` 进入用户命令表。模型侧四态语义依据官方文档，本实验没有检查发送给模型的提示内容。

技能写入 gate 为 **2.1.302**。市场、插件与 Hooks gate 仍为 **2.1.300**；测试明确断言没有因新功能放宽旧 gate。定义校验采用本地 YAML frontmatter、名称及文件身份检查，不声称调用了原生独立技能校验命令。

## 界面证据

使用 agent-browser 驱动真实 App 组件，Tauri 返回值由 [browser-review.html](browser-review.html) 提供合成数据，截图均有标识。没有连接或修改用户真实 Claude 配置。

- [1180×760 浅色](../../.impeccable/review/claude-skills/light-1180.png)
- [调用设置确认框](../../.impeccable/review/claude-skills/confirm-1180.png)
- [960×620 深色](../../.impeccable/review/claude-skills/dark-960.png)
- [390px 窄窗口](../../.impeccable/review/claude-skills/narrow-390.png)
- [390px 安装表单](../../.impeccable/review/claude-skills/install-390.png)
- [安装预览取消后收起](../../.impeccable/review/claude-skills/install-focus-1180.png)及[焦点记录](../../.impeccable/review/claude-skills/focus-receipt.txt)

桌面有应用内滚动区域，截图展示实际窗口；窄窗口全页截图显示表单换行，表格局部横滚，页面宽度没有溢出。Skills 安装表单作用域的 axe 检查为 0 项违规。一次 Impeccable detector 输出 `[]`，编辑钩子没有确定性发现。

专用 Impeccable 评审角色在当前环境不可用，改由不继承开发对话的新代理按相同角色说明完成独立评审。初审 disposition 为 `fix`，要求修正安装表单收起焦点与调用设置标题；一批修正并重拍同组截图后，两项均为 `resolved`，复核 disposition 为 `ship`，该结论覆盖所列两项修复。既有视觉系统保持不变。

独立 Documenter 已检查源码、共享样式及截图，将结果写入[页面简报](../../.impeccable/surfaces/src-components-claudeskillspage-tsx.md)，未新增或改写全局设计文件。

## 验证边界

没有实测生产 GitHub 网络与凭据、真实 claude.ai 账户同步、组织策略、运行中会话加载或模型侧提示。真实 CLI 实验使用临时配置；浏览器验收使用模拟 Tauri IPC，没有启动打包后的桌面窗口或操作原生目录选择器。卸载自动化通过注入的临时目录移动验证完整副本及失败恢复，没有操作真实系统废纸篓。部分初始化浏览器会话发生工具超时，废弃捕获未作为验收证据；上述截图已逐一打开核对。
