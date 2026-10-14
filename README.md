# Package Manager Control Center

一个个人自用的 Tauri 桌面工具，用来查看本机 npm、pnpm、Yarn、nvm、Homebrew、Maven、pip、Cargo、Docker、Bun、uv 和 FVM 的包、缓存/仓库占用与维护信号，清理 Rust / Node 项目派生数据，以及查看 VS Code 占用和管理 Codex / Claude 会话记录。

当前目标是 **observe first, then act**：默认只扫描和展示信息，可以复制命令、复制路径、打开目录；其中 8 个管理器支持确认后执行 allowlisted 的缓存清理。

清理的安全性是结构性的：默认委托给拥有派生数据的 CLI；npm 的 `_npx` 和扫描会话授权的 Node `node_modules` 使用带路径身份检查的护栏删除。Rust 项目 `target` 通过固定参数的 `cargo clean` 清理。会话记录不可重建，因此独立处理并移入废纸篓。详见 [ADR-0001](./docs/adr/0001-delegated-cache-cleanup.md) 和 [ADR-0003](./docs/adr/0003-build-cleanup-uses-scan-session-candidates.md)。

术语定义见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [docs/adr/](./docs/adr/)。

## 功能

- 扫描 npm、pnpm、Yarn、nvm、Homebrew、Maven、pip、Cargo、Docker、Bun、uv、FVM。
- 总览展示已扫描／已启用数量、未扫描状态、维护建议与目录占用 Top 5；其他本机数据提供独立页面入口。
- 手动刷新当前管理器，或一次扫描所有已启用管理器；共享扫描队列最多同时处理 2 个管理器。
- 查看全局安装的包名、版本、包路径。
- 在当前管理器中按名称、版本、路径搜索，按名称或版本自然排序并切换升降序；可与已有信号筛选组合。
- 查看 cache / store / global modules 等路径。
- 测量各 cache / store 目录占用；读取不完整时标记为已测下限，不承诺清理后的实际释放量。
- pnpm store/global modules 使用 hardlink 去重统计，避免重复计算同一物理文件。
- Yarn Classic 支持全局包列表。
- Yarn modern 标记为 unsupported，只展示可解析的缓存信息。
- nvm 支持从 `NVM_DIR` 或 `~/.nvm` 读取已安装 Node 版本、nvm 根目录和 Node versions 目录。
- Homebrew 支持 formula/cask 清单、outdated、leaves、cleanup dry-run、prefix/cache/cellar 路径。
- Maven 支持本地仓库路径、artifact/version 统计、重复版本、snapshot 信号和 repository 级空间统计。
- pip 支持当前 Python interpreter 的 installed/outdated package、editable/direct-url/user-site 信号、cache/site-packages 路径。
- Cargo 支持 `cargo install --list` 的已安装二进制 crate、Cargo bin、registry cache/source、git cache/checkouts 路径。
- 从用户选择的根目录递归发现与 `Cargo.toml` 同级的 `target`，并行测量占用、筛选排序、确认后批量执行 `cargo clean --offline`。
- 同一扫描也发现与 `package.json` 同级的 `node_modules`，通过身份和完整测量检查后可确认永久清理。
- 保存多个扫描目录预设，每个预设保留独立深度；切换预设后重新扫描。
- Docker 支持镜像/容器/卷清单、运行中容器数、dangling 与未使用镜像统计、`docker system df` 的 reclaimable 空间、config/buildx/Desktop data 路径。
- Bun 支持全局包列表、Bun 安装目录与缓存目录。
- uv 支持已安装工具、uv 管理的 Python 版本、tools/pythons/cache 三个路径。
- FVM 支持已安装 Flutter 版本清单（含捆绑 Dart 版本）、全局默认标记、未引用标记、版本目录与 git 缓存路径。
- 复制路径、复制扫描命令、复制包名版本。
- 复制 Homebrew 维护命令，如 `brew upgrade <formula>`、`brew upgrade --cask <cask>`、`brew cleanup --dry-run`。
- 复制 Maven/pip 维护命令，如 `mvn dependency:tree -Dincludes=...`、`python3 -m pip show <pkg>`、`python3 -m pip install --upgrade <pkg>`。
- 复制 Cargo 维护命令，如 `cargo install <crate>`、`cargo uninstall <crate>`。
- 复制 nvm 切换命令，如 `nvm use <version>`。
- 复制 FVM 全局默认命令，如 `fvm global <version>`（仅复制，不执行 `fvm use`）。
- 确认后执行全局包卸载：`npm uninstall -g <pkg>`、`pnpm remove --global <pkg>`。
- 确认后执行缓存清理，覆盖 8 个管理器：
  - npm：`npm cache clean --force`，然后带护栏删除 `_npx` 目录
  - pnpm：`pnpm store prune`
  - Yarn：`yarn cache clean`
  - pip：`<python> -m pip cache purge`（解释器执行时重新解析）
  - Bun：`bun pm cache rm`
  - uv：`uv cache prune`（不传 `--force`，保留 uv 自己的 in-use 检查）
  - Homebrew：`brew cleanup`（确认前展示 dry-run 的逐条清单与 CLI 预演估算）
  - Docker：`docker builder prune -f` → `docker image prune -f`
