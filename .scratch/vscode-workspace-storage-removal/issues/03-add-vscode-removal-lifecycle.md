Status: done

# 接入 VS Code 移除操作生命周期

## Parent

.scratch/vscode-workspace-storage-removal/PRD.md

## What to build

在前端接入扫描、编辑器状态、移除操作和结果，但**不新增任何可见 UI**。这个 issue 结束时页面外观与现在一致，只读徽标、表格和交互都不变；下一个 issue 再把选择列、对话框和结果提示接上。

### 类型与纯函数

沿用 issue 01 已加入的 `VscodeWorkspace.removable` 和 `removalBlockReason`，在 `src/vscodeStorage.ts` 新增移除相关类型：

- `VscodeEditorStatus = "Stopped" | "Running" | "Unknown"`。
- `VscodeStorageRemovalStatus = "Moved" | "Skipped" | "Failed"`。
- `VscodeStorageRemovalReason`：`"NoLongerRecord" | "ProjectAvailable" | "ProjectRemote" | "ProjectUnavailable" | "NotRegularDirectory" | "TargetUnreadable" | "EditorStarted" | "TrashFailed"`。
- `VscodeStorageRemovalItem`、`VscodeStorageRemovalResult`，字段与 `src-tauri/src/vscode_removal.rs` 的 camelCase 序列化一致。
- 进度联合类型与 Rust 的 `#[serde(tag = "phase", rename_all = "camelCase")]` 对齐：
  ```ts
  type VscodeStorageRemovalProgress =
    | { phase: "preparing" }
    | { phase: "started"; total: number }
    | { phase: "advanced"; processed: number; total: number; moved: number; skipped: number; failed: number };
  ```
- `VscodeRemovalTarget = { workspaces: VscodeWorkspace[] }`。

新增 `src/vscodeRemoval.ts`，放纯函数与文案：

- `vscodeRemovalProgressText(progress)`：准备中、`0/N`、`p/N`。
- `vscodeRemovalProgressDetail(progress)`：`已移入 X · 跳过 Y · 失败 Z`。
- `vscodeRemovalProgressValue(progress)`：用于进度条 `aria-valuenow`。
- `vscodeRemovalResultText(result)`：结果摘要。
- `vscodeRemovalReasonLabel(reason)`：跳过/失败原因的中文标签，至少覆盖 `NoLongerRecord`、`ProjectAvailable`、`ProjectRemote`、`ProjectUnavailable`、`NotRegularDirectory`、`TargetUnreadable`、`EditorStarted`、`TrashFailed`。
- `selectedVscodeRemovalConfirmText(count)`。
- `summarizeVscodeRemoval(workspaces)`：返回 `{ bytes, complete }`；只累加已测得占用，任一记录不完整时 `complete: false`，全部未测得时 `bytes: null`，与现有 `summarizeVscodeStorage` 的口径一致。
- `completedVscodeRemovalIds(result)`：只返回 `Moved` 的 ID。
- `removeVscodeWorkspaces(scan, ids)`：返回去掉这些 ID 的新扫描对象，不修改入参。
- `vscodeEditorBlocked(status)`：`status !== "Stopped"`，包括 `null`（尚未检测完成）。

### 重写 `useVscodeStorage`

把 `src/hooks/useVscodeStorage.ts` 改为基于 `useSessionOperation` 的单来源适配器，来源固定为 `"vscode"`：

- `read` 调用 `scan_vscode_storage`；失败时保留上一次扫描（`useSessionOperation` 的既有行为），页面仍显示上次结果和错误。
- `execute` 调用 `remove_vscode_workspace_storage`，参数为 `{ ids, onProgress }`，`onProgress` 使用 `new Channel<VscodeStorageRemovalProgress>(report)`。
- `completedIds` 使用 `completedVscodeRemovalIds`。
- `removeCompleted` 使用 `removeVscodeWorkspaces`。
- `shouldRefresh` 返回 `true`。
- `scopesFor` 返回 `["vscode"]`；scope 常量定义在模块级，保持引用稳定。

在同一个 hook 中管理编辑器状态：

