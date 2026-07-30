# Package Manager Control Center

一个个人自用的 Tauri 桌面工具，用来查看本机 npm、pnpm、Yarn、nvm、Homebrew、Maven、pip、Cargo、Docker、Bun 和 uv 的包、缓存/仓库占用情况，以及 Homebrew、Maven、pip、Docker 的维护信号。

当前目标是 **observe first, then act**：默认只扫描和展示信息，可以复制命令、复制路径、打开目录；其中 8 个管理器支持确认后执行 allowlisted 的缓存清理。

清理的安全性是结构性的，不靠弹窗次数保证：**删除动作一律委托给管理器自己的 CLI**，本工具从一张 Rust 静态表里挑选 allowlisted 子命令，自己不删文件（唯一例外是 npm 的 `_npx`，带路径身份断言）。因此 nvm、Maven、Cargo **没有清理能力**——它们没有任何官方子命令能清自己的缓存。详见 [ADR-0001](./docs/adr/0001-delegated-cache-cleanup.md)。

术语定义见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [docs/adr/](./docs/adr/)。

## 功能

- 扫描 npm、pnpm、Yarn、nvm、Homebrew、Maven、pip、Cargo、Docker、Bun、uv。
- 查看全局安装的包名、版本、包路径。
- 查看 cache / store / global modules 等路径。
- 统计 cache / store 总占用空间。
- pnpm store/global modules 使用 hardlink 去重统计，避免重复计算同一物理文件。
- Yarn Classic 支持全局包列表。
- Yarn modern 标记为 unsupported，只展示可解析的缓存信息。
- nvm 支持从 `NVM_DIR` 或 `~/.nvm` 读取已安装 Node 版本、nvm 根目录和 Node versions 目录。
- Homebrew 支持 formula/cask 清单、outdated、leaves、cleanup dry-run、prefix/cache/cellar 路径。
- Maven 支持本地仓库路径、artifact/version 统计、重复版本、snapshot 信号和 repository 级空间统计。
- pip 支持当前 Python interpreter 的 installed/outdated package、editable/direct-url/user-site 信号、cache/site-packages 路径。
- Cargo 支持 `cargo install --list` 的已安装二进制 crate、Cargo bin、registry cache/source、git cache/checkouts 路径。
- Docker 支持镜像/容器/卷清单、运行中容器数、dangling 与未使用镜像统计、`docker system df` 的 reclaimable 空间、config/buildx/Desktop data 路径。
- Bun 支持全局包列表、Bun 安装目录与缓存目录。
- uv 支持已安装工具、uv 管理的 Python 版本、tools/pythons/cache 三个路径。
- 复制路径、复制扫描命令、复制包名版本。
- 复制 Homebrew 维护命令，如 `brew upgrade <formula>`、`brew upgrade --cask <cask>`、`brew cleanup --dry-run`。
- 复制 Maven/pip 维护命令，如 `mvn dependency:tree -Dincludes=...`、`python3 -m pip show <pkg>`、`python3 -m pip install --upgrade <pkg>`。
- 复制 Cargo 维护命令，如 `cargo install <crate>`、`cargo uninstall <crate>`。
- 复制 nvm 切换命令，如 `nvm use <version>`。
- 确认后执行全局包卸载：`npm uninstall -g <pkg>`、`pnpm remove --global <pkg>`。
- 确认后执行缓存清理，覆盖 8 个管理器：
  - npm：`npm cache clean --force`，然后带护栏删除 `_npx` 目录
  - pnpm：`pnpm store prune`
  - Yarn：`yarn cache clean`
  - pip：`<python> -m pip cache purge`（解释器执行时重新解析）
  - Bun：`bun pm cache rm`
  - uv：`uv cache prune`（不传 `--force`，保留 uv 自己的 in-use 检查）
  - Homebrew：`brew cleanup`（确认前展示 dry-run 的逐条清单和确切可回收量）
  - Docker：`docker builder prune -f` → `docker image prune -f`
- 多步骤清理如实汇报「全部成功 / 部分完成 / 完全失败」，不会在缓存已清空时谎报失败。
- 健康页的建议条目可跳转到对应管理器 tab（只跳转，不在健康页执行）。
- 打开 cache / store / package 目录。
- 展示扫描失败、缺少二进制、权限问题、命令超时等诊断信息。

## 当前边界

