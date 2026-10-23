Status: ready-for-agent

# 记录 VS Code 工作区存储移除

## Parent

.scratch/package-manager-opportunities/cross-domain-maintenance-history/PRD.md

## What to build

VS Code 工作区存储移除已要求编辑器退出并在执行时逐条重判资格。现在把确认时的工作区展示快照、逐条结果和自动重扫状态写入维护历史。ADR-0026 的「不新增维护记录」结论已由 ADR-0027 取代，但资格、废纸篓与编辑器退出约束不变。

### Rust

- 扩展 `remove_vscode_workspace_storage` 参数：
  - 保留 `ids` 作为执行身份；新增 `confirmedWorkspaces` 展示快照（`id`、名称、项目路径、存储路径、类型、项目状态、可移除资格、阻塞原因、占用与占用完整度）。
  - 历史范围只保存展示快照；执行仍按 ID 重新读取目录与 `workspace.json`，不信任快照中的资格字段。
- 在执行前创建记录：
  - `domain = "vscodeStorage"`、`operation = "removeWorkspaceStorage"`。
  - `scope.workspaces` 保存确认展示快照。
- 逐条写入 `VscodeStorageRemovalItem`；编辑器在运行中被发现时，剩余项以 `Skipped/EditorStarted` 写入，摘要为 `partial`。
- 结束后关闭记录并按 PRD 派生摘要；不写 `verification`；后续读取由前端写入。
- `VscodeStorageRemovalResult`（或回执包装）增加可选 `historyId` / `historyWarning`；历史写入失败不改变移除结果、逐项原因或编辑器状态错误。
- 保留 `operation_error` 在首选目标前失败时的 `notExecuted` 语义。

### 前端

- `useVscodeStorage.execute` 把确认时的 `VscodeWorkspace[]` 映射为展示快照并随命令发送；执行仍只依赖 IDs。
- 自动重扫完成后通过 issue 01 的 `record_maintenance_followup` 写入 `ready` / `failed`；手动刷新不写历史。
- 复用 `useSessionOperation` 在 issue 04 增加的「自动重扫后写后续读取」能力。
- 结果保留 `historyId` / `historyWarning`，供 issue 07 渲染回链。
- 本 issue 不新增可见 UI。

### 测试

- Rust：
  - 确认快照完整写入；后端不把快照中的 `removable` / `projectStatus` 当作执行资格。
  - 逐条 `Moved / Skipped / Failed` 与原因保留，包括 `ProjectAvailable`、`ProjectRemote`、`ProjectUnavailable`、`NotRegularDirectory`、`TargetUnreadable`、`EditorStarted`、`TrashFailed`。
  - 编辑器中途启动导致剩余跳过时摘要为 `partial`。
  - 首选目标前编辑器未退出或根目录无效时 `notExecuted`。
  - 历史写入失败不改变移除结果与原因。
- TypeScript：
  - 命令收到确认展示快照与 IDs；执行不读取快照资格字段。
  - 自动重扫后写入一次后续读取；手动刷新不写。
  - `historyId` 缺失时不调用后续读取。
  - 现有 VS Code 移除测试不回归。
- `cargo test`、`pnpm test`、`pnpm build` 通过。

## Acceptance criteria

- [ ] VS Code 工作区存储移除生成一条维护记录，保存确认时的展示快照。
- [ ] 逐条结果、跳过原因与编辑器中途启动行为写入历史。
- [ ] 执行资格仍由后端按 ID 重新读取，历史快照不扩大移除权限。
- [ ] 自动重扫后写入一次后续读取；手动刷新不回写。
- [ ] 历史写入失败不改变移除结果或编辑器状态错误。
- [ ] 移除记录不写核对字段。
- [ ] 结果对象携带 `historyId` / `historyWarning`，供后续 UI 回链。

## Blocked by

- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/01-add-unified-maintenance-history-store.md

## Comments

- 2026-10-23：由设计访谈创建。ADR-0026 的资格与执行约束继续有效，仅「不新增维护记录」被取代。
