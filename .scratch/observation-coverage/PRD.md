# 观察覆盖度与新近度总览

Status: ready-for-agent

## 目标与范围

把分散在管理器、环境诊断、项目扫描、VS Code、会话和代理扩展中的观察状态集中到一个只读页签，回答：哪些观察项已启用但未观察、读取失败、不完整、不可用、已失效或范围已变化；何时成功观察过、尝试过什么；下一步是查看、刷新还是调整范围。它陈述观察事实，不表示某处没有内容，不构成维护授权。

- 健康页新增第三个页签「观察覆盖度」；概览页移除管理器状态列表，替换为一句覆盖度摘要和入口，三张统计卡保持不变。
- 共 25 个观察项：12 个管理器、环境诊断、项目派生数据扫描、VS Code 工作区存储、3 个会话来源、4 个 Codex 观察项、3 个 Claude Code 观察项。
- 跨重启保留观察元数据台账；不持久化包清单、扫描结果、会话内容、技能定义或文件内容。
- 只读：只提供查看、刷新、调整范围入口；不执行维护、不轮询、不自动读取来源、不提供全局刷新。
- 现有来源页的读取、维护和展示语义不变；本功能只增加台账记录、范围描述和覆盖度视图。

不纳入：维护历史、历史快照、设置、全局搜索。已保存的扫描根目录预设不是独立观察项。代理扩展维护、目录占用测量、写入资格、编辑器运行状态和使用中状态不是观察项状态，也不进入「需注意」。

设计依据：[ADR-0028](../../docs/adr/0028-observation-coverage-uses-metadata-ledger.md)；关联 [ADR-0027](../../docs/adr/0027-cross-domain-maintenance-history-shares-envelope-not-policy.md)（跨领域共享外壳、不共享策略）。

## 已确认决策

用户于 2026-10-23 分四轮确认以下决策。

### 产品与信息架构

- 中立的覆盖清单，不做关注事项队列、健康评分或覆盖率百分比。
- 新页签位于健康页，顺序为「概览 / 环境诊断 / 观察覆盖度」；概览页的三张统计卡保持不变。
- 固定领域顺序：管理器、环境诊断、项目派生数据、VS Code、会话记录、Codex、Claude Code。
- 管理器组默认展开，并分为「已启用 / 已停用」两个子组；Codex 与 Claude Code 默认折叠，组标题显示组内需注意数量；其余组默认展开。
- 不做搜索或筛选；空台账时仍显示完整覆盖地图。
- 观察项按「可独立启用、读取、失效和复核的一次读取」切分。Codex 的市场、插件、Hooks、Skills 是四次独立读取，因此 Codex 有 4 项；Claude 的市场与插件由 `scan_claude_extensions` 一次读取，因此 Claude Code 有 3 项。

### 状态与语义

- 状态由正交事实构成：资格／可用性、观察结果、完整性和新近度。界面使用一个主徽章加一行支撑事实，不压成单一枚举。
- 一次读取完成并产生可查看结果即「已观察」，包括目录不存在、清单不支持、功能开关关闭；有已知缺口为「部分」；完全无法产生结果为「失败」或「不可用」。
- 失败尝试不覆盖上次成功。管理器维护和项目清理不新增统一失效规则；只有来源已有的显式失效才写观察失效。
- 范围变化时，旧观察对旧范围仍然有效，但当前范围计为未观察并进入「需注意」。
- 「不支持清单」「功能开关关闭」「目录不存在」「写入受限」「编辑器运行中」「记录使用中」是已知边界，不是需注意状态，也不改变观察覆盖度。

### 新近度与持久化

- 记录上次成功观察完成时间、上次尝试时间与结果、显式失效；不使用固定小时或天数阈值，不显示「过期」。
- 台账分别记录成功与尝试各自的范围；失败的新范围尝试不能覆盖旧范围的成功。
- 管理器观察时间在扫描与补充测量完成后记录；任何成功的补充测量或重试推进时间，失败不推进。
- 重启后只有台账、没有内存数据时，主徽章显示「上次观察」，支撑行注明「本次会话尚未读取」；只有当前会话读取成功才显示「已观察」。
- 台账由 Rust 拥有，单文件、每个观察项只保留最新一条、原子写入、损坏时保留文件并提示、写入失败不改变观察结果。

### 交互

