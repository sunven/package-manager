Status: done

# FVM 路径与目录占用

## Parent

.scratch/fvm-support/PRD.md

## What to build

FVM tab 展示两个路径：FVM 版本目录与 FVM git 缓存，路径取自 `fvm api context`。每个路径的占用由应用现有磁盘遍历口径实测（hardlink 去重），`api list` 自报的尺寸字符串不展示。fvmDir 本体不单独成行，避免与两个子目录重复计量。

本切无清理入口（v1 无清理方案，见 PRD），只观察占用。

## Acceptance criteria

- [ ] 版本目录与 git 缓存各占一行，路径来自 `fvm api context`。
- [ ] 两行占用均为实测值；无“可回收空间”类表述。
- [ ] fvmDir 本体不单独列出。
- [ ] 路径缺失或不可读时保留记录并显示原因，不伪装成零占用。
- [ ] Rust 单测覆盖路径解析与测量失败保留记录。
- [ ] 前端测试覆盖两行渲染与占用展示。

## Blocked by

- .scratch/fvm-support/issues/01-tab-skeleton.md
