Status: ready-for-agent

# 建立观察覆盖度模型

## Parent

.scratch/observation-coverage/PRD.md

## What to build

用纯 TypeScript 建立「来源事实 → 覆盖度状态 → 分组计数」的模型，作为后续台账写入和页面展示的唯一语义来源。本 issue 不新增页面，也不触发来源读取。

### 来源事实

新增 `src/observationFacts.ts`，为每个来源提供纯函数，输入现有 hook/扫描结果，输出：

```ts
interface ObservationFacts {
  phase: "idle" | "reading";
  success: {
    at: number | null;
    scope: string | null;
    scopeLabel: string | null;
    completeness: ObservationCompleteness;
    note: string | null;
  } | null;
  failure: {
    outcome: "failed" | "unavailable";
    reason: string;
  } | null;
  invalidated: { at: number; reason: string } | null;
  currentScope: ObservationScope | null;
}
```

- 管理器：`managerObservationFacts(snapshot, scanState)`；按 PRD 的 Ready/Partial/Unsupported/Missing/Failed 映射，成功时间使用补充测量完成后的 `scannedAt`。整体失败用 `scanState.lastReadFailed` 判断；`error` 非空但 `lastReadFailed == false` 为部分，不是读取失败。
- 环境诊断：`environmentObservationFacts(inspection, busy, error)`；范围使用 inspection 的 `scopeKey`。
- 项目扫描：`projectObservationFacts(scanView, settings)`；范围来自根目录与深度，`stopped` 为部分。没有配置根目录时返回无观察事实，模型显示「未观察 · 未选择扫描根目录」，`adjustScope=true`，不写台账。
- VS Code：`vscodeObservationFacts(scan, scanning, error)`；`Missing` 为已观察的缺失。
- 会话：`sessionObservationFacts(source, scan, scanning, error)`；OpenCode 的 `unavailable` 为不可用。
- Codex：`codexObservationFacts(kind, view)`；市场、插件、Hooks、Skills 分别映射。
- Claude：`claudeObservationFacts(kind, view)`；扩展、Hooks、Skills 分别映射。
- 显式失效从各 hook 的 `invalidate` 状态或对应视图读取；首次挂载不产生失效。
- 没有自身时间戳的来源（项目扫描、VS Code、会话、Codex／Claude）可以把 `success.at` 返回为 `null`；模型使用台账中对应的成功时间。两者都没有时不显示观察时间，不用渲染时刻代替。
- 未知/不完整状态返回 `null`，由覆盖度模型回退到台账；不猜测。

这些函数同时供 issue 02–05 写台账时使用，确保写入的完整性与备注和页面显示一致。

### 覆盖度模型

新增 `src/observationCoverage.ts`：

- `buildObservationCoverage({ ledger, warnings, facts, scopes, projectScope, disabledManagers })`。
- 定义 `CoverageStatus = "disabled" | "inProgress" | "invalidated" | "scopeChanged" | "failed" | "unavailable" | "observed" | "partial" | "lastObserved" | "notObserved"`。
- 每个观察项合并：
  - 当前内存事实（`ObservationFacts`）；
  - 台账记录；
  - 当前范围（`facts.currentScope ?? scopes[id] ?? projectScope`）；
  - 目录中的能力（`view`、`refresh`、`adjustScope`）。
- 主徽章优先级严格按 PRD：
  1. 已停用管理器；
  2. 观察中；
  3. 已失效；
  4. 范围已变化；
  5. 读取失败／不可用；
  6. 已观察／部分；
  7. 上次观察；
  8. 仅台账失败尝试的读取失败／不可用；
  9. 未观察。
- 只有当前读数成功且未被取代时才使用 `success`；`phase === "reading"` 时显示观察中，但保留上次成功。
- 范围变化：当前范围与 `lastSuccess.scope` 都非空且不同，且没有当前范围成功；不因 `null` 推断变化。
- `attention` 严格按 PRD：已启用且未观察、失败、不可用、部分、已失效或范围变化。已停用、不支持清单、功能开关关闭、目录不存在、写入受限不进入需注意。只有台账且 `completeness === "partial"` 的「上次观察」仍计入需注意；完整的上次观察不计入。
- 计数：`observedCount` 包含 observed、lastObserved 与 partial；`partialCount` 是完整性为部分的成功子集；failed、unavailable、invalidated、scopeChanged、notObserved、disabled、inProgress 分别计数。已观察与需注意可以重叠（部分成功）。
- 输出 `ObservationCoverageItem[]`、按固定顺序分组、组计数和总计数。管理器组额外输出「已观察 / 已启用」：已观察只统计已启用且至少有一次成功读数（observed、lastObserved 或 partial）的管理器，已启用为已启用管理器数；已停用单独计数。已观察与需注意可以重叠。
- 操作能力：
  - `view` 对所有项为 true；
  - `refresh` 为环境、VS Code、三个会话来源、Codex 四项、Claude 三项；管理器与项目扫描为 false；
  - `adjustScope` 为管理器与项目扫描；已停用管理器仍可去设置；
  - 已停用管理器的 `refresh` 为 false。
- 时间格式化：精确本地时间 + 相对时间（刚刚/分钟/小时/昨天/天/日期）；不生成「过期」「新鲜度评分」文案。
- 纯函数，不读取 Tauri、不写台账、不使用 React state。

### 测试

- 25 项完整、ID 唯一、分组顺序固定。
- 主徽章优先级：观察中 > 上次成功；失效 > 上次观察；范围变化 > 上次观察；失败尝试 > 上次观察；当前成功 > 台账成功；仅台账成功 → 上次观察；无记录 → 未观察；已停用最高。
- 映射：管理器 Ready/Partial/Unsupported/Missing/Failed；`lastReadFailed=false` 且 `error` 非空为部分；环境完整/部分；项目 ready/stopped/failed；VS Code Ready/Partial/Missing；会话 Ready/Partial/Missing/Failed/unavailable/failed；Codex/Claude Ready/部分/不可用/失败/功能关闭。
- 需注意：部分、失败、不可用、失效、范围变化、未观察计入；已停用、不支持清单、功能关闭、目录不存在、写入限制、观察中、已观察、完整的上次观察不计入；部分的上次观察计入。
- 范围变化：当前范围已知且不同；当前范围未知不误报；当前范围有成功时不误报。
- 已停用管理器：不计入需注意，保留上次观察，`refresh=false`。
- 计数与组标题；管理器「已观察 / 已启用」；无百分比、无全局时间。
- `pnpm test`、`pnpm build` 通过。

## Acceptance criteria

- [ ] `observationFacts` 为所有来源提供唯一的状态、完整性、备注与范围派生。
- [ ] `buildObservationCoverage` 按 PRD 优先级生成主徽章，当前成功、台账成功和失败尝试不会互相覆盖。
- [ ] 重启后只有台账时显示「上次观察」；范围变化与失效优先于「上次观察」。
- [ ] 需注意集合严格符合 PRD，已停用与已知边界不计入。
- [ ] 管理器组「已观察 / 已启用」和其他组计数正确；无百分比。
- [ ] 模型是纯函数，不读取来源、不写台账、不依赖 React。
- [ ] 现有测试不回归。

## Blocked by

- .scratch/observation-coverage/issues/01-add-observation-ledger-and-scope-descriptors.md

## Comments

- 2026-10-23：由设计访谈创建。模型先于各领域写入完成，避免 25 个来源各自复制一套状态映射。
- 2026-10-23：issue 02–05 依赖本 issue 的 `observationFacts` 来写台账。