- 每行「查看」进入来源页。环境、VS Code、三个会话来源、Codex／Claude 清单提供原地逐项刷新；管理器保留组级「扫描已启用管理器」；项目扫描只提供「查看／调整范围」；没有全局刷新。
- Codex／Claude 的逐项刷新使用直接的单项读取入口，不依赖只读取当前可见清单的 `refresh()`。
- 管理器提供「设置」入口（启停），项目扫描提供「调整范围」入口；其他来源范围固定或由外部配置决定。
- 覆盖度页不执行维护，不自动读取任何来源。台账与范围描述在应用启动时加载；打开页签只使用已加载的本地元数据和内存状态，不调用任何命令。

### 计数与文案

- 按状态计数，不用百分比，不显示条目数，不显示全局「最后更新时间」。
- 「需注意」只包括已启用且未观察、失败、部分、不可用、已失效或范围变化的观察项；不包括已停用、不支持清单、功能开关关闭、目录不存在等已知边界。
- 管理器组显示「已观察 X / 已启用 Y」；其他领域不合并成一个分母。
- 界面使用「观察项」，不把这里的行叫「观察来源」。

## 观察项目录

观察项 ID 是稳定的内部标识；显示名使用界面语言。范围标识用于比较，范围标签用于展示。

| 组 | ID | 显示名 | 读取来源 | 范围 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 管理器 | `manager:npm` | npm | `ManagerSnapshot` + `ManagerScanState` | `scopeKey`（不展示原值） | 清单、路径、占用与诊断 |
| 管理器 | `manager:pnpm` | pnpm | 同上 | 同上 | 同上；store 与 cache 分别观察 |
| 管理器 | `manager:yarn` | Yarn | 同上 | 同上 | Yarn 2+ 清单可能不支持 |
| 管理器 | `manager:nvm` | nvm | 同上 | 同上 | 运行时版本，不是全局包清单 |
| 管理器 | `manager:homebrew` | Homebrew | 同上 | 同上 | 含清理预演等补充 |
| 管理器 | `manager:maven` | Maven | 同上 | 同上 | 本地仓库观察 |
| 管理器 | `manager:pip` | pip | 同上 | 同上 | 含更新检查补充 |
| 管理器 | `manager:cargo` | Cargo | 同上 | 同上 | 清单与路径 |
| 管理器 | `manager:docker` | Docker | 同上 | 同上 | 端点变化时范围可能不可核实 |
| 管理器 | `manager:bun` | Bun | 同上 | 同上 | 清单与路径 |
| 管理器 | `manager:uv` | uv | 同上 | 同上 | 清单与路径 |
| 管理器 | `manager:fvm` | FVM | 同上 | 同上 | Flutter 版本列表 |
| 环境诊断 | `environment` | 环境诊断 | `EnvironmentInspection` | PATH 摘要 + 已启用管理器 | 命令候选、缺失与重复 |
| 项目派生数据 | `project-scan` | 项目派生数据扫描 | `ProjectDataScan` + 扫描设置 | `rootId + rootPath + maxDepth` | 只代表当前根目录与深度；预设不是观察项 |
| VS Code | `vscode-storage` | VS Code 工作区存储 | `VscodeStorageScan` | `storagePath` | 工作区记录与环境存储 |
| 会话记录 | `session:codex` | Codex 会话记录 | `SessionSourceScan`（codex） | 来源目录 | 读取、搜索、移除的来源 |
| 会话记录 | `session:claude` | Claude 会话记录 | `SessionSourceScan`（claude） | 来源目录 | 同上 |
| 会话记录 | `session:opencode` | OpenCode 会话记录 | `OpenCodeSessionScan` | 已登记的 OpenCode 服务（无稳定身份时未知） | 连接本地服务读取 |
| Codex | `codex:marketplaces` | Codex 市场 | `scan_codex_marketplaces` | Codex home + config path | 与插件独立读取 |
| Codex | `codex:plugins` | Codex 插件 | `scan_codex_plugins` | 同上 | 与市场独立读取 |
| Codex | `codex:hooks` | Codex Hooks | `scan_codex_hooks` | 同上 | 受总开关限制 |
| Codex | `codex:skills` | Codex Skills | `scan_codex_skills` | Codex home | 依赖插件与市场变化 |
| Claude Code | `claude:extensions` | Claude 市场与插件 | `scan_claude_extensions` | Claude 配置目录 | 市场与插件同一次读取 |
| Claude Code | `claude:hooks` | Claude Hooks | `scan_claude_hooks` | Claude 配置目录 + config path | 定义清单 |
| Claude Code | `claude:skills` | Claude Skills | `scan_claude_skills` | Claude 配置目录 | 依赖插件与市场变化 |

