Status: done

# FVM 边界行为与文档收尾

## Parent

.scratch/fvm-support/PRD.md

## What to build

收尾纵切：补齐 v1 边界行为并更新文档。探针通过但任一查询接口失败时状态为 Partial 并记录失败；超时沿用探针 5 秒、清单 15 秒口径；项目级 `.fvmrc`/`.fvm` 目录 v1 不扫描，项目派生数据扫描也不触碰它们。

文档更新 README 的功能列表、边界说明、扫描命令表与管理器计数；术语沿用 CONTEXT.md 既有词汇，不新增 ADR（NoPlan 系 ADR-0001 的直接应用）。

## Acceptance criteria

- [ ] 查询接口失败时为 Partial 并记录失败，已有数据继续展示。
- [ ] 超时口径与既有管理器一致，超时归类为超时失败而非静默缺失。
- [ ] 项目级 `.fvmrc`/`.fvm` 不被扫描也不纳入项目清理。
- [ ] README 功能、边界、扫描命令、计数描述与实现一致。
- [ ] `cargo test`、`pnpm test`、`pnpm build` 全过。

## Blocked by

- .scratch/fvm-support/issues/02-version-list.md
- .scratch/fvm-support/issues/03-paths-usage.md