- 多步骤清理如实汇报「全部成功 / 部分完成 / 完全失败」，不会在缓存已清空时谎报失败。
- 总览的建议条目可跳转到对应管理器 tab；更新、叶子包、多版本等信号是复核依据，不等于可安全删除。
- 打开 cache / store / package 目录。
- 展示应用 PATH、可执行文件解析路径、失败命令与输出；可复制检查命令，单独重试目录测量、Homebrew 预演或 pip 更新检查。
- 会话记录支持按标题、工作目录搜索，按使用状态筛选，并展示每条移除结果及跳过／失败原因。
- Codex 插件页展示已安装插件、版本、所属市场和用户默认启用设置，支持核对来源详情及确认后单个启用／禁用。

## 当前边界

- 主要面向 macOS 自用。
- 不做后台自动刷新。启动时只扫描首个已启用管理器，其他管理器首次进入时扫描，之后手动刷新；手动全量扫描仅覆盖已启用管理器。
- 不做 per-package size，只展示 manager/path 级别总大小。
- 只有 npm 和 pnpm 支持确认后卸载全局包；其他管理器不做 uninstall。
- 缓存清理覆盖 8 个管理器。**nvm、Maven、Cargo、FVM 的管理器缓存没有清理能力，这是有意的架构决定**，不是遗漏：nvm、Maven、Cargo 都没有官方子命令能清自己的缓存，做它们就意味着本工具自己 `rm -rf` 推导出来的路径；FVM 的 `fvm remove` 删除的是用户安装的 SDK（按卸载对待，需单独安全论证），`fvm destroy` 则超出本工具的能力范围。Rust 项目构建产物是独立功能，不计入 Cargo 管理器缓存或健康汇总。
- Rust 构建产物 v1 只认 `Cargo.toml` 同级、非符号链接且根级包含 `CACHEDIR.TAG` 或 `.rustc_info.json` 的 `target`；不解析自定义或共享 `target-dir`。
- Node 依赖目录只认常规文件 `package.json` 同级、非符号链接的 `node_modules`；扫描不深入依赖目录，清理不自动重新安装。
- Homebrew 清理有意超出「只清缓存」的范围：`brew cleanup` 会连带删除已安装 formula 的旧版本（当前版本不受影响）。理由和边界见 [ADR-0002](./docs/adr/0002-homebrew-cleanup-exceeds-cache-scope.md)。
- 不做跨管理器的批量清理，也不在健康页直接执行。
- 不直接执行 `brew upgrade`。
- Docker 只清构建缓存和 dangling 镜像；不做 `docker image prune -a`、不做 `docker system prune`、不删容器、不删卷。
- Yarn 2+ 没有 npm/pnpm/Yarn Classic 等价的全局包列表，因此不伪装出一个全局列表。
- nvm 是 Node 版本管理器，v1 只展示已安装的 Node runtime 版本，不把每个 Node 版本里的 npm 全局包混入 nvm tab。
- FVM 是 Flutter 版本管理器，v1 只展示已安装的 Flutter 版本、全局默认标记和版本目录占用，不执行 `fvm install/use/remove`，不提供清理方案，不扫描项目级 `.fvmrc`/`.fvm`。
- Homebrew leaves 只标记为 review candidate，不等于“安全删除”。
- Maven v1 是本地仓库健康检查，不是全局 Java 包管理器。
- pip v1 只扫描当前 Python interpreter，不递归发现全机器所有 virtualenv。
- pip outdated 单独后台加载；离线或 index 超时时不影响 installed package 展示。
- Cargo v1 只扫描 `cargo install --list` 暴露的已安装二进制 crate 和 Cargo Home 路径，不递归发现全机器所有 Rust 项目依赖。
- Cargo v1 不管理 rustup toolchain。

## VS Code 占用

独立的「VS Code 占用」页面只读扫描当前 macOS 用户的
`~/Library/Application Support/Code/User/workspaceStorage`，每个存储目录单独列出项目名称、项目位置、目录占用和识别状态。

