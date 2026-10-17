# P1 搜索、环境诊断与历史：验证记录

验证日期：2026-10-17。范围为本轮新增能力及既有扫描／维护工作流回归。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 40 个测试文件、291 项通过 |
| `pnpm build` | 通过；Vite 提示主 JS 包约 764 kB，超过 500 kB 建议值 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 259 项通过，9 项 ignored；main 与 doc tests 通过 |
| 新增 Rust 文件的定向 `rustfmt` | 通过，未格式化无关文件 |
| `git diff --check` | 通过 |

9 项 ignored 为原有需要真实 CLI／专用隔离环境的测试，本轮未运行。构建包体提示未在本轮引入无关的拆包重构。

重点覆盖：

- 搜索保留跨管理器、多个运行时安装的身份，定位不依赖行号；历史投影不保存可执行动作。
- 同来源完整清单才计算条目差异；不同来源、读取失败、不完整清单、Maven 版本集合、Docker 容器运行时长与目录测量不足均有用例。
- 完整扫描和补充检查结束后归档一次，失败尝试不重新包装上次成功观察；执行结果与后续核对结果分离。
- 多个管理器归档失败时分别保留提示，某个管理器保存恢复只消除自身提示；新增用例先复现失败，再修正并通过全量前端回归。
- 历史重启读取、每管理器 20 份快照、全局 200 条记录、关联过期／跨管理器校验、损坏或未知格式保护、并发写入和保存失败。
- PATH 顺序、相对和空路径项、符号链接与同文件入口、非可执行文件、损坏链接、无法完整读取；检查过程中不运行候选程序。有不可读取的 PATH 位置时，不声称已确认单一来源。
- 观察工具按需读取、刷新、请求竞态、卸载及 StrictMode 生命周期。

## 浏览器验证

使用 `agent-browser` 运行真实 `App`，入口为 [browser-review.html](browser-review.html)，本机 IPC 全部由 [browser-fixture.js](browser-fixture.js) 拦截。所有包、路径、快照和维护结果均为验证用数据；没有运行真实缓存清理或全局包卸载，也未以此验证真实 CLI 兼容性。

矩阵：1180 × 760 与 960 × 620，明暗主题；桌面应用使用固定外壳和内部滚动。截图均已打开核对，字体加载完成，没有空白捕获或水平页面溢出；浏览器未报告 JavaScript 错误。

| 场景 | 验证与证据 |
| --- | --- |
| 跨管理器搜索 | 顶部按钮与 `⌘K` 打开；扫描全部、输入查询、方向键／Enter 选择；Escape 动画结束后返回原焦点。见 [1180 浅色](../../.impeccable/review/p1-observation/search-light-1180.png)、[960 浅色](../../.impeccable/review/p1-observation/search-light-960.png)、[1180 深色](../../.impeccable/review/p1-observation/search-dark-1180.png)、[960 深色](../../.impeccable/review/p1-observation/search-dark-960.png)。 |
| 精确定位 | 两个 Node 安装中选中 22.16.0，包行获得焦点、高亮和选择；目录搜索打开选定路径面板。见 [包定位](../../.impeccable/review/p1-observation/package-light-1180.png)、[目录定位](../../.impeccable/review/p1-observation/path-light-1180.png)。 |
| 环境诊断 | 展开 Node 不同来源与 pnpm 同文件多个入口，核对 PATH 次序、文件目标。见 [1180 浅色](../../.impeccable/review/p1-observation/environment-light-1180.png)、[960 浅色](../../.impeccable/review/p1-observation/environment-light-960.png)、[1180 深色](../../.impeccable/review/p1-observation/environment-dark-1180.png)、[960 深色](../../.impeccable/review/p1-observation/environment-dark-960.png)。 |
| 快照对比 | 选择较早快照显示清单减少、版本变化及目录差值。见 [1180 浅色](../../.impeccable/review/p1-observation/history-light-1180.png)、[960 浅色](../../.impeccable/review/p1-observation/history-light-960.png)、[1180 深色](../../.impeccable/review/p1-observation/history-dark-1180.png)、[960 深色](../../.impeccable/review/p1-observation/history-dark-960.png)。 |
| 维护记录 | 执行完成／核对未完成分别显示，点击关联快照选择正确前后记录。见 [维护详情](../../.impeccable/review/p1-observation/maintenance-dark-960.png)。 |
| 不完整与失败 | 不完整清单阻止条目差异结论；读取失败保留已有内容并提示重试。见 [不完整清单](../../.impeccable/review/p1-observation/partial-light-960.png)、[历史读取失败](../../.impeccable/review/p1-observation/history-error-light-960.png)、[诊断读取失败](../../.impeccable/review/p1-observation/environment-error-dark-1180.png)。 |
| 独立保存提示 | 两个管理器保存失败时同时保留提示；让 pnpm 保存恢复后，浏览器文本中仅剩 npm 的未保存提示，扫描结果仍为就绪。见 [多个管理器归档失败](../../.impeccable/review/p1-observation/archive-errors-light-960.png)。 |

补充交互还确认了诊断候选「复制路径」将 `/opt/homebrew/bin/pnpm` 交给剪贴板 IPC，相关管理器入口切换至 pnpm。末轮补充截图时 agent-browser 曾出现 daemon 忙／无响应；重开隔离浏览器后取得有效失败提示截图。未生成的截图不计入证据。

## 交付边界

- 历史只用于只读复核，不恢复为当前观察、不授权维护、不提供撤销。
- 维护日志只覆盖管理器缓存清理及 npm／pnpm 全局包卸载；项目清理、会话记录与代理扩展维护不包含在内。
- 浏览器交互验证与 Rust 临时目录测试共同覆盖界面和持久化逻辑，未进行真实用户目录上的破坏性维护演练。
- 本轮保留开始前已有的 `package.json`、`pnpm-lock.yaml`、`src-tauri/Cargo.toml` 和 `codex_hook_definitions.rs` 修改；仅为后者的测试补齐显式路径类型导入。
- 独立[界面收尾审查](FINISH-REVIEW.md)判定 `ship`，覆盖 18 张截图；[设计文档核对](DESIGN-REVIEW.md)确认沿用既有设计系统，未引入新漂移。
