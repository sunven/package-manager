Status: done

# 确认并执行 pnpm 全局包卸载

## Parent

.scratch/pnpm-package-store-actions/PRD.md

## What to build

从 pnpm 包表格添加完整的全局包卸载流程。每个 pnpm 全局包行都应该暴露明确的卸载按钮或图标。点击后先要求显式确认，再对选中的包执行 allowlisted pnpm 全局卸载操作，展示 pending、成功、失败反馈，并在成功后刷新 pnpm 管理器数据，让包表格反映当前全局包状态。

这个切片应该保留现有包检查行为，例如复制包名、复制维护命令、打开包路径、行选择和紧凑表格列展示。

## Acceptance criteria

- [x] pnpm 包行为每个全局包暴露清晰的卸载按钮或图标。
- [x] 卸载入口只出现在 pnpm 包行，不影响其他包管理器。
- [x] 点击卸载会在执行 pnpm 前打开显式确认步骤。
- [x] 确认后调用 allowlisted pnpm 包卸载后端操作，并传递选中的包名。
- [x] 取消确认不会执行任何后端维护操作。
- [x] 卸载运行期间，相关操作展示 pending 状态并阻止重复提交。
- [x] 成功卸载通过现有 app message/banner 风格展示成功反馈。
- [x] 成功卸载刷新 pnpm 管理器数据，使已移除的包在重新扫描后消失。
- [x] 失败卸载展示有用错误信息，不隐藏已有 pnpm 扫描数据。
- [x] 现有复制包名、复制包操作、行选择、打开路径行为继续可用。
- [x] 前端测试覆盖确认门禁、成功执行、失败反馈、pending 状态和重复点击防护。
- [x] README 安全边界和功能文档不再把 pnpm 全局包卸载描述为只能复制命令或完全 out of scope。

## Blocked by

- .scratch/pnpm-package-store-actions/issues/01-add-pnpm-maintenance-execution-allowlist.md

## Comments

- Completed implementation. Verified with `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