- 主要面向 macOS 自用。
- 不做后台自动刷新。启动时扫描一次，之后手动刷新。
- 不做 per-package size，只展示 manager/path 级别总大小。
- 只有 npm 和 pnpm 支持确认后卸载全局包；其他管理器不做 uninstall。
- 缓存清理覆盖 8 个管理器。**nvm、Maven、Cargo 没有清理能力，这是有意的架构决定**，不是遗漏：三者都没有官方子命令能清自己的缓存，做它们就意味着本工具自己 `rm -rf` 推导出来的路径。要改先撤销 [ADR-0001](./docs/adr/0001-delegated-cache-cleanup.md)。
- Homebrew 清理有意超出「只清缓存」的范围：`brew cleanup` 会连带删除已安装 formula 的旧版本（当前版本不受影响）。理由和边界见 [ADR-0002](./docs/adr/0002-homebrew-cleanup-exceeds-cache-scope.md)。
- 不做跨管理器的批量清理，也不在健康页直接执行。
- 不直接执行 `brew upgrade`。
- Docker 只清构建缓存和 dangling 镜像；不做 `docker image prune -a`、不做 `docker system prune`、不删容器、不删卷。
- Yarn 2+ 没有 npm/pnpm/Yarn Classic 等价的全局包列表，因此不伪装出一个全局列表。
- nvm 是 Node 版本管理器，v1 只展示已安装的 Node runtime 版本，不把每个 Node 版本里的 npm 全局包混入 nvm tab。
- Homebrew leaves 只标记为 review candidate，不等于“安全删除”。
- Maven v1 是本地仓库健康检查，不是全局 Java 包管理器。
- pip v1 只扫描当前 Python interpreter，不递归发现全机器所有 virtualenv。
- pip outdated 单独后台加载；离线或 index 超时时不影响 installed package 展示。
- Cargo v1 只扫描 `cargo install --list` 暴露的已安装二进制 crate 和 Cargo Home 路径，不递归发现全机器所有 Rust 项目依赖。
- Cargo v1 不管理 rustup toolchain。

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

npm maintenance actions:
npm uninstall -g <pkg>

npm cleanup plan:
npm cache clean --force
(then a guarded deletion of <npm cache>/_npx)

pnpm --version
pnpm list -g --depth=0 --json
pnpm store path
pnpm root -g

pnpm maintenance actions:
pnpm remove --global <pkg>

pnpm cleanup plan:
pnpm store prune

yarn --version
yarn global list --json
yarn cache dir
yarn global dir
yarn config get cacheFolder

nvm:
read $NVM_DIR or ~/.nvm
scan versions/node/v*

brew --version
brew list --formula --versions
brew list --cask --versions
brew outdated --json=v2
brew leaves
brew --prefix
brew --cache
brew --cellar
brew cleanup --dry-run

Yarn cleanup plan:
yarn cache clean

Homebrew cleanup plan:
brew cleanup

pip cleanup plan:
<python> -m pip cache purge

Bun cleanup plan:
bun pm cache rm

uv cleanup plan:
uv cache prune

Docker cleanup plan:
docker builder prune -f
docker image prune -f

nvm / Maven / Cargo: no cleanup plan (ADR-0001)

mvn --version

python3 --version
python3 -c "import sys; print(sys.executable)"
python3 -m pip --version
python3 -m pip list --format=json
python3 -m pip cache dir
python3 -m pip cache info
python3 -m pip inspect --local
python3 -m pip list --outdated --format=json

