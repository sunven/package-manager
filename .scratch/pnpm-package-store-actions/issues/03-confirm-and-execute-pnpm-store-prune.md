Status: done

# 确认并执行 pnpm store 清理

## Parent

.scratch/pnpm-package-store-actions/PRD.md

## What to build

从 pnpm store 区域添加完整的 store prune 流程。pnpm store 路径或大小区域应该暴露明确的清理按钮或图标。点击后先要求显式确认，再执行 allowlisted pnpm store prune 操作，展示 pending、成功、失败反馈，并在成功后刷新 pnpm store 大小或 pnpm 管理器数据，避免清理后的显示仍然陈旧。

这个切片应该保留现有 pnpm store/global modules 的 hardlink 去重统计语义。清理行为应描述为 prune 不再引用的 store 内容，而不是直接删除整个 store 目录。

## Acceptance criteria

- [x] pnpm store 信息附近暴露清晰的 store prune 按钮或图标。
- [x] store prune 入口只出现在 pnpm store 信息，不影响其他包管理器。
- [x] 点击 store prune 会在执行 pnpm 前打开显式确认步骤。
- [x] 确认后调用 allowlisted pnpm store prune 后端操作。
- [x] 取消确认不会执行任何后端维护操作。
- [x] store prune 运行期间，相关操作展示 pending 状态并阻止重复提交。
- [x] 成功 store prune 通过现有 app message/banner 风格展示成功反馈。
- [x] 成功 store prune 刷新 pnpm store 大小或 pnpm 管理器数据，使显示的 store 占用更新。
- [x] 失败 store prune 展示有用错误信息，不隐藏已有 pnpm 扫描数据。
- [x] pnpm store/global modules 继续使用 hardlink 去重统计，避免重复计算同一物理文件。
- [x] UI 文案清楚表达这是 pnpm store prune，不是直接删除整个 store 目录。
- [x] 前端测试覆盖确认门禁、成功执行、失败反馈、pending 状态、重复点击防护和 store 大小刷新行为。
- [x] README 安全边界和功能文档不再把 pnpm store 清理描述为只能复制命令或完全 out of scope。

## Blocked by

- .scratch/pnpm-package-store-actions/issues/01-add-pnpm-maintenance-execution-allowlist.md

## Comments

- Completed implementation. Verified with `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
