# Codex 市场与插件补全验证

日期：2026-10-15。本机 `codex-cli 0.162.1`。

## 已实现范围

- 官方 `plugin list --available --json` 清单及安装状态关联；市场分组内搜索、全部／已安装／未安装筛选。
- 按实际可读内容补充本地插件详情，包括 portable、Codex／Claude 兼容 manifest、技能、MCP 服务名和 Hooks 事件；根 OpenAI extension 替代兼容 overlay，不合并二者。
- 单项安装、重新安装、卸载及原有用户默认启停；重新安装明确会启用。命令采用结构化参数，执行前核实快照、身份、来源、安装策略与配置，执行后重读。
- Git ref、多个 sparse 路径、`owner/repo@ref` 与 `.claude-plugin/marketplace.json` 市场布局支持。
- Hooks 导航与维护后的清单失效；来源维护与插件操作独立。

## 自动化验证

- `pnpm build`：通过。Vite 提示单个产物超过 500 kB；本次未引入新的依赖。
- `pnpm test`：28 个测试文件、197 项测试通过。最后的确认文案调整后，插件测试 15 项再次通过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：167 项通过、4 项需本机 CLI 的测试默认忽略。
- 另外显式运行新增原生生命周期测试 `codex_plugins::tests::real_cli_plugin_lifecycle_in_temporary_home`：通过。涵盖应用后端安装、用户禁用后重新安装、卸载与真实清单重读，确认重新安装变回启用、卸载后原始源文件仍在。
- 上述原生生命周期测试在 macOS sandbox 中禁止网络、禁止专用临时目录之外写入，并拒绝读取真实 `.codex`／`.agents`。仅使用纯 skill fixture，无 MCP 或 Hooks 执行。
- 显式运行 `reads_real_codex_inventory_without_changing_user_config`：通过，真实清单读取前后用户配置字节内容一致。
- `git diff --check`：通过。

有意义的回归场景包括：未安装项不能误走启停、同名跨市场目标隔离、不可安装策略拒绝、嵌套配置或来源在确认后变化、未知／失败的命令返回不被当作成功、命令成功但重读失败、缺失组件不被显示为空清单，以及组件路径越界拒绝。

## 浏览器验证

使用 `agent-browser` 的独立会话与 [合成数据页面](browser-review.html)，不连接真实用户 Codex。原预览服务中断造成的旧页面截图已废弃；最终证据取自本任务启动的 `127.0.0.1:14202` 服务。

- 按 Tauri 实际默认窗口 1180×760 和最小窗口 960×620 检查，覆盖浅色、深色主题。
- 检查市场展开、完整详情、组件清单、安装确认、安装后的重读结果、禁用插件的重新安装提示和 Git 高级选项。
- 最小窗口下，市场表格 730 px、插件表格 714 px，均与各自容器宽度一致；页面宽度未超出视口。
- Codex 区域 axe 检查：0 个 violations，1 个 contrast incomplete。视口外／被遮挡内容使自动对比度检查不完整，不能据此声称完整 WCAG AA 合规。
- 截图前暂停页面动画及平滑滚动以避免过渡帧；不修改产品中的动效。

当前截图位于 `.impeccable/review/codex-completion-*.png`：`desktop-light`、`desktop-dark`、`minimum-dark`、`details`、`components`、`reinstall-dialog`、`advanced`。详情、组件和高级选项是应用内部滚动后的补充证据。

## 覆盖边界

- 未执行完整原生 Tauri WebView 到 CLI 的端到端测试；构建、React 交互和 Rust 原生命令分别验证。
- 原生生命周期实验是单版本、本地纯 skill 来源，未覆盖真实 Git/npm 下载、认证、插件数据、凭据或 Hooks 信任记录的卸载行为。
- 清单中的实际版本用于定位已安装元数据；若 CLI 提供安装路径则优先采用。按文档版本目录查找仅用于详情读取，不用于推断是否安装；不存在可读副本时可显示明确标记的本地来源详情。
- 市场同步可能连带同步多个已配置插件，沿用已有启用设置语义；重新安装会将选定插件启用。两者都不包装为保证取得上游最新版的单插件更新。远程源码不可读时明确展示未知，不自动下载或安装以获得预览。

## 独立界面审阅

`impeccable_finish_reviewer` 返回 `disposition: ship`，没有需要修复的实质问题。审阅者逐张打开上述 7 张截图，并核对已确认 PRD、现有视觉约定及三个界面实现文件；搜索与筛选、详情、组件声明、重新安装确认和 Git 高级选项均在审阅范围内。

该结论仅覆盖提供的桌面尺寸与新增界面能力；审阅者未重新执行自动化测试或原生 CLI，也未声称完整 WCAG AA 合规。

## 文档收尾

独立文档检查已完成，README、PRODUCT 和两个页面约定已按实现更新。沿用现有视觉系统；未创建全局 DESIGN.md 或 sidecar。原有全局设计文档缺口、README 的个人自用定位与历史测试数量属于本次范围之外的既存差异，未连带修改。最终 `git diff --check` 通过，本任务的独立浏览器及预览服务已关闭。
