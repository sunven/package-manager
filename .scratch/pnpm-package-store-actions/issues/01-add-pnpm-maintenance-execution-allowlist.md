Status: done

# 添加 pnpm 维护操作执行白名单

## Parent

.scratch/pnpm-package-store-actions/PRD.md

## What to build

添加 pnpm 维护操作的后端结构化执行入口。应用只能请求两类 pnpm 操作：卸载选中的全局包，以及清理 pnpm store 中不再引用的内容。执行入口必须接收结构化操作数据，不能接收任意程序、shell 字符串或任意参数，并且必须用结构化参数调用 pnpm。

这个切片让 pnpm 维护操作可以被安全执行，但不要求最终 UI 按钮在本切片完成。

## Acceptance criteria

- [x] 后端暴露 pnpm 全局包卸载维护操作。
- [x] 后端以 pnpm 全局 remove 参数和选中包名执行包卸载。
- [x] scoped package name 作为单个结构化参数正确传递。
- [x] 后端暴露 pnpm store prune 维护操作。
- [x] 后端以 pnpm store prune 参数执行 store 清理。
- [x] 前端不能通过该 pnpm 维护 API 传任意程序、shell 字符串或任意参数。
- [x] 成功操作返回足够的结构化结果，供 UI 展示成功并决定刷新范围。
- [x] 失败操作返回足够的失败信息，供 UI 展示有用错误。
- [x] 正常 pnpm 扫描行为保持只读，不执行卸载或 store prune。
- [x] Rust 测试覆盖成功卸载、失败卸载、scoped package 卸载、成功 store prune、失败 store prune，以及无法执行任意命令。

## Blocked by

None - can start immediately

## Comments

- Completed implementation. Verified with `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