合计 25 项。历史、设置、全局搜索、维护记录和扫描预设不在此表。

## 状态模型

### 事实

每个观察项最多呈现以下正交事实；主徽章只表达当前最相关的一项，其余放在支撑行和来源页。

- **资格／可用性**：已启用、已停用、CLI 缺失、CLI 不兼容、服务未连接、范围未选择、清单不支持、功能开关关闭。
- **观察结果**：观察中、已观察、上次观察、部分、读取失败、不可用、已失效、范围已变化、未观察、已停用。
- **完整性**：完整、部分、未知。
- **新近度**：上次成功观察时间、上次尝试时间与结果、失效原因与时间、上次成功范围、当前范围。

### 主徽章优先级

从高到低：

1. 已停用的管理器：`已停用`。
2. 当前正在读取：`观察中`。
3. 有显式失效且没有当前范围的成功：`已失效`。
4. 当前范围已知、与上次成功范围不同，且当前范围没有成功：`范围已变化`。
5. 当前读取失败或不可用：`读取失败` / `不可用`；支撑行保留上次成功。
6. 当前读取成功：`已观察`；有已知缺口时为`部分`；带限制性说明时仍为`已观察`。
7. 只有台账中的成功记录：`上次观察`；完整性为部分时在支撑行注明。
8. 只有台账中的失败尝试且没有成功：`读取失败` / `不可用`。
9. 没有记录：`未观察`。

当前会话读取成功优先于台账；台账只在没有当前结果时提供「上次观察」。`读取失败` 和 `不可用` 的主徽章不因为存在上次成功而变成「已观察」。

### 来源映射

| 来源结果 | 主状态 | 完整性 | 说明 |
| --- | --- | --- | --- |
| 管理器 `Ready` | 已观察 | 完整 | 有路径测量跳过、权限错误或补充失败时为部分 |
| 管理器 `Partial` | 部分 | 部分 | 保留清单与失败原因 |
| 管理器 `Unsupported` | 已观察 | 按路径观察结果 | 备注「清单不可用」；路径与占用仍可观察 |
| 管理器 `Missing` | 不可用 | 未知 | 备注「CLI 缺失」；不推断没有安装内容 |
| 管理器 `Failed` 或扫描异常（`lastReadFailed == true`） | 读取失败 | 未知 | 保留上次成功时间 |
| 管理器成功但 `error` 非空且 `lastReadFailed == false` | 部分 | 部分 | 路径或补充测量有问题，不是整体读取失败 |
| 环境诊断成功 | 已观察 | 完整／部分 | PATH 条目有问题或命令状态 `unknown` 时为部分；命令缺失是事实，不是不完整 |
| 项目扫描 `ready` | 已观察 | 完整／部分 | 以 `ProjectDataScan.status` 为准 |
| 项目扫描 `stopped` | 部分 | 部分 | 已产生结果但未完成 |
| 项目扫描 `failed` | 读取失败 | 未知 | 保留上次成功 |
| 项目扫描未配置根目录 | 未观察 | 未知 | 备注「未选择扫描根目录」；`adjustScope=true`，不写台账 |
| VS Code `Ready` | 已观察 | 完整／部分 | 任一带 `usage.complete == false` 的工作区使完整性为部分 |
| VS Code `Partial` | 部分 | 部分 | — |
| VS Code `Missing` | 已观察 | 完整 | 备注「未找到目录」；这是已确认的缺失 |
| 会话 `Ready`／`Partial`／`Missing` | 已观察／部分／已观察 | 完整／部分／完整 | `Missing` 备注「未找到目录」；`Failed` 为读取失败 |
| OpenCode `ready`／`unavailable`／`failed` | 已观察／不可用／读取失败 | 完整／未知／未知 | `unavailable` 表示服务未连接 |
| Codex／Claude 原生清单 `Ready` | 已观察 | 完整／部分 | `warnings`、`messages` 或 `configError` 非空时为部分/失败 |
| Codex／Claude `MissingCli`／`Incompatible` | 不可用 | 未知 | 备注 CLI 缺失或不兼容 |
| Codex／Claude `Failed` | 读取失败 | 未知 | 保留上次成功 |
| Codex Hooks `featureEnabled == false` | 已观察 | 完整 | 备注「总开关关闭，无法枚举」；不计入需注意 |
| Claude Hooks 命令成功 | 已观察 | 完整／部分 | `messages` 非空为部分；`disableAllHooks` 是设置，不是缺口 |
| 显式失效 | 已失效 | 保持上次成功 | 失效原因持久化；重新读取成功清除 |
| 范围变化 | 范围已变化 | 未知 | 旧观察对旧范围仍有效；当前范围计为未观察 |
| 已停用管理器 | 已停用 | 保持上次成功 | 不计入需注意 |

