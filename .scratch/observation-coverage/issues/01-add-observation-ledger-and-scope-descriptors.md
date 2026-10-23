Status: ready-for-agent

# 新增观察台账与范围描述

## Parent

.scratch/observation-coverage/PRD.md

## What to build

引入 ADR-0028 定义的观察元数据台账，以及不需要读取来源内容就能获得当前范围描述的能力。本 issue 不改变任何现有来源的读取或界面行为；后续 issue 在此基础上接入各领域。

### Rust 台账

新增 `src-tauri/src/observation_ledger.rs`：

- 定义 PRD 中的线格式类型：`ObservationCompleteness`、`ObservationAttemptOutcome`、`ObservationItemId`、`ObservationScope`、`ObservationRecord`、`ObservationEvent`、文档 `{ version: 1, items: [...] }`。
- 文件：`app_data_dir()/observation-ledger.json`。每个观察项只保留最新一条记录；不保存观察历史。
- 写入沿用现有安全属性：临时文件、`flush`、`sync_all`、原子替换；进程内互斥；读-改-写。
- 损坏或版本高于 1 时保留原文件、返回读取警告、后续写入不得覆盖。读取失败不阻止应用启动。
- 字符串截断：范围 500 字符、范围标签 300 字符、备注/原因 500 字符；不写入包清单、扫描结果、会话标题或正文、技能定义、stdout/stderr、环境变量或文件内容。
- 事件语义：
  - `success`：写 `lastSuccess`，把 `lastAttempt` 写为 `succeeded`，清除 `invalidated`。
  - `attempt`：只写 `lastAttempt`（`failed` 或 `unavailable`），保留 `lastSuccess` 与 `invalidated`。
  - `invalidate`：只写 `invalidated`，保留成功与尝试。
- 固定 25 项 ID 允许列表；拒绝未知 ID 和未知事件类型。同一版本中未知 ID 的既有记录在写入时保留，避免未来增加来源时丢失数据。
- 事件时间使用前端完成读取时的时间；拒绝非有限或负值。成功与尝试分别保存范围，失败的新范围尝试不能覆盖旧范围成功。

### 命令

- `load_observation_ledger()` → `{ records: ObservationRecord[], warnings: string[] }`。
- `record_observation(event)` → `{ warning: string | null }`。写入失败返回警告，不改变来源读取结果。
- `load_observation_scopes(enabledManagers)` → `Record<ObservationItemId, ObservationScope | null>`。
  - 只解析当前 home、配置路径、VS Code 存储路径和 PATH 摘要，不读取清单、会话、技能、包或文件内容，不写台账。
  - 管理器与 `session:opencode` 返回 `null`；`project-scan` 返回 `null`（由前端扫描设置提供）。
  - 环境诊断范围使用规范化 PATH 条目摘要 + 排序后的已启用管理器 ID；该算法必须是公开函数，供 issue 03 的 `inspect_environment` 复用。
  - VS Code、Codex、Claude 与会话目录的解析必须复用各扫描命令已有的路径解析函数，不能复制一份容易漂移的逻辑。
  - 任一项解析失败只让该项返回 `null`，不影响其他项。

### TypeScript

- 新增 `src/observationItems.ts`：25 项稳定 ID、分组、显示名、分组顺序；不包含来源页动作实现。
- 新增 `src/observationLedger.ts`：
  - 镜像线格式类型；
  - `loadObservationLedger()`、`recordObservation(event)`、`loadObservationScopes(enabledManagers)` 的 Tauri 调用封装；
  - 对字符串长度与事件时间做前端侧基本校验；
  - 模块级共享客户端：`recordObservation(event)` 立即更新内存记录，并把 Rust 写入放入串行队列；写入失败记录非阻塞警告，不回滚内存记录；提供 `getSnapshot()`、`subscribe(listener)` 和 `load()`。来源 hook／workflow 直接导入客户端写入，不需要逐层传递回调。
- 新增 `src/hooks/useObservationLedger.ts`：
  - 启动时调用一次 `load()`；
  - 订阅共享客户端，暴露 `records`、`warnings`、`error`、`record(event)`；
  - 不触发任何来源读取。
- 新增 `src/hooks/useObservationScopes.ts` 或在同一 hook 中加载范围描述：
  - 应用启动时加载一次；
  - 已启用管理器变化时重新加载范围描述；
  - 暴露当前范围映射；加载失败只让未知范围保持 `null`。
- 本 issue 不接入任何来源页。

### 测试

- Rust：序列化往返；成功/尝试/失效；成功与尝试范围分离；最新一条；未知 ID 拒绝与保留；原子写；损坏/未来版本保护；并发写入；写入失败警告；字符串截断；范围描述不读取来源内容；环境范围算法稳定。
- TypeScript：25 项目录完整且 ID 唯一；共享客户端串行队列与失败警告；内存记录立即更新；订阅者在记录变化时收到更新；启动加载失败不阻止应用；范围描述映射。
- `cargo test`、`pnpm test`、`pnpm build` 通过。

## Acceptance criteria

- [ ] 新增 `observation-ledger.json`，每个观察项只保留最新记录，不接受未知 ID 或事件类型。
- [ ] 成功、失败尝试与显式失效分别写入；失败尝试不覆盖上次成功；成功清除失效。
- [ ] 台账损坏或未来版本不被覆盖，读取警告可见；写入失败返回警告且不改变来源结果。
- [ ] `load_observation_scopes` 只返回范围描述，不调用任何来源扫描命令。
- [ ] 环境范围算法与后续 `inspect_environment` 使用同一函数；范围描述与管理器/OpenCode 返回 `null`。
- [ ] TypeScript 目录、台账客户端与串行写入 hook 可用，启动加载失败不阻止应用。
- [ ] 现有来源页、历史页和测试不回归。

## Blocked by

无。

## Comments

- 2026-10-23：由设计访谈创建。实现依据 ADR-0028 与 PRD。
- 2026-10-23：范围描述命令只解析当前路径与环境，不读取来源内容；这是覆盖度页打开时不触发来源读取的前提。
