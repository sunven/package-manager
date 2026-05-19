# Package Manager Control Center

一个个人自用的 Tauri 桌面工具，用来查看本机 npm、pnpm、Yarn 的全局包和缓存/仓库占用情况。

当前 v1 目标是 **read-only + safe actions**：默认只扫描和展示信息，可以复制命令、复制路径、打开目录；不直接执行卸载、清缓存、批量删除等破坏性操作。

## 功能

- 扫描 npm、pnpm、Yarn。
- 查看全局安装的包名、版本、包路径。
- 查看 cache / store / global modules 等路径。
- 统计 cache / store 总占用空间。
- pnpm store/global modules 使用 hardlink 去重统计，避免重复计算同一物理文件。
- Yarn Classic 支持全局包列表。
- Yarn modern 标记为 unsupported，只展示可解析的缓存信息。
- 复制路径、复制扫描命令、复制包名版本。
- 打开 cache / store / package 目录。
- 展示扫描失败、缺少二进制、权限问题、命令超时等诊断信息。

## 当前边界

- 主要面向 macOS 自用。
- 不做后台自动刷新。启动时扫描一次，之后手动刷新。
- 不做 per-package size，只展示 manager/path 级别总大小。
- 不直接执行危险操作：
  - 不直接 uninstall 全局包
  - 不直接 clean cache/store
  - 不做批量删除
- Yarn 2+ 没有 npm/pnpm/Yarn Classic 等价的全局包列表，因此不伪装出一个全局列表。

## 开发环境

需要本机已有：

- Node.js
- pnpm
- Rust toolchain
- Tauri v2 所需的 macOS 构建环境

安装依赖：

```bash
pnpm install
```

开发运行：

```bash
pnpm tauri dev
```

前端构建检查：

```bash
pnpm build
```

Rust 测试：

```bash
cd src-tauri
cargo test
```

正式打包：

```bash
pnpm tauri build
```

打包产物：

```text
src-tauri/target/release/bundle/macos/Package Manager Control Center.app
src-tauri/target/release/bundle/dmg/Package Manager Control Center_0.1.0_aarch64.dmg
```

## 扫描方式

后端通过 Tauri command 执行结构化命令，不拼 shell string。每条命令都有 program、args、preview、timeout。

主要命令：

```text
npm --version
npm ls -g --depth=0 --json
npm config get cache
npm root -g

pnpm --version
pnpm list -g --depth=0 --json
pnpm store path
pnpm root -g

yarn --version
yarn global list --json
yarn cache dir
yarn global dir
yarn config get cacheFolder
```

如果命令缺失、失败、输出无法解析或超时，界面会显示诊断信息。

## 空间统计

空间统计由 Rust 遍历文件系统完成，不 shell out 到 `du`。

当前策略：

- 跳过 symlink。
- 遍历目录并统计文件、目录、跳过项。
- Unix/macOS 下使用 `dev + ino` 去重 hardlink。
- Unix/macOS 下使用 `metadata.blocks() * 512` 估算物理占用字节。

这对 pnpm store 很重要，因为 pnpm 大量使用 hardlink；不去重会明显高估空间。

## 安全策略

这个工具的默认策略是先可观察，再操作。

当前允许的行为：

- 运行只读扫描命令。
- 读取本机路径元数据并统计大小。
- 复制文本到剪贴板。
- 用系统 opener 打开本机目录。

当前不允许的行为：

- 自动删除文件。
- 自动清理 cache/store。
- 自动卸载全局包。
- 自动修改 npm/pnpm/yarn 配置。

以后如果加入执行能力，应优先做“生成命令并复制”，再考虑带确认弹窗、操作日志和 dry-run 的直接执行。

## 项目结构

```text
src/
  main.ts          前端交互和渲染
  styles.css       前端样式

src-tauri/
  src/lib.rs       Tauri command、package manager adapters、空间统计、单元测试
  src/main.rs      Tauri entry
  tauri.conf.json  Tauri 配置
  capabilities/    Tauri 权限配置
```

## 已验证

当前已通过：

```bash
pnpm build
cd src-tauri && cargo test
pnpm tauri dev
pnpm tauri build
```

`cargo test` 当前覆盖：

- npm 无 dependencies 时返回空列表
- npm 正常解析和排序
- pnpm array 输出解析
- Yarn Classic JSON tree 输出解析
- Yarn Classic human fallback
- scoped package 版本拆分
- hardlink 去重统计

## 后续候选

- 复制 `npm uninstall -g <pkg>` / `pnpm remove -g <pkg>` / `yarn global remove <pkg>` 命令。
- 复制 cache clean 命令，但不直接执行。
- 增加操作日志。
- 增加搜索和排序。
- 增加 README 截图。
