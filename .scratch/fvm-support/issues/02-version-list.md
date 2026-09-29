Status: done

# Flutter 版本清单与信号

## Parent

.scratch/fvm-support/PRD.md

## What to build

FVM tab 列出本机全部 Flutter 版本：一行一个 Flutter 版本，展示版本名、Flutter SDK 版本及其捆绑 Dart 版本、安装目录。数据源为 `fvm api list` 的机器可读 JSON，不解析人类表格。

信号：全局默认（global 指向）的版本挂 Current；出现在未引用集合中的版本挂 Unused；其余无信号。v1 不提供 Outdated 信号。全局默认未设置时不挂 Current，也不报错。

每行提供 `fvm global <version>` 的复制动作（仅复制，不执行）；`fvm use` v1 不提供。tab 级记录实际执行的扫描命令以备查。

## Acceptance criteria

- [ ] 每个已安装 Flutter 版本各占一行，含版本名、Dart 版本与安装目录。
- [ ] 全局默认版本挂 Current；未引用版本挂 Unused；无全局默认时无 Current 且不报错。
- [ ] 每行可复制 `fvm global <version>`；无任何执行入口。
- [ ] Rust 单测覆盖 JSON 解析、信号映射与全局默认缺席。
- [ ] 前端测试覆盖行渲染、信号展示与复制动作。

## Blocked by

- .scratch/fvm-support/issues/01-tab-skeleton.md