- 首次进入页面时扫描，之后手动刷新；切换页面保留扫描结果。
- 默认按占用降序排列，可搜索项目名称、项目路径和存储目录。
- 项目路径不存在或映射无法识别的记录仍会列出并计入本页汇总；同项目的多份存储分别展示。
- 占用沿用磁盘分配量口径，读取不完整时展示已测得的下限；本页合计与管理器占用分开。
- 仅观察 VS Code 留下的工作区数据，不统计项目源码，不代表当前窗口或完整打开历史，不提供清理或删除。

## 项目扫描目录预设

- 添加目录后保存规范化路径与深度（0–32），再次添加同一路径复用已有预设。
- 深度编辑后点击「保存深度」或按 Enter，保存成功后用于下一次扫描。
- 旧版单根目录设置自动读取为一个预设；后续保存使用新版格式。
- 切换预设或移除当前预设会清空候选与选择，旧扫描授权失效；预设本身不保存候选或清理授权。
- 不可用目录仍保留在列表中并显示原因，恢复后重新选择即可验证。移除预设不会删除目录。
- 扫描或清理批次期间锁定预设操作；保存失败时保留原有设置。

## 会话记录

Codex 与 Claude 来源分别扫描、搜索、筛选和移除。搜索及使用状态筛选只影响当前列表；改变搜索或筛选会清空选择，「全选」仅选择当前可见且未在使用中的记录。

按年龄移除始终覆盖整个来源，以记录内容的最后活动时间为准，不受搜索条件影响。执行前重新检查记录身份、使用状态和年龄；明确选中的记录不因活动时间更新而自动取消移除。

结果分别显示已移入废纸篓、跳过和失败数量，并列出使用中、记录已失效、活动时间变化、无法确认活动时间或废纸篓操作失败等原因。来源级错误独立展示，不计作某一条记录失败。结果只保留于当前页面状态，不是持久操作历史。

## 开发环境

### Codex 插件管理

需要应用的 PATH 中有支持 `codex plugin list --json` 的 Codex CLI（已验证 0.162.1）。入口为侧栏「Codex 插件」，只管理当前 `CODEX_HOME`（默认 `~/.codex`）中的用户默认设置；使用相同目录的 CLI 与桌面 App 共用这份本地配置。

首次进入读取，之后手动刷新；不提供安装、更新、卸载或独立 skill 管理。配置未显式设置时显示未知，可确认后指定启用或禁用。保存前复核插件身份与目标设置，只更新该插件的 `enabled`，保留其他配置、注释和文件权限；检测到外部修改时要求重新确认。

保存成功不代表当前会话已生效，项目设置也可能覆盖用户默认值。配置读取失败时禁止修改；保存与后续刷新分别报告结果。接入边界见 [ADR-0011](./docs/adr/0011-codex-plugins-use-cli-inventory-and-user-config.md)。

### 运行与验证

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

nvm / Maven / Cargo / FVM: no cleanup plan (ADR-0001)

Rust build artifact cleanup:
cargo clean --offline --manifest-path <Cargo.toml> --target-dir <target>

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

