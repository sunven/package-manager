Status: done

# 后端执行 VS Code 工作区存储移除

## Parent

.scratch/vscode-workspace-storage-removal/PRD.md

## What to build

新增一个后端命令，把用户选中的工作区存储目录移入系统废纸篓。前端只提交记录 ID；路径、资格和复核全部由后端决定。

### 模块与类型

新增 `src-tauri/src/vscode_removal.rs`，在 `lib.rs` 声明模块并注册命令。结构体字段使用 `serde(rename_all = "camelCase")`；`VscodeEditorStatus`、状态和原因枚举不加 `rename_all`，按现有习惯序列化为 PascalCase；进度枚举使用 `tag = "phase"` + `rename_all = "camelCase"`，`phase` 值为小写。

```rust
pub(crate) enum VscodeEditorStatus {
    Stopped,
    Running,
    Unknown,
}

pub(crate) struct VscodeStorageRemovalResult {
    pub moved: u32,
    pub failed: u32,
    pub skipped: u32,
    pub items: Vec<VscodeStorageRemovalItem>,
    pub operation_error: Option<String>,
    pub message: Option<String>,
}

pub(crate) struct VscodeStorageRemovalItem {
    pub id: String,
    pub status: VscodeStorageRemovalStatus,
    pub reason: Option<VscodeStorageRemovalReason>,
    pub message: Option<String>,
}

pub(crate) enum VscodeStorageRemovalStatus {
    Moved,
    Skipped,
    Failed,
}

pub(crate) enum VscodeStorageRemovalReason {
    NoLongerRecord,
    ProjectAvailable,
    ProjectRemote,
    ProjectUnavailable,
    NotRegularDirectory,
    TargetUnreadable,
    EditorStarted,
    TrashFailed,
}

#[serde(tag = "phase", rename_all = "camelCase")]
pub(crate) enum VscodeStorageRemovalProgress {
    Preparing,
    Started { total: usize },
    Advanced {
        processed: usize,
        total: usize,
        moved: u32,
        skipped: u32,
        failed: u32,
    },
}
```

### 编辑器状态

- 新增命令 `get_vscode_editor_status() -> VscodeEditorStatus`。
- macOS 上通过 `pgrep -x Code` 检测稳定版 VS Code 主进程：退出码 0 → `Running`，退出码 1 → `Stopped`，其他退出码或启动失败 → `Unknown`。
- 把执行检测的部分做成可注入的闭包或 runner，测试不依赖本机是否打开 VS Code。
- `Unknown` 与 `Running` 同等对待：不能发起移除。

### 移除入口

新增命令：

```rust
#[tauri::command]
async fn remove_vscode_workspace_storage(
    ids: Vec<String>,
    on_progress: tauri::ipc::Channel<vscode_removal::VscodeStorageRemovalProgress>,
) -> Result<vscode_removal::VscodeStorageRemovalResult, String>
```

内部使用可测试的函数（参照 `session_records::remove_one` 的注入方式）：

```rust
fn remove_selected(
    root: &Path,
    ids: &[String],
    editor_status: &dyn Fn() -> VscodeEditorStatus,
    trash: &mut dyn FnMut(&Path) -> Result<(), String>,
    report: &mut dyn FnMut(VscodeStorageRemovalProgress),
) -> VscodeStorageRemovalResult
```

从 `vscode_storage.rs` 提取 `pub(crate)` 的默认存储根解析函数，供扫描和移除共用；不要在前端或命令参数里接受根路径。

### 路径护栏

对每个 ID：

- 非空，且只包含一个普通路径组件；拒绝绝对路径、`.`、`..`、包含分隔符或任何多组件路径。
- 根目录必须是已存在、非符号链接的普通目录。
- `root.join(id)` 的父目录必须仍是根目录。
- 目标必须存在，且 `symlink_metadata` 显示它是目录、不是符号链接。目标消失 → 跳过 `NoLongerRecord`；符号链接或非目录 → 跳过 `NotRegularDirectory`；元数据读取失败 → 跳过 `TargetUnreadable`。

### 执行时复核

确认框里的扫描结果是确认当时的观察。每个目标在动手前重新读取：

