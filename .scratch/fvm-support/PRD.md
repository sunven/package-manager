# FVM 只读观察（v1）

状态：grill 已收敛，拆分为 4 个纵切实施。

## 目标

让用户看清本机 FVM 及已安装的 Flutter 版本、全局默认标记、版本目录占用。首版只读展示，不执行 install/use/remove，不提供清理执行能力。

术语以 [CONTEXT.md](../../CONTEXT.md) 中的「管理器」「快照」「信号」「Flutter 版本」「目录占用」「清理」「卸载」为准。

## 已确认的决策（grill-with-docs，2026-09-29）

- 范围：v1 只做只读观察，对标 nvm。
- 对象：包列表每行即一个 Flutter 版本（FVM 管理的单个 Flutter SDK 安装，自带对应 Dart；Dart 不单独建术语）。
- 数据源：`fvm --version` 探针；版本清单用 `fvm api list`；路径用 `fvm api context`。`fvm` 缺失即 Missing。
- 信号：global 指向的版本挂 Current；出现在 unreferencedVersions 中的挂 Unused；v1 不做 Outdated。
- 路径：展示版本目录 + git 缓存两行，各自 Rust 实测占用；`api list` 自报 size 不展示；不单列 fvmDir 本体。
- 复制命令：行级只给 `fvm global <version>`；`fvm use` v1 不给；tab 级记录扫描命令。
- 清理：v1 无清理方案（对标 nvm/Maven/Cargo 的 NoPlan，见 ADR-0001）。`fvm remove` 按卸载对待、`fvm destroy` 永不接入，留 v2 另议。
- 类型：ManagerId::Fvm（展示 "FVM"）；PackageKind::FlutterVersion；PathKind::FvmVersions + FvmGitCache；排序末位（Uv 之后）。
- 存量偏好：自动补上 FVM 为启用，用户可手动关闭。
- 边界：未安装→Missing 无路径；零版本→Ready 空列表；api 失败→Partial；无 global→无 Current 不报错；不碰项目级 `.fvmrc`/`.fvm`；超时 5s probe / 15s list。
- ADR：v1 不新建 ADR（NoPlan 是 ADR-0001 的直接应用）。

## 验证基线（实测本机 fvm 4.3.1）

- `fvm api list` 返回 1 个版本（3.47.5，Dart 3.13.4），projects 1 个，unreferenced 为空。
- `fvm api context` 给出 fvmDir、versionsCachePath、gitCachePath、globalCacheLink。
- `fvm list` 人类表格自报版本目录 1.51 GB。