cargo --version
cargo install --list
```

如果命令缺失、失败、输出无法解析或超时，界面会显示诊断信息。

Homebrew 扫描会禁用 auto-update，避免只读扫描触发 Homebrew 更新。`brew cleanup --dry-run` 不阻塞首屏扫描；Homebrew tab 先展示已安装、outdated、leaves 和路径，再单独加载 cleanup dry-run 预览。

nvm 扫描不运行 `nvm` 命令，因为 nvm 通常是 shell function，不是可直接 spawn 的二进制；后端只读取 `NVM_DIR` 或 `~/.nvm` 下的 `versions/node/v*` 目录，并为每个 Node 版本提供复制 `nvm use <version>` 的命令。

Maven 扫描只运行 `mvn --version` 做检测；本地仓库路径优先从 `~/.m2/settings.xml` 和 Maven home 的 `conf/settings.xml` 读取顶层 `localRepository`，不会运行可能下载插件的 `mvn help:evaluate`。扫描本地仓库时有时间、version 目录数、返回行数上限，超限会显示 partial 状态。

pip 扫描优先使用 `python3 -m pip`，回退到 `python -m pip`。`pip list --outdated` 可能访问 index，因此不阻塞首屏；pip tab 先显示 installed/cache/inspect 信息，再单独合并 outdated 信号。

Cargo 扫描只运行 `cargo --version` 和 `cargo install --list`。`CARGO_HOME` 优先来自环境变量，未设置时回退到 `~/.cargo`。Cargo tab 会展示 `bin`、`registry/cache`、`registry/src`、`git/db`、`git/checkouts` 路径；不会运行可能访问网络或修改磁盘的 `cargo search`、`cargo update`、`cargo install`、`cargo uninstall`、`cargo cache`。

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
- 确认后执行 allowlisted 全局包卸载：`npm uninstall -g <pkg>`、`pnpm remove --global <pkg>`。
- 确认后执行 allowlisted 缓存清理，命令固定在 Rust 静态表里（见上方功能列表）。
- 带路径身份断言地删除 npm 的 `_npx` 目录：断言绝对路径、以 `npm config get cache` 的返回值为前缀、basename 恰为 `_npx`，任一条不满足就报失败而不继续。

清理的执行边界：

- 后端只暴露一个入口 `run_cache_cleanup(managerId)`。前端能传的只有一个 11 值枚举，**在语法上无法表达"执行哪条命令"**，allowlist 因此是类型系统的性质而不是约定。
- 结构化 args，不拼 shell string。
- 清理专用 300 秒超时，与扫描的 5–15 秒、卸载的 30 秒分开——避免"缓存很大"被误报成"超时"，而超时会 kill 子进程、留下删了一半的状态。
- 多步骤方案遇错即停，并区分「部分完成」和「完全失败」。

当前不允许的行为：

- 除 `_npx` 外自行删除任何文件或目录。
- 为 nvm、Maven、Cargo 提供清理（ADR-0001）。
- 跨管理器的批量清理，或从健康页直接执行。
- `docker image prune -a`、`docker system prune`、删除容器、删除卷。
- 给 uv 传 `--force`（那会绕过 uv 自己的 in-use 检查）。
- 给 `brew cleanup` 加 `--prune`、`--scrub`、`--prune-prefix`。
- 卸载非 npm/pnpm 的全局包。
- 修改任何管理器的配置。
- 自动执行 `nvm install`、`nvm use`、`nvm uninstall`。
- 自动执行 Homebrew upgrade、uninstall。
- 自动执行 Maven purge/get/tree 命令。
- 自动执行 pip uninstall、upgrade。
- 自动执行 Cargo install、uninstall、update、search、cache 命令。
- 后台或定时清理。
- 操作日志与撤销：清理对象限定为可重建的派生数据，事后取证换不到安全收益。

新增管理器的清理能力，只需在 Rust 静态表和 `src/cleanupCopy.ts` 各加一条；新增"自行删除目录"这类例外，需要和 `_npx` 同等强度的身份断言论证。

## 项目结构

```text
src/
  main.tsx         React entry
  App.tsx          前端应用骨架
  components/      React UI 组件
  hooks/           Tauri 扫描、hydration、复制/打开行为
  utils/           展示文案、筛选和格式化工具
  styles.css       Tailwind 入口和全局基础样式
  state.ts         前端状态纯函数
  cleanupCopy.ts   每个管理器的清理文案、按钮位置、回收量来源

src-tauri/
  src/lib.rs       Tauri command 定义与注册
  src/command.rs   结构化命令执行、超时、失败分类
  src/disk_usage.rs 文件系统遍历与 hardlink 去重
  src/types.rs     跨边界的数据类型
  src/managers/    各管理器 adapter；cleanup.rs 是清理方案静态表与执行器
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

`cargo test` 当前覆盖（74 项）：

- npm 无 dependencies 时返回空列表
- npm 正常解析和排序
- npm 全局包卸载的结构化执行、scoped package 卸载和失败反馈
- pnpm array 输出解析
- pnpm 全局包卸载的结构化执行和 scoped package 卸载
- pnpm 不再接受 storePrune 载荷（清理已移到方案表，避免留下第二条路径）
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
- Cargo install-list 解析、Cargo Home 推导、Cargo Missing/Ready 状态
- Cargo registry/git 路径计数规则和前端标签
- nvm 目录推导、Node 版本目录解析、缺失目录状态和前端标签
- 8 个清理方案的精确 `(program, args)`（table-driven）
- nvm / Maven / Cargo 解析为「无清理方案」，且不执行任何命令
- uv 参数不含 `--force` / `clean` / `--ci`
- Docker 参数不含 `-a` / `--all` / `system` / `--volumes` / `container` / `volume`
- Homebrew 参数恰为 `cleanup`，不含额外 prune 开关
- 多步骤方案的全部成功 / 首步失败（后续 Skipped）/ 后续步骤失败（部分完成）
- `_npx` 护栏：相对路径被拒、空 cache 值被拒、basename 不符被拒、合法路径通过
- 空 cache 值永远不会到达删除函数
- pip 在内部解析解释器、`python3` → `python` 回退、解析失败时 pip 不运行
- 清理步骤使用 300 秒超时而非扫描超时

`pnpm test` 当前覆盖（73 项），清理相关部分：

- 清理文案表：无方案管理器缺席、按钮只挂在拥有它的路径卡片上
- 全清型显示实测占用；prune 型（pnpm / uv）不显示数字并给出说明
- Homebrew 的回收量取自 dry-run 而非路径占用，并展示逐条清单
- Homebrew 在 dry-run 落地前不提供执行入口
- Docker 只展示本次会清理的资源类型，卷被排除
- 部分完成渲染为 warn 而非失败，弹窗保持打开
- Yarn 2+ 在 `Unsupported` 下仍有清理入口；管理器 `Missing` 时没有
- 健康页建议只跳转、不执行，也没有批量入口

## 后续候选

- Homebrew services / doctor / Brewfile。
- Rust project dependency discovery / rustup toolchain inventory。
- 增加搜索和排序。
- 增加 README 截图。