fvm --version
fvm api context
fvm api list
```

如果命令缺失、失败、输出无法解析或超时，界面会显示诊断信息。

扫描分为排队、读取清单和补充测量阶段，清单先显示，目录占用与补充检查逐步填入。重复请求复用同一任务；排队期间停用的管理器不会启动。刷新失败保留上次可用快照并标记异常及数据时间。扫描诊断只读，不修改 shell 配置或权限。

Homebrew 扫描会禁用 auto-update，避免只读扫描触发 Homebrew 更新。`brew cleanup --dry-run` 不阻塞首屏扫描；Homebrew tab 先展示已安装、outdated、leaves 和路径，再单独加载 cleanup dry-run 预览。

nvm 扫描不运行 `nvm` 命令，因为 nvm 通常是 shell function，不是可直接 spawn 的二进制；后端只读取 `NVM_DIR` 或 `~/.nvm` 下的 `versions/node/v*` 目录，并为每个 Node 版本提供复制 `nvm use <version>` 的命令。

FVM 扫描使用机器可读的 `fvm api list`（版本清单、引用项目、未引用版本）和 `fvm api context`（版本目录、git 缓存、全局链接），不解析人类表格。全局默认通过读取全局链接指向判定，链接缺失仅表示未设置全局默认。项目级 `.fvmrc`/`.fvm` 不在扫描范围内。

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

目录占用、CLI 预演估算和执行后测量是不同口径。Homebrew 展示 `brew cleanup --dry-run` 估算；pnpm / uv prune 不用整目录大小推断回收量；Docker 保留 `docker system df` 的分项报告，但其统计范围比本工具支持的清理范围更广。总览不提供跨来源「可回收总量」，项目、VS Code 和会话记录占用各自独立。

## 安全策略

这个工具的默认策略是先可观察，再操作。

当前允许的行为：

- 运行只读扫描命令。
- 读取本机路径元数据并统计大小。
- 复制文本到剪贴板。
- 用系统 opener 打开本机目录。
- 确认后执行 allowlisted 全局包卸载：`npm uninstall -g <pkg>`、`pnpm remove --global <pkg>`。
- 确认后执行 allowlisted 缓存清理，命令固定在 Rust 静态表里（见上方功能列表）。
- 确认后清理扫描会话中的 Rust 构建目录候选；前端只能提交后端签发的根目录、扫描和候选 ID，执行前会重新验证项目、`target` 身份及根目录边界。
- 确认后永久清理同一扫描会话中已验证的 Node 依赖目录；执行前再次检查项目、目录身份和根目录边界。
- 确认后把合格的会话记录移入废纸篓；每条记录动手前重判资格。
- 带路径身份断言地删除 npm 的 `_npx` 目录：断言绝对路径、以 `npm config get cache` 的返回值为前缀、basename 恰为 `_npx`，任一条不满足就报失败而不继续。

清理的执行边界：

- 管理器缓存只暴露 `run_cache_cleanup(managerId)`。前端能传的只有一个 12 值枚举，**在语法上无法表达"执行哪条命令"**，allowlist 因此是类型系统的性质而不是约定。
- 项目派生数据清理只接受后端当前扫描会话中的 candidate ID，不接受前端提供路径或 Cargo 参数；重扫和切换预设会使旧会话立即失效。
- 结构化 args，不拼 shell string。
- 清理专用 300 秒超时，与扫描的 5–15 秒、卸载的 30 秒分开——避免"缓存很大"被误报成"超时"，而超时会 kill 子进程、留下删了一半的状态。
- 多步骤方案遇错即停，并区分「部分完成」和「完全失败」。

当前不允许的行为：

- 绕过 `_npx` 或扫描会话依赖目录的护栏，删除任意文件或目录。
- 为 nvm、Maven、Cargo 的管理器缓存提供清理（ADR-0001）。
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
- 不提供持久操作历史或派生数据清理撤销。会话记录可在清空废纸篓前通过系统恢复。

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

`cargo test` 当前覆盖（129 项）：

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
- FVM api list/context 解析、全局默认 Current 标记、未引用 Unused 标记、Missing/Partial/Ready 状态
- 8 个清理方案的精确 `(program, args)`（table-driven）
- nvm / Maven / Cargo / FVM 解析为「无清理方案」，且不执行任何命令
- uv 参数不含 `--force` / `clean` / `--ci`
- Docker 参数不含 `-a` / `--all` / `system` / `--volumes` / `container` / `volume`
- Homebrew 参数恰为 `cleanup`，不含额外 prune 开关
- 多步骤方案的全部成功 / 首步失败（后续 Skipped）/ 后续步骤失败（部分完成）
- `_npx` 护栏：相对路径被拒、空 cache 值被拒、basename 不符被拒、合法路径通过
- 空 cache 值永远不会到达删除函数
- pip 在内部解析解释器、`python3` → `python` 回退、解析失败时 pip 不运行
- 清理步骤使用 300 秒超时而非扫描超时
- 扫描诊断中的可执行路径解析
- 目录预设迁移、独立深度、路径去重、不可用目录和保存失败时的状态保留
- 会话记录逐项移除原因，来源级失败不计入记录失败数

`pnpm test` 当前覆盖（131 项），主要包括：

- 清理文案表：无方案管理器缺席、按钮只挂在拥有它的路径卡片上
- 全清型显示实测占用；prune 型（pnpm / uv）不显示数字并给出说明
- Homebrew 的回收量取自 dry-run 而非路径占用，并展示逐条清单
- Homebrew 在 dry-run 落地前不提供执行入口
- Docker 只展示本次会清理的资源类型，卷被排除
- 部分完成渲染为 warn 而非失败，弹窗保持打开
- Yarn 2+ 在 `Unsupported` 下仍有清理入口；管理器 `Missing` 时没有
- 健康页建议只跳转、不执行，也没有批量入口
- FVM 只读：版本清单紧凑表格、版本目录与 git 缓存内联路径、文案表缺席且路径卡片无清理入口、存量偏好自动补启用
- 总览入口、未扫描与缺失状态、目录占用下限
- 扫描并发限制、任务去重、停用排队任务、失败保留快照、定向重试与维护互斥
- 软件包搜索后复制和卸载保持正确对象
- 预设切换使候选失效、批次期间禁止切换、深度编辑和保存失败处理
- 会话记录筛选清空选择、按年龄操作全来源、逐项结果与操作错误

## 后续候选

- Homebrew services / doctor / Brewfile。
- Rust project dependency discovery / rustup toolchain inventory。
- 增加 README 截图。