- 重新执行与扫描相同的 `workspace.json` 读取和 `fs::metadata(project_path)` 判断，不信任前端数据，也不信任旧快照。
- `ProjectStatus::Available` → 跳过 `ProjectAvailable`，消息「项目路径已恢复，留在原处」。这覆盖外接磁盘重新挂载、项目被移回。
- `ProjectStatus::Remote` → 跳过 `ProjectRemote`。
- `ProjectStatus::Unavailable` → 跳过 `ProjectUnavailable`。
- `ProjectStatus::Missing` 或 `Unknown` → 继续移入废纸篓。
- 不要重复实现 URI 解析；复用或提取 `vscode_storage.rs` 中的识别逻辑。

### 编辑器检查

- 报告 `Preparing` 后、报告 `Started` 前检查一次编辑器状态；不是 `Stopped` 就返回带 `operation_error` 的结果，不移动任何目标（例如「请先退出 VS Code 后重试」或「无法确认 VS Code 是否运行，请退出后重试」）。
- 每一项动手前再检查。检测到 `Running` 或 `Unknown` 时停止循环，把当前项和所有剩余项标记为 `Skipped` + `EditorStarted`，并设置 `message`（例如「VS Code 已启动，剩余 N 项未处理」）。已处理项的结果保留。

### 移入废纸篓与结果

- 复用 `session_records::move_path_to_trash`（`pub(crate)`），不要重写 Finder 脚本。
- 成功 → `Moved`；Finder 失败 → `Failed` + `TrashFailed`，继续后续目标。
- ID 去重，保持首次出现的顺序；`Started.total` 是去重后的数量。
- 每处理完一个目标（成功、跳过或失败）报告一次 `Advanced`，累计计数。
- 中途因编辑器启动而停止时，不要再为未处理项报告 `Advanced`；它们只出现在最终结果的 `items` 中，进度不得声称已处理。
- 根目录不存在或不是普通目录时返回带 `operation_error` 的结果；不要 panic。
- 结果结构与会话记录移除保持一致：`operation_error` 表示整次操作未开始或中止，`message` 表示部分完成时的说明。

### 注册

在 `lib.rs` 的 `invoke_handler` 中注册 `get_vscode_editor_status` 和 `remove_vscode_workspace_storage`。

## Acceptance criteria

- [ ] `get_vscode_editor_status` 在 `pgrep` 退出 0 时返回 `Running`，退出 1 时返回 `Stopped`，其他情况返回 `Unknown`。
- [ ] 编辑器状态为 `Running` 或 `Unknown` 时，移除不开始，`operation_error` 说明原因，trash 闭包一次都没有被调用。
- [ ] 执行中每一项前重新检测；检测到启动后停止，剩余项在结果中标记为 `Skipped` + `EditorStarted`，`message` 说明剩余数量。
- [ ] 绝对路径、`.`、`..`、多组件 ID、符号链接根目录、符号链接目标、非目录目标全部被拒绝或跳过。
- [ ] 项目路径在确认后恢复（例如重新挂载外接盘）时，目标被跳过为 `ProjectAvailable`，不进入废纸篓。
- [ ] 项目状态在确认后变成 `Remote` 或 `Unavailable` 时，目标被跳过并给出对应原因。
- [ ] 仍是 `Missing` 或 `Unknown` 的普通目录被移入废纸篓，调用的是注入的 trash 闭包。
- [ ] 单个目标移入废纸篓失败时标记 `Failed` + `TrashFailed`，后续目标继续处理。
- [ ] 进度按 `Preparing` → `Started` → 每个目标一次 `Advanced` 的顺序报告，累计计数正确。
- [ ] ID 去重，`Started.total` 等于去重后的目标数。
- [ ] 测试不打开 VS Code、不调用 Finder、不触碰用户的 home；编辑器状态和 trash 都用注入的闭包。
- [ ] 新增 Rust 测试覆盖上述路径护栏、状态复核、编辑器运行/中途启动、trash 失败和进度顺序。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过。

## Blocked by

- .scratch/vscode-workspace-storage-removal/issues/01-expose-removable-workspace-records.md

## Comments

- Added `src-tauri/src/vscode_removal.rs` with editor status, result/progress types, path guards, execution-time project revalidation, trash, and progress reporting.
- `pgrep -x Code` maps exit 0/1/other to `Running`/`Stopped`/`Unknown`; `Unknown` blocks removal. Per-item checks stop remaining records when VS Code starts.
- Registered `get_vscode_editor_status` and `remove_vscode_workspace_storage` in `lib.rs`.
- Tests inject editor status and trash; they do not open VS Code, call Finder, or touch the user's home. 10 tests pass.
