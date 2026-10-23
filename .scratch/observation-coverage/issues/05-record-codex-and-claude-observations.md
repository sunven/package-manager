Status: ready-for-agent

# 记录 Codex 与 Claude Code 观察

## Parent

.scratch/observation-coverage/PRD.md

## What to build

让 Codex 的市场、插件、Hooks、Skills 和 Claude Code 的市场与插件、Hooks、Skills 在每次被接受的读取完成后写入台账，并在来源已有显式失效时写失效事件。同时为覆盖度页暴露按单项读取的入口。

### 通用读取回调

- 为 `useNativeInventory` 增加可选的观察回调：
  - `itemId`；
  - `onResult({ scan, error, at })`：在该次读取被接受（未被并发失效取代）后调用；
  - `onInvalidate({ at, reason })`：在显式 `invalidate()` 时调用；
  - 被 `epoch` 取代的结果不调用 `onResult`。
- 为 `useSkillInventory` 增加同样的回调：
  - `onResult` 在 `interpretScan` 后、结果被接受时调用；
  - `onInvalidate` 只在依赖真正变化且已有先前读取/观察时调用；首次挂载和 adapter 初始化不调用。
- 回调只负责把来源事实转成 issue 01 的事件，不改变来源状态或读取流程。

### Codex

- 使用 issue 06 的 `codexObservationFacts` 与 `claudeObservationFacts` 派生完整性、备注和范围；本 issue 只负责在读取完成或显式失效时写台账。
- 市场、插件、Hooks 分别使用 `codex:marketplaces`、`codex:plugins`、`codex:hooks`；Skills 使用 `codex:skills`。
- `useCodexExtensions` 增加 `readMarketplaces()`、`readPlugins()`、`readHooks()`：
  - 直接调用对应 `useNativeInventory.read()`，不依赖当前 `visible`；
  - 覆盖度页可在 Codex 页未激活时逐项刷新；
  - 现有组合 `refresh()` 行为保持不变。
- 状态映射：
  - `Ready` 且无 `warnings`、`message`、`configError` → 成功完整；
  - `Ready` 但有警告/消息 → 成功部分；
  - `MissingCli` / `Incompatible` → 不可用尝试；
  - `Failed` / 读取异常 → 失败尝试；
  - Hooks `featureEnabled === false` → 成功完整，备注「总开关关闭」；不计入需注意；
  - `writeBlockedReason`、只读来源、安装/移除资格不进入观察状态。
- 范围：市场、插件、Hooks 使用 Codex home + config path；Skills 使用 Codex home。均使用与范围描述命令一致的规范字符串和简短标签（完整路径留在 Codex 页面）。
- 失效：市场、插件、Hooks 的显式 `invalidate()` 写 `invalidate` 事件，原因使用调用方提供的消息；首次挂载不写。
- Skills：
  - 状态 Ready/部分/不可用/失败按 Codex `SkillScan.status` 与 `warnings` 映射；
  - 依赖插件或市场变化时写失效；
  - 已有 `refresh()` 可直接供覆盖度页使用。

### Claude Code

- 扩展（市场与插件）、Hooks、Skills 分别使用 `claude:extensions`、`claude:hooks`、`claude:skills`。
- 状态映射：
  - `ClaudeExtensionScan.status === "Ready"` → 成功；`message` 非空 → 部分；
  - `MissingCli` / `Incompatible` → 不可用；
  - `Failed` / 读取异常 → 失败；
  - `ClaudeHookScan` 命令成功 → 成功；`messages` 非空 → 部分；`disableAllHooks` 是设置，不是缺口；
  - Claude Skills 命令成功 → 成功；`warnings` 非空 → 部分；调用异常 → 失败。
- 范围：扩展与 Skills 使用 Claude 配置目录；Hooks 使用配置目录 + config path。均使用与范围描述命令一致的规范字符串和简短标签（完整路径留在 Claude Code 页面）。
- 失效：市场/插件变更后的 Hooks 失效、Hook 写入后的扩展失效、Skills 依赖变化，写 `invalidate` 事件；首次挂载不写。
- 现有 `refresh(view)` 可按页签读取；Skills 的 `refresh()` 可直接供覆盖度页使用。
- `writeBlockedReason`、`writeBlocked`、`installBlocked` 等写入限制不进入观察状态。

### 测试

- Codex：四项独立记录；自动读取、手动读取和覆盖度页直接读取都记录；组合刷新不影响单项状态；市场与插件读取失败互不影响。
- Claude：三项独立记录；扩展/Hooks/Skills 的状态映射；消息与警告产生部分；写入限制不产生需注意。
- 失效：显式失效写事件；首次挂载不写；依赖变化写一次；重新读取成功清除失效。
- 并发：被失效或并发读取取代的结果不写成功；保留的旧扫描不被当成当前成功。
- 范围：四项/三项的规范范围与 `load_observation_scopes` 一致。
- `pnpm test`、`pnpm build`、`cargo test` 通过。

## Acceptance criteria

- [ ] Codex 四项和 Claude 三项都按独立读取记录台账。
- [ ] 覆盖度页可逐项读取 Codex 与 Claude 清单，不要求对应页面处于激活状态。
- [ ] Ready/部分/不可用/失败/功能关闭的映射符合 PRD，写入限制不进入需注意。
- [ ] 显式失效持久化，首次挂载不产生失效，成功读取清除失效。
- [ ] 被取代的读取不写成功；保留的旧扫描不被标成当前已观察。
- [ ] 范围与范围描述命令一致。
- [ ] 现有 Codex、Claude 与 Skills 测试不回归。

## Blocked by

- .scratch/observation-coverage/issues/01-add-observation-ledger-and-scope-descriptors.md
- .scratch/observation-coverage/issues/06-build-observation-coverage-model.md

## Comments

- 2026-10-23：由设计访谈创建。市场与插件是两次独立读取，因此 Codex 拆成四项；Claude 的市场与插件同一次读取，保持三项。
- 2026-10-23：失效只跟随来源已有的显式依赖变化，不新增跨领域失效规则。