写入限制（例如 `writeBlockedReason`、`writeBlocked`）、编辑器运行状态、记录使用中、卸载/移除资格不是观察状态，不影响覆盖度。

### 需注意

已启用且满足任一条件：

- 未观察；
- 读取失败；
- 不可用；
- 部分；
- 已失效；
- 范围已变化。

不包含：已停用、不支持清单、功能开关关闭、目录不存在、写入受限、编辑器运行中、记录使用中、观察中、已观察、完整的上次观察。

只有台账且完整性为部分时，主徽章仍显示「上次观察」，但支撑行注明部分，并计入需注意和部分计数。

### 范围变化

范围标识和范围标签：

- 管理器：`ManagerSnapshot.scopeKey`。原值不展示；成功观察记录其值，范围不可核实时备注「范围不可核实」。管理器范围变化只能由新的扫描结果确定；未重新扫描时不猜测。
- 环境诊断：PATH 条目摘要 + 排序后的已启用管理器 ID。`inspect_environment` 返回 `scopeKey`，范围描述命令用同一算法返回当前值。
- 项目扫描：`rootId + rootPath + maxDepth`。当前值来自扫描设置，无需读取即可比较。
- VS Code：`VscodeStorageScan.storagePath`。范围描述命令解析当前 workspaceStorage 路径；扫描结果优先。
- 会话：Codex／Claude 使用 `SessionSourceScan.directory`；OpenCode 没有稳定服务身份，未连接时范围未知。
- Codex：市场、插件、Hooks 使用 Codex home + config path；Skills 使用 Codex home；四项共享 home，范围变化按各自结果判断。
- Claude Code：扩展与 Skills 使用 Claude 配置目录；Hooks 使用配置目录 + config path；三项共享配置目录，范围变化按各自结果判断。

范围描述命令只解析 home、配置路径、VS Code 存储路径和 PATH 摘要，不读取清单、会话、技能、包或文件内容。管理器与 OpenCode 没有无需读取即可确定的范围，因此不主动检测范围变化。

范围变化只在当前范围已知、与上次成功范围不同、且当前范围没有成功时显示。若当前范围未知，只展示上次观察范围，不推断变化。

## 观察台账与范围描述

### 存储

- 文件：`app_data_dir()/observation-ledger.json`，文档 `{ version: 1, items: ObservationRecord[] }`。
- 每个观察项只保留最新一条记录；不保留观察历史。
- 写入使用临时文件、`flush`、`sync_all`、原子替换；进程内互斥。
- 文件损坏或版本高于 1 时保留原文件、返回读取警告、不得覆盖；后续写入暂停。
- 写入失败返回警告，不改变观察结果；前端在覆盖度页显示非阻塞提示。
- 台账只保存元数据：不保存包清单、扫描结果、会话标题或正文、技能定义、stdout/stderr、环境变量或文件内容。
- 字符串截断：范围 500 字符、范围标签 300 字符、备注/原因 500 字符。

### 命令

- `load_observation_ledger()` → `{ records: ObservationRecord[], warnings: string[] }`。
- `record_observation(event: ObservationEvent)` → `{ warning: string | null }`。
  - Rust 校验 `itemId` 在固定 25 项允许列表中，拒绝未知项和未知事件类型。
  - 事件时间使用前端完成读取时的时间；拒绝非有限或负值。
  - 读-改-写保留同一版本中未知 ID 的记录，避免未来增加来源时丢失数据。
- `load_observation_scopes(enabledManagers)` → `Record<ObservationItemId, ObservationScope | null>`。
  - 只返回当前范围描述，不写入台账、不读取来源内容。
  - 管理器与 OpenCode 返回 `null`；项目扫描范围由前端设置提供。
  - 环境诊断范围使用与 `inspect_environment` 相同的 PATH 摘要算法和已启用管理器集合。

### 类型

