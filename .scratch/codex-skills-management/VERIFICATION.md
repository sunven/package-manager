# Codex Skills 实现验证

日期：2026-10-17。需求见 [PRD](PRD.md)，接入决策见 [ADR-0019](../../docs/adr/0019-codex-skills-use-native-discovery-and-owned-installations.md)。

## 已实现

Codex 新增 Skills 页签，原生发现与启停、搜索／来源／状态筛选、只读说明，以及 GitHub 或本地目录的单项预览安装。本应用持有的副本支持手动更新和移入废纸篓，已有／共享／链接技能仅启停，插件与非用户来源只读，插件入口展开所属市场与插件。

维护以原生路径、安装记录、目录设备与 inode、内容基准和配置快照核对；准备计划保留在后端，确认一次即消费。更新前发现本地修改、目录替换、链接、配置／记录外部变更会停止。操作与重读结果分别反馈；已移走文件后记录保存失败报告部分完成，失败时优先还原原副本，否则报告恢复位置。来源记录缺失或损坏时不会接管已有技能。

## 自动化检查

| 检查 | 结果 | 主要覆盖 |
| --- | --- | --- |
| `pnpm build` | 通过 | TypeScript 与 Vite 生产构建；保留已有超过 500 kB chunk 提示 |
| `pnpm test` | 34 个文件、256 项通过 | 新增 Skills 页面与工作流 5 项集成交互测试；扩展 App 插件跳转／失效重读测试；现有页面回归 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 236 项通过、8 项 opt-in 测试忽略 | Skills 新增 14 项默认测试；现有后端回归 |
| `git diff --check` | 通过 | 补丁空白检查 |

技能测试包含：复制／更新／保留禁用／卸载修改副本；目录冲突与不接管；插件 user scope 仍只读；项目技能排除；缺失原生插件归属字段不能被当成独立技能；配置、来源记录、内容、身份与链接变化拒绝旧确认；一次性计划；取消和非法元数据；损坏所有权记录不能转移维护目标；启用失败保留已安装事实；Trash 失败还原、后续记录失败报告部分完成；特殊暂存目录名称与只读子目录。

前端集成测试使用真实 hook 与页面，模拟 Tauri 边界，验证来源／启停筛选、惰性纯文本详情、来源限制、GitHub 标签与本地选择、取消不提交、重复确认仅执行一次、保存后重读失败保留结果，以及插件数据变化撤销确认、再次进入重读。App 测试验证技能链接展开目标市场与目标插件，并在插件维护后重读技能。

## 真实 Codex 与 Git 隔离验证

本机版本 `codex-cli 0.163.0`，不声称最低兼容版本。先编译测试二进制，再用 [run-isolated.py](run-isolated.py) 启动：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run
python3 .scratch/codex-skills-management/run-isolated.py
python3 .scratch/codex-skills-management/run-isolated.py real_git_branch_tag_subdirectory_lifecycle
```

两项均通过。macOS sandbox 禁止网络、临时根目录之外的文件写入，以及读取真实用户 `.codex`、`.agents`、`.claude`；所有 fixture 内容只在专用临时目录。未启动模型任务或技能脚本，未安装或修改真实用户技能。

- `real_codex_local_skill_lifecycle`：实际 app-server 验证本地副本预览、新装启用、禁用、更新后仍禁用、卸载，以及无关配置／注释和原始来源保留。Trash 边界注入临时目录移动，不调用 Finder。
- `real_git_branch_tag_subdirectory_lifecycle`：实际 Git 裸克隆、归档及提取；临时 Git config 将测试 GitHub URL 映射到本地仓库。通过来源子目录安装，分支更新读取新提交并保留禁用，移动标签后仍提取原提交；仓库工作树不变。该项的原生清单采用 fixture。

安装预览使用临时 Codex home 的原生清单。0.163.0 不支持预先考虑的额外技能根目录参数，这一行为已通过实测和生成 schema 核对，实现没有依赖该参数。

## 浏览器与界面

使用 agent-browser 独立命名会话与 [合成数据页面](browser-review.html) 加载真实 App、hook 和组件。页面明确标注合成数据，未连接本机 Codex。取证在主题切换／弹窗动画结束后完成，错误或热更新引起的失效截图已替换。

截图位于 `.impeccable/review/codex-skills/`（开发证据，不进入产品）：

- `light-1180.png`、`dark-1180.png`：1180 × 760 默认桌面窗口。
- `light-960.png`、`dark-960.png`：960 × 620 配置最小窗口。
- `uninstall-1180.png`、`install-1180.png`：单项确认与 GitHub 安装表单。
- `saved-refresh-failed-1180.png`：保存事实与过期清单分开显示、暂停写入。
- `details-scrolled-1180.png`、`plugin-jump-1180.png`：应用内容区滚动后的只读说明及所属插件自动展开。

浏览器核对取消恢复到原卸载按钮焦点、表单可用、保存后刷新失败、恢复刷新、展开说明和所属插件跳转。axe-core 4.12.1 在 Skills 区域及确认框分别得到 0 violations、0 incomplete。浅深主题与最小窗口已目视核对，页面采用既有组件与样式，没有修改全局设计系统。

独立界面终审结论为 `ship`，五部分契约检查通过，没有要求修复的界面问题。当前运行环境未注册 Impeccable 专用代理类型，改由独立、无历史上下文的代理按随技能提供的同一终审规范检查。根目录 `DESIGN.md` 原先缺失，本次为既有界面扩展，未据此重写全局设计系统。独立文档复核已完成：核对实际源码、共享样式与组件、PRODUCT.md、九份 Skills 截图及既有 Hooks 截图，结果记录在对应 surface brief；未发现需要新增的全局规则，保留原有文档缺失情况。

## 验证边界

- 未进行真实 GitHub 网络下载、私有仓库认证或网络中断端到端验证；代码沿用本机 Git 认证、禁止交互提示，设进程组超时。
- 未在真实 Tauri 窗口操作原生目录选择器、Finder 废纸篓或恢复；目录移动及失败路径使用测试替身。未打包安装桌面应用。
- 未验证其他 Codex 版本与实际管理员技能来源；用户范围外的来源按后端规则只读。
- 配置、来源记录与文件目录之间没有跨文件事务；应用阻止已观察到的冲突并如实反馈部分完成，不承诺任意外部进程同时写入时的原子性。
