Status: done

# 在扫描结果中暴露可移除的工作区存储记录

## Parent

.scratch/vscode-workspace-storage-removal/PRD.md

## What to build

让后端在扫描 `workspaceStorage` 时给每条记录一个可移除资格，前端不再需要根据 `projectStatus` 自行猜测。

`src-tauri/src/vscode_storage.rs` 的 `VscodeWorkspace` 增加两个字段，并随 `serde(rename_all = "camelCase")` 序列化：

- `removable: bool`
- `removal_block_reason: Option<String>`

资格规则：

| 记录情况 | `removable` | `removal_block_reason` |
| --- | --- | --- |
| 普通目录，`ProjectStatus::Missing` | `true` | `null` |
| 普通目录，`ProjectStatus::Unknown` | `true` | `null` |
| `ProjectStatus::Available` | `false` | `项目路径存在，保留工作区存储` |
| `ProjectStatus::Remote` | `false` | `远程工作区记录不可移除` |
| `ProjectStatus::Unavailable` | `false` | `无法确认项目路径状态，保留记录` |
| 符号链接、普通文件、其他非目录 | `false` | `不是普通存储目录，未跟随符号链接` |
| 目录元数据无法读取 | `false` | `无法读取存储目录，保留记录` |

要点：

- 资格必须在 `symlink_metadata` 之后计算；符号链接条目即使 `project_status` 是 `Unknown` 也不可移除。
- 目录占用统计不完整不阻止移除；`usage.complete == false` 只影响展示下限。
- 不要改变现有 `usage`、`project_status`、`message` 的含义，也不要改变汇总卡片。
- `identify_workspace` 失败（缺少、损坏或无法读取 `workspace.json`）仍然产生 `ProjectStatus::Unknown`；只要目标本身是普通目录，就可移除。执行时还会逐条复核。

前端 `src/vscodeStorage.ts` 的 `VscodeWorkspace` 同步增加：

```ts
removable: boolean;
removalBlockReason: string | null;
```

更新所有构造 `VscodeWorkspace` 的测试夹具（至少 `src/components/VscodeStoragePage.test.tsx` 的 `workspace()` helper），给现有用例补上默认值。此 issue 不新增 UI、不新增命令。

## Acceptance criteria

- [ ] `VscodeWorkspace` 的 JSON 包含 `removable` 与 `removalBlockReason`。
- [ ] `Missing` 和 `Unknown` 的普通目录记录为 `removable: true`，原因为 `null`。
- [ ] `Available`、`Remote`、`Unavailable` 记录为 `removable: false`，且原因与上表一致。
- [ ] 符号链接、普通文件和其他非目录记录为 `removable: false`，原因为「不是普通存储目录，未跟随符号链接」。
- [ ] 目录元数据读取失败时 `removable: false`，并给出可展示的原因。
- [ ] 目录占用不完整不影响 `removable`。
- [ ] 现有扫描的排序、状态、占用和消息行为不变。
- [ ] Rust 测试覆盖上表的每一类记录，包括符号链接和非目录。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 与 `pnpm test` 通过。

## Blocked by

无。

## Comments

- Implemented in `src-tauri/src/vscode_storage.rs` and `src/vscodeStorage.ts`.
- Missing/Unknown non-symlink directories are removable; Available/Remote/Unavailable and non-directory or symlink entries are blocked with a reason.
- Added Rust tests for available/remote/unavailable and updated the existing missing/unknown/symlink/incomplete assertions.
- Verified with `cargo test --manifest-path src-tauri/Cargo.toml vscode_storage` (7 passed).
