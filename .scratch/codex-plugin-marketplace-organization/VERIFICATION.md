# 按市场管理已安装 Codex 插件：验收记录

日期：2026-10-15。需求：[PRD](PRD.md)。

## 已交付

- Codex 默认进入「插件市场」，同级保留「Hooks」，取消独立的已安装插件页签。
- 展开市场行即可查看其已安装插件、来源详情，并按原流程确认单项启停；没有已安装插件的市场仍展示。
- 未匹配市场清单的插件按原市场名分组，标注「未出现在市场清单中」，不提供该分组的市场源维护操作。
- 市场与插件的读取结果、错误和维护资格各自保留；市场只读不额外限制符合资格的插件启停。读取失败不误报为空，旧数据明确标记过期。
- 市场添加、刷新、移除和插件保存沿用既有后端、确认及失效规则；统一重新读取两份清单，操作后更新分组，Hooks 入口与清单失效仍正常。

主要实现：[App 导航](../../src/App.tsx)、[市场页面](../../src/components/CodexMarketplacesPage.tsx)、[嵌入插件列表](../../src/components/CodexPluginList.tsx)、[Hooks 入口](../../src/components/CodexHooksPage.tsx)。原 `CodexPluginsPage` 提取为 `CodexPluginList`；未修改 Rust、IPC 类型或清单 hooks。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| 改动前相关组件测试 | 37 项通过 |
| 重组后原有相关测试 | 37 项通过 |
| 新增真实 App 组合测试 | 9 项通过 |
| 全量前端 `test` 脚本（`vitest run`） | 28 个文件、191 项通过 |
| 生产 `build` 脚本（`tsc && vite build`） | 通过；保留既有超过 500 KB 的 chunk 提示 |
| `git diff --check` | 通过 |

新增测试见 [CodexMarketplacePlugins.test.tsx](../../src/components/CodexMarketplacePlugins.test.tsx)：覆盖首次进入、两份清单组合、同名异市场插件、空市场与未匹配分组、只读市场的可写插件、两份清单分别失败、市场移除成功／部分完成／已执行但失败后的重新分组、过期结果，以及 Hooks 跳转、缓存与失效重读。

原有测试迁移到 [CodexPluginList.test.tsx](../../src/components/CodexPluginList.test.tsx)，继续覆盖明确身份、取消无写入、未知设置、只读状态、保存与后续读取失败分别反馈。后端未修改，本次未重跑 Rust 测试。

## 浏览器与界面验证

使用 agent-browser 隔离会话和合成 IPC 数据，不连接本机 Codex。开发阶段通过 [browser-review.html](browser-review.html) 加载真实 App；最终正常状态截图与无障碍检查使用生产构建的 JS/CSS，在隔离本地预览中运行，避免开发热更新影响捕获。状态与交互截图来自同一实现的开发预览。

| 场景 | 证据 |
| --- | --- |
| 最终生产页面，浅色 1180px、深色 960px、窄窗口 390px | [浅色](../../.impeccable/review/marketplace-plugins/production-light-1180.png)、[深色](../../.impeccable/review/marketplace-plugins/production-dark-960.png)、[窄窗口](../../.impeccable/review/marketplace-plugins/production-narrow-390.png) |
| 插件详情、未知默认设置、空市场与未匹配市场分组 | [详情](../../.impeccable/review/marketplace-plugins/plugin-details-1180.png)、[只读市场](../../.impeccable/review/marketplace-plugins/managed-1180.png)、[空市场](../../.impeccable/review/marketplace-plugins/empty-market-1180.png)、[未匹配分组](../../.impeccable/review/marketplace-plugins/unmatched-1180.png) |
| 单项启停确认及窄窗口操作 | [浅色确认](../../.impeccable/review/marketplace-plugins/confirm-light.png)、[窄窗口深色确认](../../.impeccable/review/marketplace-plugins/confirm-narrow-dark.png)、[局部滚动后的操作](../../.impeccable/review/marketplace-plugins/narrow-actions-390.png) |
| 市场读取失败、保存成功但插件重读失败 | [市场失败](../../.impeccable/review/marketplace-plugins/market-read-failed-1180.png)、[保存后重读失败](../../.impeccable/review/marketplace-plugins/saved-read-failed-1180.png) |
| 浅色／深色市场区域 axe 4.12.1 检查 | 各 23 passes、0 violations、0 incomplete：[浅色](../../.impeccable/review/marketplace-plugins/a11y-light.json)、[深色](../../.impeccable/review/marketplace-plugins/a11y-dark.json) |

[交互检查记录](../../.impeccable/review/marketplace-plugins/interaction-checks.json)确认：

- 取消或 Escape 后回到原插件按钮，未发生写入。
- 市场读取失败时，来源维护禁用，符合资格的插件启停仍可使用。
- 390px 窗口的文档宽度为 390px，表格在局部滚动。
- 保存后插件重读失败仅发出一次合成写入；旧插件操作禁用，焦点回到「重新读取」。

复现开发预览：启动 `pnpm dev`，访问 `http://localhost:14201/.scratch/codex-plugin-marketplace-organization/browser-review.html` 后进入 Codex。该页面明确标注合成数据，并通过 `window.codexReview` 控制清单与错误。

## 复核与边界

界面复核结果为 [ship](../../.impeccable/review/marketplace-plugins/finish-review.md)，限于本次页面、截图及合成交互证据。独立复核首次与一次重试均因模型服务限流失败，因此主代理按 impeccable 的降级流程完成替代复核；文档代理也因限流失败，已完成[替代文档复核](../../.impeccable/review/marketplace-plugins/documentation-review.md)。未将这些结果表述为独立审阅通过。

保留现有主题、组件与设计系统，没有新增插件安装、更新或卸载操作。本次未执行原生 Tauri 端到端测试，也未写入真实用户 Codex 配置；后端行为继续由既有实现和测试约束。
