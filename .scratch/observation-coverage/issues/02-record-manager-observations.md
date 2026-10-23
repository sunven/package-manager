Status: ready-for-agent

# 记录管理器观察

## Parent

.scratch/observation-coverage/PRD.md

## What to build

让 12 个管理器在扫描完成后写入观察台账，并把管理器观察时间改为「扫描与初始补充测量完成之后」。本 issue 不改变管理器的扫描命令、资格或维护流程。

### 观察时间

- 在 `ManagerScanState` 增加 `lastReadFailed?: boolean`（缺省按 `false` 处理，兼容现有 fixtures）：
  - `readFull` 开始读取时设为 `false`；
  - 扫描返回 `Failed`（无论是否保留旧快照）或命令抛出异常时设为 `true`；
  - 扫描成功（即使路径或补充测量有问题）保持 `false`；
  - `Missing` 不是整体失败，保持 `false`，由状态映射为不可用；
  - `retrySupplement` 不改变它。
  - `error` 仍是问题摘要，可能在成功但有补充问题的扫描后非空；覆盖度模型用 `lastReadFailed` 区分整体失败与部分。
- 把 `ManagerScanState.scannedAt` 的写入点从快照安装后移到主扫描与初始补充测量（路径占用、Homebrew 清理预演、pip 更新检查等）完成之后。
- 只有 `Ready`、`Partial` 或 `Unsupported` 的扫描推进 `scannedAt`；`Missing` 与 `Failed` 不推进成功时间。即使 `Missing`/`Failed` 仍安装了用于展示的快照，也不能把该快照当作成功观察。
- 扫描成功但部分补充失败时仍写成功时间；补充失败通过完整性和备注表达。
- 成功的补充重试（`retrySupplement`）完成后更新 `scannedAt` 并写成功事件；补充重试失败不写整体失败尝试，也不新增台账事件，只在管理器页保留补充错误；当前会话的覆盖度按部分反映，重启后保留上次成功观察的完整性与时间。
- 管理器页与总览的「数据时间」文案统一改为「观察时间」；覆盖度页与台账使用同一个时间。
- `scanStateLabel` 用 `lastReadFailed` 区分文案：整体失败为「最近扫描失败」；成功但 `error` 非空为「扫描完成，部分信息未读取」；正常结束为「扫描已结束」。

### 状态派生

使用 issue 06 的 `managerObservationFacts`（来自 `src/observationFacts.ts`），从 `ManagerSnapshot` 与 `ManagerScanState` 派生：

- `Ready` 且无路径测量跳过、无权限/读取错误、无补充失败 → 完整。
- `Partial`、有 `failures`、任一路径 `size.status` 为 `Error`/`PermissionDenied`、`size.skipped > 0`、Homebrew 清理预演失败或 pip 更新检查失败 → 部分。
- `Unsupported` → 成功，备注「清单不可用」；完整性按路径观察结果判断，不因清单不支持而自动变为部分。
- `Missing` → 不可用尝试，备注「CLI 缺失」；不写成功，也不推进 `scannedAt`。
- `Failed` 或 `lastReadFailed == true` → 失败尝试；不写成功，也不推进 `scannedAt`。
- 成功扫描但 `error` 非空且 `lastReadFailed == false` → 成功部分；不写失败尝试。
- `scopeKey` 为 `null` 时成功事件的范围为 `null`，覆盖度模型显示「范围不可核实」；不把这种情况当作失败。

### 写入

- 使用 issue 01 的 `useObservationLedger`／`recordObservation`。
- 扫描成功后写 `success`：
  - `itemId = manager:<id>`；
  - `at = scannedAt`（完成时间）；
  - `scope = snapshot.scopeKey`；
  - `scopeLabel = null`（管理器范围对用户不可读，不展示原值）；
  - `completeness` 与 `note` 来自上述派生。
- 扫描失败后写 `attempt`：
  - `outcome = "failed"`；
  - `at = Date.now()`；
  - `scope = null`（失败时无法可靠取得本次范围）；
  - `reason` 来自扫描错误，截断到 500 字符。
- `Missing` 写 `attempt`，`outcome = "unavailable"`。
- 首轮自动扫描、手动刷新、扫描全部已启用管理器都走同一记录路径。
- 写入失败只产生台账警告，不改变扫描状态或管理器页显示。

### 测试

- 管理器成功扫描写成功；时间等于补充测量完成后的时间。
- 部分扫描写成功 + 部分完整性；备注包含原因摘要。
- 失败扫描写失败尝试；上次成功时间与范围保留。
- 成功扫描但补充测量有问题时 `error` 非空、`lastReadFailed == false`，写成功部分而不是失败。
- 扫描返回 `Failed` 或抛出异常时 `lastReadFailed == true`，写失败尝试。
- `Missing` 即使安装了展示快照也不推进观察时间，写不可用尝试。
- 部分补充失败仍写成功；成功的补充重试推进观察时间；失败的补充重试不写整体失败。
- `Unsupported` 写成功并备注「清单不可用」；`Missing` 写不可用；`scopeKey` 为空时范围为 `null`。
- 首轮只扫描首个管理器、手动刷新单个、扫描全部三种入口都写入。
- `ManagerScanState.scannedAt` 的新写入点不会让扫描中的旧时间戳提前出现；现有管理器页与总览测试更新文案后通过。
- `scanStateLabel` 在整体失败、成功但有问题、正常结束时分别显示对应文案，不再把所有 `error` 都称为扫描失败。
- `pnpm test`、`pnpm build`、`cargo test` 通过。

## Acceptance criteria

- [ ] 管理器成功扫描在补充测量完成后记录观察时间与成功事件。
- [ ] 部分、失败、不可用和清单不支持分别映射到 PRD 定义的状态，不互相覆盖。
- [ ] 补充重试成功推进时间；失败不把整体观察写成失败。
- [ ] 失败尝试保留上次成功；管理器范围不展示 `scopeKey` 原值。
- [ ] 首轮扫描、单个刷新和批量扫描都写台账。
- [ ] 管理器页与总览使用「观察时间」文案和完成时间；状态文案区分整体失败与成功但有问题。
- [ ] 现有管理器扫描、维护和测试不回归。

## Blocked by

- .scratch/observation-coverage/issues/01-add-observation-ledger-and-scope-descriptors.md
- .scratch/observation-coverage/issues/06-build-observation-coverage-model.md

## Comments

- 2026-10-23：由设计访谈创建。管理器补充测量失败属于完整性问题，不属于整体读取失败。
