Status: ready-for-agent

# 记录环境诊断与项目扫描观察

## Parent

.scratch/observation-coverage/PRD.md

## What to build

让环境诊断和项目派生数据扫描在读取完成后写入观察台账，并让环境范围与 issue 01 的范围描述命令使用同一算法。本 issue 不改变两类扫描的发现、候选或清理语义。

### 环境诊断

- 使用 issue 06 的 `environmentObservationFacts` 与 `projectObservationFacts` 派生完整性、备注和范围；本 issue 只负责在读取完成时写台账。
- 在 `EnvironmentInspection` 中增加 `scopeKey`：
  - 使用 issue 01 提供的公开函数，由规范化 PATH 条目摘要 + 排序后的已启用管理器 ID 组成；
  - 与 `load_observation_scopes(enabledManagers)` 的 `environment` 范围完全一致；
  - 不写入原始 PATH。
- `useObservationTools` 在 `inspect_environment` 成功后写入 `success`：
  - `itemId = "environment"`；
  - `at = inspection.capturedAt`；
  - `scope = inspection.scopeKey`；
  - `scopeLabel = "应用 PATH 与已启用管理器"`；
  - `completeness`：任一路径条目有 `issue`，或任一命令状态为 `unknown` → 部分；否则完整；
  - `note`：部分时写「部分命令无法完整读取」；缺失命令是事实，不降低完整性。
- 读取异常写入 `attempt`：
  - `outcome = "failed"`；
  - `scope = null`；
  - `reason` 来自错误，截断到 500 字符。
- 环境诊断页签和覆盖度页的刷新都调用同一个读取函数；覆盖度页不依赖环境页签处于激活状态。

### 项目派生数据扫描

- 在 `projectCleanupWorkflow` 的扫描状态转换处写入台账：
  - `ready` → `success`；
  - `stopped` → `success`，完整性为部分；
  - `failed` → `attempt`，`outcome = "failed"`。
- 成功事件：
  - `itemId = "project-scan"`；
  - `at =` 扫描进入 `ready`/`stopped` 的时间；
  - `scope = rootId + "\n" + rootPath + "\n" + maxDepth`；
  - `scopeLabel = rootPath + " · 深度 " + maxDepth`（完整路径留在项目清理页；不在台账中额外格式化 home）；
  - `completeness`：`ready` 且 `ProjectDataScan.status === "Ready"` → 完整；`status === "Partial"` 或 `stopped` → 部分；
  - `note`：部分时写「扫描未完成」或扫描错误摘要。
- 失败事件：
  - `scope` 使用当前扫描设置的根目录与深度（如果已知）；
  - `reason` 来自失败信息。
- 切换根目录、预设或深度不写成功、失败或失效事件；它只改变当前范围，由覆盖度模型与上次成功范围比较。
- 已保存的扫描目录预设不是观察项；不写台账。
- 未配置扫描根目录时不写台账；覆盖度模型显示「未观察 · 未选择扫描根目录」，并允许去项目清理页选择范围。
- 新扫描替换旧扫描会话时只写新扫描结果；不额外写失效。

### 测试

- 环境：成功、部分（路径问题/unknown 命令）、缺失命令仍完整、失败尝试；`scopeKey` 与范围描述命令一致；PATH 或已启用管理器变化导致范围键变化。
- 项目：`ready` 完整、`Partial` 部分、`stopped` 部分、`failed` 失败；根目录/深度/预设变化不写事件但改变当前范围；预设切换不产生新观察项。
- 台账写入失败不改变环境诊断或项目扫描结果。
- 覆盖度页刷新环境诊断时不要求切换到环境页签。
- `pnpm test`、`pnpm build`、`cargo test` 通过。

## Acceptance criteria

- [ ] 环境诊断成功写入 `capturedAt` 与统一范围键；部分状态按 PATH 问题和 unknown 命令判定。
- [ ] 缺失命令不降低完整性，也不被写成读取失败。
- [ ] 项目扫描 `ready`、`stopped`、`failed` 分别写成功、部分成功、失败尝试。
- [ ] 项目范围由根目录与深度组成；切换预设/根目录/深度不写观察事件。
- [ ] 环境范围键与 `load_observation_scopes` 使用同一函数。
- [ ] 两类写入失败都不改变来源结果。
- [ ] 现有环境诊断、项目扫描与清理测试不回归。

## Blocked by

- .scratch/observation-coverage/issues/01-add-observation-ledger-and-scope-descriptors.md
- .scratch/observation-coverage/issues/06-build-observation-coverage-model.md

## Comments

- 2026-10-23：由设计访谈创建。环境范围包含已启用管理器，因为命令候选集合随启停变化。