- `editorStatus: VscodeEditorStatus | null`，初始为 `null`。
- `checkingEditor: boolean`。
- `checkEditor()` 调用 `get_vscode_editor_status`；命令失败时视为 `"Unknown"`。激活页面时自动检查一次，手动刷新时与扫描一起重新检查。
- 暴露 `request(target)`：先 `await checkEditor()`，只有返回 `"Stopped"` 才调用 `begin(target)` 并返回 `true`；否则返回 `false`，不打开确认框。
- 暴露 `operation`、`outcome`、`confirm`、`cancel`，直接来自 `useSessionOperation`。
- 返回的扫描字段保持现有名称：`scan`、`scanning`、`error`、`refresh`。

`refresh` 需要同时刷新扫描和编辑器状态；不要因为编辑器状态检查失败而让扫描失败。

### 页面与 App 接线

- `App.tsx` 继续调用 `useVscodeStorage(activeView === "vscode")`，但把整个 workflow 对象传给页面：`<VscodeStoragePage workflow={vscodeStorage} ... />`。
- `VscodeStoragePage` 的 props 改为接收 `workflow`（参考 `ProjectCleanupPage` 的 `workflow` 用法），内部改用 `workflow.scan`、`workflow.scanning`、`workflow.error`、`workflow.refresh`。
- 保持现有渲染不变：仍是「只读」徽标、四张卡片、搜索、表格、空状态和刷新行为。
- 更新 `VscodeStoragePage.test.tsx` 的 render helper，构造最小的 workflow 对象；断言保持不变。

### 测试

- 纯函数测试：每个进度阶段、结果摘要、原因标签、合计下限、已完成 ID、扫描裁剪、`editorStatus` 为 null/Running/Unknown 时的 blocked 判断。
- Hook/交互测试（沿用 `SessionRecordsPage.interaction.test.tsx` 的 mock 方式）：
  - 激活页面会调用 `scan_vscode_storage` 和 `get_vscode_editor_status`。
  - `request` 在编辑器 `Stopped` 时进入 `confirming`；`Running`/`Unknown` 时保持无操作。
  - `confirm` 调用 `remove_vscode_workspace_storage`，传入选中 ID 和 Channel；进度回调更新 `operation.progress`。
  - 完成后 `outcome` 保留结果，`completedIds` 中的记录从扫描中移除，随后重新扫描。
  - 扫描失败时保留上一次扫描并显示错误。

## Acceptance criteria

- [ ] `useVscodeStorage` 基于 `useSessionOperation`，单来源适配器的 read/execute/completedIds/removeCompleted/shouldRefresh 全部实现。
- [ ] 扫描失败时保留上一次扫描；刷新和激活行为与现有页面一致。
- [ ] 移除命令收到的是记录 ID 和本次调用的 Channel，不是路径或扫描对象。
- [ ] `request` 在编辑器不是 `Stopped`（含 `Unknown`、尚未检测完成）时拒绝进入确认阶段。
- [ ] 激活页面和手动刷新都会更新编辑器状态。
- [ ] `operation`、`outcome`、`confirm`、`cancel` 可用，生命周期与会话记录移除一致：确认 → 执行 → 结果 → 重扫。
- [ ] 完成后已移动的记录从当前扫描中先行移除，再重新扫描。
- [ ] 页面外观与现有版本一致；没有新增复选框、对话框、横幅或「可移除」文案。
- [ ] `pnpm test` 与 `pnpm build` 通过。

## Blocked by

- .scratch/vscode-workspace-storage-removal/issues/01-expose-removable-workspace-records.md
- .scratch/vscode-workspace-storage-removal/issues/02-remove-vscode-workspace-storage.md

## Comments

- Added removal types to `src/vscodeStorage.ts` and pure helpers/tests in `src/vscodeRemoval.ts`.
- Rewrote `useVscodeStorage` on `useSessionOperation` with a single `"vscode"` scope, editor status checks, and a `request` gate; App/page now pass the workflow object while keeping the visible UI unchanged.
- Added `readOnActivate` to `useSessionOperation` (default `true`) so VS Code keeps its scan-once-on-first-activation behavior while session records keep rescanning on activation.
- 3 hook tests and 5 helper tests pass; typecheck passes.
