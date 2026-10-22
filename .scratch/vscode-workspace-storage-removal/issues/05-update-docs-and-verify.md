Status: ready-for-human

# 更新能力文档并完成端到端验证

## Parent

.scratch/vscode-workspace-storage-removal/PRD.md

## What to build

把「VS Code 占用」从只读观察更新为观察 + 移除，并用真实应用完成一次端到端验证。文档和自动化检查可以由代理完成；打开/退出 VS Code、检查系统废纸篓和真实磁盘占用需要人来做。

### 文档

- `README.md`
  - 能力清单中「VS Code 占用」不再写成只读；说明只移除 `workspaceStorage` 中「路径不存在 / 未识别」的普通目录。
  - 安全说明中补充：要求 VS Code 退出；执行时逐条复核；移入系统废纸篓，清空废纸篓前可恢复，不立即释放磁盘空间；项目路径恢复时跳过。
  - 维护记录说明中补充：VS Code 工作区存储移除不写入维护记录。
- `PRODUCT.md`
  - 更新「VS Code 占用」的能力描述，去掉「不提供清理或删除」的绝对表述。
- `.scratch/vscode-workspace-storage/PRD.md`
  - 在状态行附近加一行指向本功能：`后续版本增加工作区存储移除，见 .scratch/vscode-workspace-storage-removal/PRD.md`。
  - 保留「首版只读」等历史描述，标明它们是首版记录，不改写成现在也适用。
- `CONTEXT.md`
  - 核对「VS Code 占用」「可移除工作区存储记录」「VS Code 工作区存储移除」三个词条与实现一致；如果实现改动了资格边界，同步修正词条，但不要把实现细节写进术语表。
- 确认没有新增「VS Code 清理」「VS Code 缓存清理」这类被术语表避免的说法。

### 自动化检查

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm test`
- `pnpm build`

全部通过后，在 issue 的 `## Comments` 记录通过数量和构建结果。

### 端到端验证

1. 退出 VS Code，运行 `pnpm tauri dev`，打开「VS Code 占用」，刷新。
2. 确认四张汇总卡片不变；「路径存在」行复选框禁用，「路径不存在」「未识别工作区」行可用。
3. 单选一条「路径不存在」，点击「移除 1 项」，检查确认框：条数、合计占用、目标列表、四项风险说明、按钮文案。
4. 确认执行，观察进度；结束后确认：
   - 结果区显示已移入/跳过/失败。
   - 页面自动刷新，该记录从清单消失。
   - 系统废纸篓中存在对应的 `workspaceStorage/<id>` 目录；原目录不再存在。
   - 磁盘可用空间不要求立即增加。
5. 从废纸篓恢复该目录，刷新页面，确认记录重新出现，且仍可再次移除。
6. 启动 VS Code，刷新页面：出现「VS Code 正在运行」横幅，移除按钮禁用；尝试点击不会打开确认框。退出 VS Code，刷新后恢复可用。
7. 多选包含「未识别工作区」的记录，确认后逐项结果与废纸篓内容一致。
8. 确认 `workspaceStorage` 根目录、其他记录和项目源码未被改动。
9. 可选：用可注入的 Rust 测试结果代替「外接盘重新挂载」场景；不要为了手测修改真实的 VS Code 数据。

### 记录

- 在 `.scratch/vscode-workspace-storage-removal/PRD.md` 增加「验证记录」，写明日期、扫描到的记录数/占用量、移除条数、实际结果和命令结果。
- 如果端到端验证发现实现与 PRD 不一致，先修代码或先改 PRD，不要让文档和实现分叉。

## Acceptance criteria

- [ ] README 和 PRODUCT 不再声称该页面完全只读；旧 PRD 已注明后续能力，CONTEXT 的口径已更新。
- [ ] 文档明确写出：只移除 Missing/Unknown 的普通目录、要求 VS Code 退出、进废纸篓、执行时复核、不写维护记录。
- [ ] `cargo test`、`pnpm test`、`pnpm build` 全部通过。
- [ ] 完成一次真实的单条移除，并在系统废纸篓中确认目标。
- [ ] 从废纸篓恢复后刷新，记录重新出现。
- [ ] VS Code 运行中横幅和禁用行为符合预期。
- [ ] 多选移除（至少包含一条 Unknown）结果与废纸篓内容一致。
- [ ] `workspaceStorage` 根目录、其他记录和项目源码没有被改动。
- [ ] PRD 的验证记录已填写，状态更新为「已实现并验证」。

## Blocked by

- .scratch/vscode-workspace-storage-removal/issues/04-wire-vscode-removal-into-page.md

## Comments (2026-10-22)

- Updated `README.md`, `PRODUCT.md`, the old VS Code PRD link, and the PRD verification record. `CONTEXT.md` was updated during design.
- Automated checks: `cargo test` 308 passed / 10 ignored; `pnpm test` 49 files / 372 tests passed; `pnpm build` passed with the existing 792.99 kB chunk warning.
- Manual end-to-end verification is still pending: quit VS Code, run `pnpm tauri dev`, remove one Missing record, verify Finder Trash and recovery, then check the running-editor banner. The agent did not touch the user's VS Code data.
- Keep this issue `ready-for-human` until the manual checklist is completed.