```ts
type ObservationCompleteness = "complete" | "partial" | "unknown";
type ObservationAttemptOutcome = "succeeded" | "failed" | "unavailable";

type ObservationItemId =
  | "manager:npm" | "manager:pnpm" | "manager:yarn" | "manager:nvm"
  | "manager:homebrew" | "manager:maven" | "manager:pip" | "manager:cargo"
  | "manager:docker" | "manager:bun" | "manager:uv" | "manager:fvm"
  | "environment" | "project-scan" | "vscode-storage"
  | "session:codex" | "session:claude" | "session:opencode"
  | "codex:marketplaces" | "codex:plugins" | "codex:hooks" | "codex:skills"
  | "claude:extensions" | "claude:hooks" | "claude:skills";

interface ObservationScope {
  key: string;
  label: string;
}

interface ObservationRecord {
  itemId: ObservationItemId;
  lastSuccess: {
    at: number;
    scope: string | null;
    scopeLabel: string | null;
    completeness: ObservationCompleteness;
    note: string | null;
  } | null;
  lastAttempt: {
    at: number;
    outcome: ObservationAttemptOutcome;
    scope: string | null;
    reason: string | null;
  } | null;
  invalidated: { at: number; reason: string } | null;
}

type ObservationEvent =
  | { kind: "success"; itemId: ObservationItemId; at: number; scope: string | null; scopeLabel: string | null; completeness: ObservationCompleteness; note: string | null }
  | { kind: "attempt"; itemId: ObservationItemId; at: number; outcome: "failed" | "unavailable"; scope: string | null; reason: string }
  | { kind: "invalidate"; itemId: ObservationItemId; at: number; reason: string };
```

成功事件写 `lastSuccess`，同时把 `lastAttempt` 写为 `succeeded` 并清除 `invalidated`。失败/不可用事件只写 `lastAttempt`，保留 `lastSuccess` 和 `invalidated`。失效事件只写 `invalidated`，保留成功与尝试。没有成功、没有尝试且没有失效的观察项不写记录。

### 写入点

- **管理器**：主扫描与初始补充测量完成后写入成功；任何成功的补充测量或重试完成后更新成功时间与完整性；整体扫描失败写入失败尝试。补充重试失败不写整体失败尝试，也不新增台账事件；当前会话的覆盖度按部分反映，管理器页保留补充错误；重启后保留上次成功观察的完整性与时间。
- **环境诊断**：`inspect_environment` 成功后以 `capturedAt` 写入成功；命令异常写入失败尝试。
- **项目扫描**：`ready` 或 `stopped` 写入成功；`failed` 写入失败尝试。
- **VS Code**：`Ready` / `Partial` / `Missing` 写入成功；读取异常写入失败尝试。
- **会话记录**：每个来源独立写入 `session:codex`、`session:claude`、`session:opencode`；`Ready` / `Partial` / `Missing` / `ready` 为成功，`unavailable` 为不可用，`Failed` / `failed` 为失败尝试。
- **Codex／Claude 原生清单**：每次被接受的读取完成后写入成功或失败；被失效或并发读取取代的结果不写成功。`useNativeInventory` 与 `useSkillInventory` 只在 `observed === epoch` 的最终结果上记录。
- **显式失效**：`useNativeInventory.invalidate`、`useSkillInventory` 的依赖变化、Codex／Claude 维护后的依赖失效写入失效事件。首次挂载和 adapter 身份初始化不写失效；只有已有观察或已有扫描结果时记录。
- **管理器维护与项目清理**：不新增统一失效规则。管理器维护的后续读取成功/失败按普通读取写入；项目清理不改变扫描观察时间。

### 管理器时间

把 `ManagerScanState.scannedAt` 的写入点从快照安装后移到主扫描与初始补充测量完成后；管理器页和覆盖度页的「数据时间」文案统一为「观察时间」。只有 `Ready`、`Partial` 或 `Unsupported` 的成功扫描推进该时间；`Missing` 与 `Failed` 不推进。成功补充测量或重试更新该时间；失败不更新。这样覆盖度页、管理器页和台账使用同一个成功观察时间，不再出现「清单时间早于占用时间」的歧义。

`ManagerScanState` 增加 `lastReadFailed: boolean`：

- `readFull` 开始读取时设为 `false`；
- 扫描返回 `Failed`（无论是否保留旧快照）或扫描命令抛出异常时设为 `true`；
- 扫描成功（即使路径或补充测量有问题）保持 `false`；
- `Missing` 不是整体失败，保持 `false`，由状态映射为不可用；
- `retrySupplement` 不改变它。

`error` 仍保存问题摘要，可能在一次成功但有补充问题的扫描后非空。覆盖度模型必须用 `lastReadFailed` 判断整体读取失败；`error` 非空但 `lastReadFailed === false` 表示部分，而不是读取失败。管理器页的状态文案也使用该标志：整体失败显示「最近扫描失败」，成功但有问题显示「扫描完成，部分信息未读取」。

