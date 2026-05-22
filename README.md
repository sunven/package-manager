# Package Manager Control Center

一个个人自用的 Tauri 桌面工具，用来查看本机 npm、pnpm、Yarn、Homebrew、Maven 和 pip 的包、缓存/仓库占用情况，以及 Homebrew、Maven、pip 的维护信号。

当前 v1 目标是 **read-only + safe actions**：默认只扫描和展示信息，可以复制命令、复制路径、打开目录；不直接执行卸载、清缓存、批量删除等破坏性操作。

## 功能

- 扫描 npm、pnpm、Yarn、Homebrew、Maven、pip。
- 查看全局安装的包名、版本、包路径。
- 查看 cache / store / global modules 等路径。
- 统计 cache / store 总占用空间。
- pnpm store/global modules 使用 hardlink 去重统计，避免重复计算同一物理文件。
- Yarn Classic 支持全局包列表。
- Yarn modern 标记为 unsupported，只展示可解析的缓存信息。
- Homebrew 支持 formula/cask 清单、outdated、leaves、cleanup dry-run、prefix/cache/cellar 路径。
- Maven 支持本地仓库路径、artifact/version 统计、重复版本、snapshot 信号和 repository 级空间统计。
- pip 支持当前 Python interpreter 的 installed/outdated package、editable/direct-url/user-site 信号、cache/site-packages 路径。
- 复制路径、复制扫描命令、复制包名版本。
- 复制 Homebrew 维护命令，如 `brew upgrade <formula>`、`brew upgrade --cask <cask>`、`brew cleanup --dry-run`。
- 复制 Maven/pip 维护命令，如 `mvn dependency:tree -Dincludes=...`、`python3 -m pip show <pkg>`、`python3 -m pip install --upgrade <pkg>`。
- 打开 cache / store / package 目录。
- 展示扫描失败、缺少二进制、权限问题、命令超时等诊断信息。

## 当前边界

- 主要面向 macOS 自用。
- 不做后台自动刷新。启动时扫描一次，之后手动刷新。
- 不做 per-package size，只展示 manager/path 级别总大小。
- 不直接执行危险操作：
  - 不直接 uninstall 全局包
  - 不直接 clean cache/store
  - 不直接执行 `brew cleanup`
  - 不直接执行 `brew upgrade`
  - 不做批量删除
- Yarn 2+ 没有 npm/pnpm/Yarn Classic 等价的全局包列表，因此不伪装出一个全局列表。
- Homebrew leaves 只标记为 review candidate，不等于“安全删除”。
- Maven v1 是本地仓库健康检查，不是全局 Java 包管理器。
- pip v1 只扫描当前 Python interpreter，不递归发现全机器所有 virtualenv。
- pip outdated 单独后台加载；离线或 index 超时时不影响 installed package 展示。

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

前端状态测试：

```bash
pnpm test
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

brew --version
brew list --formula --versions
brew list --cask --versions
brew outdated --json=v2
brew leaves
brew --prefix
brew --cache
brew --cellar
brew cleanup --dry-run

mvn --version

python3 --version
python3 -c "import sys; print(sys.executable)"
python3 -m pip --version
python3 -m pip list --format=json
python3 -m pip cache dir
python3 -m pip cache info
python3 -m pip inspect --local
python3 -m pip list --outdated --format=json
```

如果命令缺失、失败、输出无法解析或超时，界面会显示诊断信息。

Homebrew 扫描会禁用 auto-update，避免只读扫描触发 Homebrew 更新。`brew cleanup --dry-run` 不阻塞首屏扫描；Homebrew tab 先展示已安装、outdated、leaves 和路径，再单独加载 cleanup dry-run 预览。

Maven 扫描只运行 `mvn --version` 做检测；本地仓库路径优先从 `~/.m2/settings.xml` 和 Maven home 的 `conf/settings.xml` 读取顶层 `localRepository`，不会运行可能下载插件的 `mvn help:evaluate`。扫描本地仓库时有时间、version 目录数、返回行数上限，超限会显示 partial 状态。

pip 扫描优先使用 `python3 -m pip`，回退到 `python -m pip`。`pip list --outdated` 可能访问 index，因此不阻塞首屏；pip tab 先显示 installed/cache/inspect 信息，再单独合并 outdated 信号。

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
- 自动执行 Homebrew upgrade、cleanup、uninstall。
- 自动执行 Maven purge/get/tree 命令。
- 自动执行 pip uninstall、upgrade、cache purge。

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
pnpm test
```

`cargo test` 当前覆盖：

- npm 无 dependencies 时返回空列表
- npm 正常解析和排序
- pnpm array 输出解析
- Yarn Classic JSON tree 输出解析
- Yarn Classic human fallback
- scoped package 版本拆分
- hardlink 去重统计
- Homebrew formula/cask JSON 解析
- Homebrew outdated/leaves 合并
- Homebrew Missing/Partial 状态
- Homebrew cleanup dry-run raw output 和空间估算
- Maven settings localRepository 解析和 secret 忽略
- Maven 本地仓库 coordinate、重复版本、snapshot 统计
- pip list/outdated/inspect 解析和 enrichment
- pip outdated 前端 hydration token 防旧结果写回

## 后续候选

- 复制 `npm uninstall -g <pkg>` / `pnpm remove -g <pkg>` / `yarn global remove <pkg>` 命令。
- 复制 cache clean 命令，但不直接执行。
- Homebrew services / doctor / Brewfile。
- 增加操作日志。
- 增加搜索和排序。
- 增加 README 截图。
