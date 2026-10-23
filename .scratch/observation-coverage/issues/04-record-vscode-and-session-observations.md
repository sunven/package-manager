Status: ready-for-agent

# 记录 VS Code 与会话记录观察

## Parent

.scratch/observation-coverage/PRD.md

## What to build

让 VS Code 工作区存储扫描和三个会话来源在读取完成后写入观察台账。会话来源继续按 Codex、Claude、OpenCode 分别记录与刷新；移除操作后的后续读取也按普通读取更新台账。

### VS Code 工作区存储

- 使用 issue 06 的 `vscodeObservationFacts` 与 `sessionObservationFacts` 派生完整性、备注和范围；本 issue 只负责在读取完成时写台账。
- 在 `useVscodeStorage` 的扫描完成处写入：
  - `itemId = "vscode-storage"`；
  - `scope = scan.storagePath`；
  - `scopeLabel = "VS Code 工作区存储"`（完整路径留在 VS Code 页面）；
  - `at = Date.now()`（读取完成时间）。
- 状态映射：
  - `Ready` → 成功；任一工作区 `usage.complete === false` → 部分；否则完整。
  - `Partial` → 成功，部分。
  - `Missing` → 成功，完整，备注「未找到目录」。
  - 读取异常 → 失败尝试，保留上次成功。
- 移除操作后的自动重扫使用同一路径，更新成功时间与完整性。
- 首次激活读取、手动刷新和覆盖度页刷新都记录；不因为页签是否激活而跳过。

### 会话记录

- 复用 `useSessionOperation` 已有的按来源扫描状态与 `refresh(scopes)`：
  - Codex 与 Claude 分别刷新 `["codex"]`、`["claude"]`；
  - OpenCode 单独刷新。
- 为 `useSessionOperation` 增加可选的读取结果回调（例如 `onSourceRead(source, scan, failure, at)`），在某个来源的结果被接受、且 ticket 仍有效时调用；被并发读取取代的结果不记录。
- Codex／Claude：
  - `itemId = "session:<source>"`；
  - `scope = scan.directory`；
  - `scopeLabel = "Codex 会话目录"` 或 `"Claude 会话目录"`（完整路径留在会话页）；
  - `Ready` → 成功完整；`Partial` → 成功部分；`Missing` → 成功完整，备注「未找到目录」；`Failed` → 失败尝试。
- OpenCode：
  - `itemId = "session:opencode"`；
  - `scope = null`（扫描结果没有稳定的服务身份）；
  - `scopeLabel = "已登记的 OpenCode 服务"`；
  - `ready` → 成功完整；`unavailable` → 不可用尝试，备注服务未连接；`failed` → 失败尝试。
- 单个来源失败只写该来源的尝试；其他来源的结果不受影响。
- 会话移除后的后续读取与普通读取一致：成功更新观察时间；失败保留上次成功。
- 覆盖度页的逐项刷新调用现有 `refresh`，不要求会话页处于激活状态。

### 测试

- VS Code：Ready、Partial、Missing、失败尝试；工作区测量不完整使完整性为部分；移除后重扫更新；存储路径进入范围。
- 会话：每个来源独立记录；Codex 失败不影响 Claude；Missing 是已观察的缺失；OpenCode unavailable/failed；并发读取被取代时不写成功；后续读取更新。
- 逐项刷新在页面未激活时仍可调用，且只读取指定来源。
- 台账写入失败不改变扫描或移除结果。
- `pnpm test`、`pnpm build`、`cargo test` 通过。

## Acceptance criteria

- [ ] VS Code 的 Ready/Partial/Missing/失败分别映射到 PRD 状态，存储路径进入范围。
- [ ] Codex、Claude、OpenCode 独立记录与刷新，一个来源失败不影响其他来源。
- [ ] 目录不存在是已观察的缺失，不是未观察或失败。
- [ ] OpenCode 未连接是不可用，不产生虚假的零数量。
- [ ] 移除后的后续读取更新观察时间；失败保留上次成功。
- [ ] 被并发读取取代的结果不写成功。
- [ ] 现有 VS Code、会话和移除测试不回归。

## Blocked by

- .scratch/observation-coverage/issues/01-add-observation-ledger-and-scope-descriptors.md
- .scratch/observation-coverage/issues/06-build-observation-coverage-model.md

## Comments

- 2026-10-23：由设计访谈创建。`useSessionOperation` 已有按来源的扫描状态与刷新，只需增加结果回调与台账写入。
