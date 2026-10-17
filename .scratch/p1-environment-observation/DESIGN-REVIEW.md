# P1 设计文档核对

日期：2026-10-17。

结果：设计系统 **No changes**；本次文档核对完成。实现延续既有界面身份，未引入需要更新全局设计规范的视觉漂移。[收尾审查](FINISH-REVIEW.md) 的判定为 `ship`。

## 范围与规范状态

本轮是 macOS Tauri WebView 内搜索、应用 PATH 诊断、历史快照及维护记录的普通功能扩展。[方向合同](../../.impeccable/surfaces/src-components-observationtools-tsx.md) 明确继承蓝灰桌面外壳、Outfit、JetBrains Mono、Phosphor 与既有控件，没有批准替换视觉世界或修改持久设计系统。

根目录 `DESIGN.md` 与 `.impeccable/design.json` 在工作区及当前 `HEAD` 中均不存在。这是先存的设计文档空缺，本轮仅记录，不创建新系统、色板、令牌或组件规范。按 documenter 对普通扩展的约束，完成核对不以生成这两个文件为前提。

## 已核对的实现

读取了 [全局样式](../../src/styles.css)、[搜索](../../src/components/GlobalSearch.tsx)、[观察工具](../../src/components/ObservationTools.tsx)、[应用接入](../../src/App.tsx)、[外壳](../../src/components/Shell.tsx)、[包表格](../../src/components/PackageTable.tsx)、[路径面板](../../src/components/PathPanel.tsx)，以及 `components/ui/` 中的 Button、Input、Tabs、Dialog、Alert。对照了本轮样式及接入差异、[PRODUCT.md](../../PRODUCT.md)、方向合同、收尾审查和[验证记录](VERIFICATION.md)。

| 项目 | 实现依据与结论 |
| --- | --- |
| 配色与主题 | 新区域使用既有 background、card、muted、accent、border、ring 与 selection 语义颜色。明暗主题均延续蓝灰底色；未增加颜色令牌或独立色板。 |
| 字体与层级 | 界面继承 Outfit 字体栈及中文回退；命令和路径使用 JetBrains Mono。新面板标题为 18px，对话框标题为 16px，主体与结果标题为 14px，辅助信息与路径为 12px；没有新增字体或显示字样式。 |
| 外壳与布局 | 沿用 58px 顶栏、196px 侧栏和主内容内部滚动。搜索位于主题按钮之前；概览、环境诊断和历史使用既有页签。紧凑工具栏、全宽分隔行、可展开详情与既有桌面密度一致。 |
| 控件与形状 | Button、Input、Tabs、Dialog 和 Alert 均复用既有组件。原生 select 与 details 延续其他管理页已有做法，使用共享主题和焦点颜色；无需新增组件体系。按钮及输入框的 6px 圆角、对话框的 12px 圆角未改变。 |
| 深度与图标 | 新结果以边框、表面色和选中色建立层级；没有增加阴影、材质、插图或装饰动效。搜索图标来自现有 Phosphor 包；既有外壳渐变与轻阴影保持原状。 |
| 定位反馈 | 样式表唯一新增规则为 `.observation-located`，使用既有 ring 和 selection；App 在定位后聚焦具体对象并在 1800ms 后移除短暂强调。包身份标记及路径定位面板服务于搜索反馈，不改变全局设计令牌。 |

五行系统摘要（描述已实现规则，不新增规范）：

1. 配色：蓝灰双主题；浅色背景／主色为 `#e7eef8`／`#2f62e4`，深色为 `#101722`／`#9db7ff`。
2. 字体层级：Outfit 界面与 JetBrains Mono 命令／路径，新增区域使用 18／16／14／12px 的既有层级。
3. 共享控件规则：沿用既有 Radix 页签和对话框、按钮及输入组件，原生选择与展开控件复用主题状态。
4. 桌面密度规则：固定外壳、内部滚动、紧凑工具栏和全宽结果行；详情按需展开。
5. 对象反馈规则：以选中、焦点和共享主题高亮标识实际定位对象，保留来源、时间与完整性说明。

## 浏览器证据与来源

首轮逐一打开了 [p1-observation](../../.impeccable/review/p1-observation/) 下的 18 张基础 PNG，并核验文件尺寸。搜索、环境诊断和快照对比各包含以下完整矩阵；截图内容和主题符合文件名，未见水平截断，底部内容由桌面内部滚动承载。

| 场景 | 浅色 1180×760 | 深色 1180×760 | 浅色 960×620 | 深色 960×620 |
| --- | --- | --- | --- | --- |
| 搜索 | `search-light-1180.png` | `search-dark-1180.png` | `search-light-960.png` | `search-dark-960.png` |
| 环境诊断 | `environment-light-1180.png` | `environment-dark-1180.png` | `environment-light-960.png` | `environment-dark-960.png` |
| 快照对比 | `history-light-1180.png` | `history-dark-1180.png` | `history-light-960.png` | `history-dark-960.png` |

另核对包与路径定位的 `package-light-1180.png`、`path-light-1180.png`，以及 `maintenance-dark-960.png`、`partial-light-960.png`、`history-error-light-960.png`、`environment-error-dark-1180.png`。这些证据显示具体 Node 版本与目录的定位、执行／核对结果分离、不完整清单阻止差异结论，以及失败提示下保留此前内容。

截图由父线程使用 agent-browser 从真实 App 的[隔离验证入口](browser-review.html)捕获；[验证夹具](browser-fixture.js)提供包、路径、快照和维护结果并拦截本机 IPC。它们仅是界面验证证据，不是本机真实扫描或维护成效。本轮没有新增用于产品交付的位图资产，既有代码内 SVG 保持原状。本次文档核对未重新运行浏览器交互、自动化测试或 Rust 后端；相关执行结果以验证记录为准。

## 未归入规范或修复的事项

先存的 `DESIGN.md`／sidecar 缺失未在普通扩展中补建。既有侧栏装饰口号使用 Iowan Old Style／Palatino／Georgia 系统衬线显示字，与 documenter 的 craft-floor 系统显示字体禁项冲突；本轮没有新增或扩散这一做法，也不将其提取为后续界面应继承的规则。没有发现本次扩展新增的设计系统漂移；未修改上述既有负债或其他实现。

## 补充核对：归档警告按来源保留

后续修复仅调整 [managerMaintenanceWorkflow.ts](../../src/managerMaintenanceWorkflow.ts) 的警告聚合：某个管理器保存成功，只清除它自己的归档警告，不清除其他来源尚未解决的警告。组件、CSS 和令牌未变，设计系统仍为 **No changes**；[收尾审查](FINISH-REVIEW.md) 的补充判定为 `resolved / clear`、`ship`。

已打开并核验补充截图 [archive-errors-light-960.png](../../.impeccable/review/p1-observation/archive-errors-light-960.png)（浅色，960×620）：npm 与 pnpm 两条归档失败提示共同显示在既有顶部 Alert 内，文字正常换行，五个管理器的扫描仍显示就绪，没有遮挡操作或引入视觉漂移。截图沿用隔离验证来源。父线程报告 291 个前端测试及生产构建通过，本次未重跑。

证据范围为前述 18 张基础截图，加这一张浅色归档警告截图；基础矩阵保持原审查范围。未生成深色恢复态补充截图，不将该状态列为本次视觉复核证据。未新增或改写任何全局设计规则，前述未归入规范事项不变。
