Status: done

# FVM tab 骨架与探针

## What to build

新增第 12 个管理器 FVM 的端到端骨架：tab 可见、可扫描、可处理空态。探针只运行 `fvm --version`；成功即 Ready，`fvm` 缺失即 Missing 并记录失败（此时包与路径均为空，不猜测默认目录）。已安装但零版本时为 Ready 空列表。

管理器排序在末位（Uv 之后），展示名为 FVM。存量“启用管理器”偏好自动补上 FVM 为启用（新用户默认全开不变）；用户仍可手动关闭 FVM。

本切不解析版本清单、不展示路径占用（留给后续纵切），但扫描 plumbing（含命令记录与超时口径）一次到位。

## Acceptance criteria

- [ ] FVM tab 可见且排序在末位，展示名为 FVM。
- [ ] `fvm` 缺失时状态为 Missing，包与路径为空并记录失败。
- [ ] 零版本时状态为 Ready 且为空列表。
- [ ] 存量偏好自动补上 FVM 为启用；关闭后 tab 隐藏且扫描不受影响。
- [ ] Rust 单测覆盖探针成功/缺失与零版本空列表。
- [ ] 前端测试覆盖排序、标签与偏好迁移。

## Blocked by

None - can start immediately