## 覆盖度聚合与计数

### 输入

`buildObservationCoverage` 接收：

- 台账记录与读取警告；
- 25 项目录；
- 各来源当前内存状态（管理器、环境诊断、项目扫描、VS Code、三个会话来源、Codex／Claude 清单与 Skills）；
- 当前已启用管理器；
- 当前范围描述（`load_observation_scopes` 的结果）；
- 项目扫描设置中的根目录与深度。

它不读取任何来源，也不写台账。纯函数便于 fixture 与单元测试。项目扫描、VS Code、会话和代理扩展没有自身时间戳时，使用台账中的成功时间；两者都没有时不显示观察时间，不用渲染时刻代替。

### 输出

```ts
type CoverageStatus =
  | "disabled" | "inProgress" | "invalidated" | "scopeChanged"
  | "failed" | "unavailable" | "observed" | "partial"
  | "lastObserved" | "notObserved";

interface ObservationCoverageItem {
  id: ObservationItemId;
  group: "managers" | "environment" | "project" | "vscode" | "sessions" | "codex" | "claude";
  label: string;
  status: CoverageStatus;
  completeness: ObservationCompleteness;
  note: string | null;
  lastSuccessAt: number | null;
  lastSuccessScopeLabel: string | null;
  lastAttemptAt: number | null;
  lastAttemptOutcome: ObservationAttemptOutcome | null;
  lastAttemptReason: string | null;
  invalidatedAt: number | null;
  invalidatedReason: string | null;
  currentScopeLabel: string | null;
  scopeChanged: boolean;
  attention: boolean;
  actions: { view: boolean; refresh: boolean; adjustScope: boolean };
}
```

`CoverageStatus` 为上文主徽章状态。组标题由分组后的项目和计数生成；管理器组额外返回「已观察 / 已启用」计数。

### 计数

每个观察项只计一次，按主徽章状态汇总：

- `observed`、`lastObserved` 与 `partial` 合并为「已观察」；`partial` 是其中的完整性子集，不单独消耗一次计数；
- `partialCount` 统计完整性为部分的成功观察（含当前读取和只有台账的上次观察）；
- `failed`、`unavailable`、`invalidated`、`scopeChanged`、`notObserved`、`disabled` 分别计数；
- `inProgress` 单独计数，不计入需注意；
- `attentionCount` 为需注意项数量；
- 管理器组的「已观察 X / 已启用 Y」中，X 只统计已启用且至少有一次成功读数（observed、lastObserved 或 partial）的管理器，Y 为已启用管理器数；已停用管理器单独计数。X 与需注意数量可以重叠（部分成功既已观察也需注意）。

不显示百分比、包数量或全局最后更新时间。概览摘要只显示已观察总数（含部分）、需注意总数、未观察/部分/失败的分解（有则显示）和已停用管理器数量。

## 页面与交互

### 观察覆盖度页

页签位于健康页第三个位置。顶部说明：「这里陈述哪些来源已观察、何时观察、读取是否完整。未观察不代表没有内容。」

- 汇总条：按主徽章状态计数；不显示百分比；不显示全局时间。
- 分组卡片按固定顺序排列：
  1. 管理器（已启用／已停用两个子组，默认展开）；
  2. 环境诊断（默认展开）；
  3. 项目派生数据（默认展开）；
  4. VS Code 工作区存储（默认展开）；
  5. 会话记录（默认展开，三项逐行）；
  6. Codex（默认折叠，组头显示需注意数）；
  7. Claude Code（默认折叠，组头显示需注意数）。
- 折叠使用可键盘操作的 disclosure；折叠组内有需注意项时只在组头显示数量，不自动展开。

### 行

每行显示：

- 名称与主徽章；
- 支撑行 1：`观察于 <精确时间>（<相对时间>）`、`上次观察于 …`、`最近尝试于 …`，按状态选择；
- 支撑行 2：范围标签、完整性说明、限制或失败原因；重启后只有台账时附加「本次会话尚未读取」；
- 当前范围与上次范围不同时显示「范围已变化：上次 …；当前 …」；
- 失败但有上次成功时显示「上次成功：…」；
- 操作按钮：`查看` 始终可用；`刷新` 仅在来源支持逐项刷新时出现；管理器显示 `设置`（含已停用），项目扫描显示 `调整范围`，其他来源不显示范围按钮。

不显示包数量、会话数量、工作区数量或目录占用；这些属于来源页，覆盖度页只陈述观察事实。

### 操作

- **查看**：管理器行选择管理器并进入管理器页；环境诊断切到健康页环境诊断页签；项目扫描进入项目清理；VS Code、会话、Codex、Claude 进入对应页面与页签。
- **刷新**：
  - 管理器组头：`扫描已启用管理器`，执行现有批量扫描；已停用管理器不扫描。
  - 环境诊断：调用现有环境读取；不切换页签。
  - VS Code：调用现有刷新。
  - 会话记录：按来源逐项刷新 Codex、Claude、OpenCode；不刷新未点击的来源。
  - Codex：为市场、插件、Hooks、Skills 暴露直接的单项读取入口；不依赖只读取当前可见清单的组合刷新。
  - Claude Code：使用现有按页签刷新能力读取市场／插件、Hooks、Skills。
  - 项目扫描：不提供刷新；只有查看／调整范围。
- 刷新期间该行或组显示读取中并禁用重复操作；维护操作进行中时禁用所有刷新。
- 没有全局刷新，没有轮询，没有后台自动读取。
- 打开覆盖度页不调用任何命令；只使用应用启动时加载的台账、范围描述和内存状态。

### 概览页

- 移除现有「管理器状态」卡片列表。
- 新增「观察覆盖度」摘要卡：已观察数量（含部分）、需注意数量、未观察/部分/失败的简要分解、已停用管理器数量，以及「查看观察覆盖度」入口。
- 保留现有三张统计卡：已扫描／已启用管理器、包与资源条目、未扫描管理器。
- 保留「扫描已启用管理器」按钮；概览页不显示全局观察时间，也不复制覆盖度页的行列表。
- 现有健康信号和目录占用 Top 5 不变。

### 空状态、错误与可访问性

- 空台账：仍显示完整 25 项地图，顶部提示「尚未读取任何来源；进入来源页或使用刷新开始观察」。
- 台账读取失败：显示警告，覆盖度仍可从当前内存状态生成；台账写入失败显示非阻塞提示，不改变来源结果。
- 来源读取失败：行内显示失败原因摘要，完整错误留在来源页。
- 分组标题、折叠按钮、徽章和操作按钮使用语义化标签；主徽章文本不依赖颜色。

## 非目标

- 不执行维护、清理、卸载、移除或写入。
- 不提供全局刷新、自动轮询、后台刷新或推送。
- 不提供覆盖率百分比、健康评分、关注事项队列或跨领域优先级排序。
- 不持久化扫描内容、包清单、会话正文、技能定义或文件内容。
- 不保存观察历史；每个观察项只保留最新一条台账记录。
- 不提供搜索、筛选、导出、清空或手动编辑台账。
- 不新增删除/清理/核对策略，不改变任何来源的资格和恢复边界。
- 不把「不支持清单」「功能开关关闭」「目录不存在」「写入受限」当作失败或需注意。
- 不主动检测无法不读取就确定的范围变化：管理器与 OpenCode 的范围只由新的读取结果确定。

## 验收场景

1. **首次启动／空台账**：至少一个管理器自动扫描；覆盖度页显示完整 25 项地图；未读取的来源是「未观察」而不是「0 条」；打开页签不调用任何命令；概览摘要与组内计数一致。
2. **成功与缺失语义**：管理器、环境诊断、项目扫描、VS Code、会话成功读取；目录不存在显示「已观察 · 未找到目录」；Yarn 2+ 显示「已观察 · 清单不可用」但保留路径／占用；Hooks 总开关关闭显示「已观察 · 受限」；PATH 中缺少命令是事实，不算读取失败。
3. **部分／失败／不可用**：部分读取推进成功时间并记录完整性；失败尝试保留上次成功并显示尝试时间与原因；CLI 缺失或 OpenCode 未连接显示「不可用」，不产生虚假的零数量。
4. **范围变化**：项目根目录／深度变化立即显示「范围已变化」；环境 PATH／已启用管理器、VS Code 存储路径、会话目录、Codex／Claude 配置目录变化在应用启动或已启用管理器变化后加载范围描述时显示；旧观察不标成失效，但对当前范围计为未观察并进入需注意。管理器与 OpenCode 的范围只在下一次读取返回时更新，不猜测。
5. **失效边界**：Codex／Claude 的显式依赖失效持久化到重新读取成功；首次挂载不产生失效；管理器维护和项目清理不新增统一失效规则；管理器后续读取成功／失败如实更新观察时间与尝试结果。
6. **重启与台账**：重启后仅台账的来源显示「上次观察」和「本次会话尚未读取」，进入来源页后按原逻辑读取；台账损坏时保留文件并提示，覆盖度页可用；台账写入失败只显示非阻塞提示，不影响观察结果。
7. **刷新与导航**：「查看」进入正确页面与页签；环境、VS Code、三个会话来源、Codex／Claude 支持原地逐项刷新；Codex／Claude 使用直接单项读取；管理器保留组级扫描；项目扫描只提供查看／调整范围；没有全局刷新，重复点击被禁用。
8. **停用、计数与边界**：已停用管理器进入子组、保留上次观察、不计入需注意；需注意只包括未观察、失败、部分、不可用、失效、范围变化；不显示百分比或全局最后更新时间；覆盖度页不执行维护、不轮询；台账只存元数据；界面使用「观察项」而非「观察来源」。

## 测试策略

- **Rust**：台账 schema 序列化往返；成功/尝试/失效事件；成功与尝试范围分离；最新一条；固定 ID 校验；未知 ID 保留；原子写；损坏/未来版本保护；并发写入；写入失败警告；范围描述命令不读取来源内容；环境范围算法与 `inspect_environment` 一致。
- **TypeScript 模型**：25 项目录；主徽章优先级；需注意定义；已停用；部分／失败／不可用；目录不存在；不支持清单；功能开关关闭；范围变化；只有台账的「上次观察」；计数与组标题；时间格式化；无全局时间。
- **Hook／工作流**：管理器完成时间在补充测量之后；补充重试更新；失败不覆盖上次成功；环境、项目、VS Code、会话、Codex／Claude 的单项记录；并发读取被取代时不得写成功；Codex／Claude 首次挂载不写失效；Skills 依赖变化写失效；项目根目录变化触发范围变化；逐项刷新不影响页面可见性。
- **UI**：覆盖度页签、分组折叠、行文案、操作回调、刷新中禁用、空台账、台账警告、概览摘要卡替换、三张统计卡保持、无全局刷新、无维护入口；打开页签不调用任何命令。
- **回归**：现有管理器页、环境诊断、项目清理、VS Code、会话、Codex、Claude 与历史页测试保持通过。
- **命令**：`pnpm test`、`pnpm build`、`cargo test`。

## Issues

建议实施顺序：01 → 06 → 02–05 → 07。01 提供台账与范围描述，06 提供共享状态语义；02–05 依赖两者写入各领域，07 最后接入页面。

- [01-add-observation-ledger-and-scope-descriptors.md](./issues/01-add-observation-ledger-and-scope-descriptors.md)
- [02-record-manager-observations.md](./issues/02-record-manager-observations.md)
- [03-record-environment-and-project-observations.md](./issues/03-record-environment-and-project-observations.md)
- [04-record-vscode-and-session-observations.md](./issues/04-record-vscode-and-session-observations.md)
- [05-record-codex-and-claude-observations.md](./issues/05-record-codex-and-claude-observations.md)
- [06-build-observation-coverage-model.md](./issues/06-build-observation-coverage-model.md)
- [07-build-observation-coverage-page.md](./issues/07-build-observation-coverage-page.md)

## 风险与验证点

- 台账写入可能发生在每次读取完成时；必须串行化，且不能阻塞来源结果或维护操作。批量扫描管理器时会产生多条小写入，需要验证不会明显拖慢扫描。
- 管理器 `scannedAt` 的写入点后移会影响现有管理器页与总览的时间含义；测试需覆盖补充测量、重试和失败路径。
- Codex／Claude 的现有组合刷新只读取可见清单；逐项刷新需要直接读取入口，并验证在覆盖度页保持可见性时也能更新状态。
- `useNativeInventory` 的并发读取与失效会使部分结果被丢弃；只有被接受的最终结果可以写成功，否则会出现「已观察但实际已失效」。
- 范围描述命令可能与扫描的路径解析逻辑漂移；必须复用同一解析函数或加一致性测试。管理器与 OpenCode 的范围无法不读取确定，界面不得猜测。
- 「上次观察」与「已观察」的区分必须贯穿徽章、计数和概览摘要，避免把台账元数据说成当前已加载数据。
- 打开覆盖度页不触发任何命令；测试需 mock 所有 Tauri 命令，确认页签打开不产生调用；台账与范围描述在应用启动时加载。
- 台账损坏、未来版本和写入失败必须分别提示，且不改变观察结果；与维护历史的文件保护策略保持一致。
- 25 项在窄窗口下可能较长；分组折叠和固定顺序优先于新增筛选或搜索。
