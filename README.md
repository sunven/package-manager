# DevScope

一个个人自用的 Tauri 桌面工具，用来查看本机 npm、pnpm、Yarn、nvm、Homebrew、Maven、pip、Cargo、Docker、Bun、uv 和 FVM 的包、缓存/仓库占用与维护信号，清理 Rust / Maven / Node 项目派生数据，以及查看 VS Code 占用和 Codex、Claude Code、OpenCode、Grok Build、Qoder、Qoder CN 会话记录。

当前目标是 **observe first, then act**：默认只扫描和展示信息，可以复制命令、复制路径、打开目录；其中 8 个管理器支持确认后执行 allowlisted 的缓存清理。

清理的安全性是结构性的：默认委托给拥有派生数据的 CLI；npm 的 `_npx` 和扫描会话授权的 Node `node_modules` 使用带路径身份检查的护栏删除。Rust 项目 `target` 通过固定参数的 `cargo clean` 清理，Maven 项目 `target` 通过固定参数的 `mvn clean` 清理。会话记录不可重建，因此独立处理并移入废纸篓。详见 [ADR-0001](./docs/adr/0001-delegated-cache-cleanup.md)、[ADR-0003](./docs/adr/0003-build-cleanup-uses-scan-session-candidates.md) 和 [ADR-0016](./docs/adr/0016-maven-build-directories-use-delegated-cleanup.md)。

术语定义见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [docs/adr/](./docs/adr/)。

## 功能

- 扫描 npm、pnpm、Yarn、nvm、Homebrew、Maven、pip、Cargo、Docker、Bun、uv、FVM。
- 总览展示已扫描／已启用数量、未扫描状态、维护建议与目录占用 Top 5；其他本机数据提供独立页面入口。
- 手动刷新当前管理器，或一次扫描所有已启用管理器；共享扫描队列最多同时处理 2 个管理器。
- 查看全局安装的包名、版本、包路径。
- 在当前管理器中按名称、版本、路径搜索，按名称或版本自然排序并切换升降序；可与已有信号筛选组合。
- 顶部「搜索」或 `⌘K` 跨已启用管理器搜索当前观察，支持键盘选择并定位到具体包、运行时、资源或目录。
- 总览「环境诊断」按应用 PATH 顺序查看命令候选、不同安装来源、同一文件的多个路径及读取异常。
- 顶层「历史」比较自动留存的管理器快照，并查看跨领域维护记录：管理器缓存清理／npm、pnpm 全局包卸载、项目清理、VS Code 工作区存储移除和会话记录操作。
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
- 同一扫描也发现与 `pom.xml` 同级的 `target`，确认后按模块执行 `mvn -B -N -f <pom.xml> clean`，不连带清理未选中的子模块。
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
- Codex 与 Claude Code 会话记录支持搜索、筛选和移入废纸篓；OpenCode 会话记录展示已登记运行服务中的全局会话，可按标题、工作目录和归档状态筛选，在 Terminal 中连接到原会话，并确认后永久删除单条会话及其子会话。
- Codex 页分为「插件市场／Hooks／Skills」：展开市场可搜索插件目录、按安装状态筛选、查看详情并单项安装、启停、重新安装或卸载，同页管理 Git／本地市场源；Hooks 保留查看与单项启停；Skills 支持查看、搜索、启停，以及本应用安装副本的安装、更新和卸载。
- Claude Code 页提供当前用户的市场、插件、Hooks 与 Skills 管理；Skills 支持定义查看、原生调用设置及独立副本安装、更新和卸载。Skills 写入已验证 2.1.302，市场、插件与 Hooks 写入仍限已验证的 2.1.300。

## 当前边界

- 主要面向 macOS 自用。
- 不做后台自动刷新。启动时只扫描首个已启用管理器，其他管理器首次进入时扫描，之后手动刷新；手动全量扫描仅覆盖已启用管理器。
- 不做 per-package size，只展示 manager/path 级别总大小。
- 只有 npm 和 pnpm 支持确认后卸载全局包；其他管理器不做 uninstall。
- 缓存清理覆盖 8 个管理器。**nvm、Maven、Cargo、FVM 的管理器缓存没有清理能力，这是有意的架构决定**，不是遗漏：nvm、Maven、Cargo 都没有官方子命令能清自己的缓存，做它们就意味着本工具自己 `rm -rf` 推导出来的路径；FVM 的 `fvm remove` 删除的是用户安装的 SDK（按卸载对待，需单独安全论证），`fvm destroy` 则超出本工具的能力范围。Rust 项目构建产物是独立功能，不计入 Cargo 管理器缓存或健康汇总。
- Rust 构建产物 v1 只认 `Cargo.toml` 同级、非符号链接且根级包含 `CACHEDIR.TAG` 或 `.rustc_info.json` 的 `target`；不解析自定义或共享 `target-dir`。
- Maven 构建产物 v1 只认 `pom.xml` 同级、非符号链接且根级包含 Maven 产物目录（如 `maven-status`、`classes`、`test-classes`）的 `target`；不解析 pom 自定义的 `<directory>`，也不偏好项目内 `mvnw`。
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

## 搜索、环境诊断与历史

顶部「搜索」或 `⌘K`（也支持 `Ctrl+K`）打开跨管理器搜索。输入名称、版本或路径，以方向键和 Enter 定位，Escape 关闭并返回原焦点。结果只来自已启用管理器的当前观察，保留同名包在不同管理器、不同运行时安装中的独立身份；尚未读取的管理器不会被当作空清单。定位会清除目标列表的搜索与信号筛选，选中包行或展示对应目录。搜索内可主动扫描全部已启用管理器。

总览「环境诊断」仅检查应用进程的 PATH 与文件元数据，按顺序展示首个可执行候选、符号链接目标、不同安装来源及同一文件的多个入口。路径无法读取、链接损坏、非可执行文件和未找到分别显示；没有候选不代表机器上未安装。诊断不会执行候选程序、加载 Shell 初始化脚本或修改配置，因此不包含 Shell 函数／别名；nvm 对应的诊断观察 Node 来源。

「历史」是顶层入口，提供维护记录与快照对比两个分区：

- 一轮管理器扫描及目录测量、适用补充检查结束后留存快照，每个管理器保留最近 20 份。单项补充重试不额外归档；失败或不完整观察按真实状态保留，不把之前的成功快照重新标为本次成功。
- 条目增减与版本变化只在同一观察来源、两份清单均完整时计算。Docker 资源按稳定身份比较，容器运行时长变化不算版本变化；Maven 比较完整已观察版本集合。来源变化或无法核实、读取不完整时保留观察详情并说明无法判定。
- 目录差值仅在同来源、同路径且两端测量完整时计算；占用减少不等于实际释放的物理空间。
- 维护记录覆盖管理器缓存清理／npm、pnpm 全局包卸载、项目清理、VS Code 工作区存储移除和会话记录操作。一次确认对应一条记录；批次中的每个目标保留独立状态、跳过原因与失败信息。执行结果与后续读取或核对分别展示；项目清理没有后续读取，清理调用内的重新测量属于执行结果。
- 全局保留最近 500 条已关闭维护记录；执行中的记录不因上限被淘汰，应用重启后仍未关闭的记录标记为「已中断」并保留已写入的目标结果。管理器维护前后的关联快照仍可能超出保留范围。
- 记录存于应用数据目录的 `manager-history/`；旧的管理器维护记录迁移后原文件保留为备份。无法识别或不支持的历史文件保留原样并提示；存储失败不改变已发生的维护结果。
- 历史快照不恢复为当前观察，也不授权任何维护。历史不是备份或撤销；代理扩展维护暂不纳入。

验证范围与界面证据见 [P1 验证记录](./.scratch/p1-environment-observation/VERIFICATION.md)。

## VS Code 占用

独立的「VS Code 占用」页面扫描当前 macOS 用户的
`~/Library/Application Support/Code/User/workspaceStorage`，每个存储目录单独列出项目名称、项目位置、目录占用和识别状态。

- 首次进入页面时扫描，之后手动刷新；切换页面保留扫描结果。
- 默认按占用降序排列，可搜索项目名称、项目路径和存储目录。
- 项目路径不存在或映射无法识别的记录仍会列出并计入本页汇总；同项目的多份存储分别展示。
- 占用沿用磁盘分配量口径，读取不完整时展示已测得的下限；本页合计与管理器占用分开。
- 只有「路径不存在」和「未识别工作区」中的普通目录记录可以移除；「路径存在」「远程工作区」「路径无法访问」、符号链接和其他非目录不可移除。可移除资格由后端给出。
- 移除要求 VS Code 未运行；执行前和每一项前重新检查，项目路径恢复（例如外接磁盘重新挂载）或记录变化的留在原处。
- 记录移入系统废纸篓，清空废纸篓前可恢复，磁盘空间不会立即释放；操作结果写入维护历史。
- 只处理 `workspaceStorage`，不统计项目源码，不代表当前窗口或完整打开历史，也不移除 VS Code 的其他数据。

## 项目扫描目录预设

- 添加目录后保存规范化路径与深度（0–32），再次添加同一路径复用已有预设。
- 深度编辑后点击「保存深度」或按 Enter，保存成功后用于下一次扫描。
- 旧版单根目录设置自动读取为一个预设；后续保存使用新版格式。
- 切换预设或移除当前预设会清空候选与选择，旧扫描授权失效；预设本身不保存候选或清理授权。
- 不可用目录仍保留在列表中并显示原因，恢复后重新选择即可验证。移除预设不会删除目录。
- 扫描或清理批次期间锁定预设操作；保存失败时保留原有设置。

## 会话记录

Codex 与 Claude Code 来源分别扫描、搜索、筛选和移除。搜索及使用状态筛选只影响当前列表；改变搜索或筛选会清空选择，「全选」仅选择当前可见且未在使用中的记录。列表默认按年月分组，也可以按会话项目（相同工作目录的会话记录归为一组）或按大小查看；按项目模式下项目默认折叠，搜索时自动展开命中的项目。

按年龄移除始终覆盖整个来源，以记录内容的最后活动时间为准，不受搜索条件影响。执行前重新检查记录身份、使用状态和年龄；明确选中的记录不因活动时间更新而自动取消移除。

结果分别显示已移入废纸篓、跳过和失败数量，并列出使用中、记录已失效、活动时间变化、无法确认活动时间或废纸篓操作失败等原因。来源级错误独立展示，不计作某一条记录失败。页面结果只反映本次操作；同一批次同时写入维护历史，保留确认范围、逐项结果和后续读取状态。

Grok Build 来源读取当前 `GROK_HOME`（默认 `~/.grok`）下所有项目的本机会话摘要，支持标题／工作目录搜索，以及按年月、按会话项目或按大小查看，并可在 macOS Terminal 中继续指定会话。最后活动时间使用 `last_active_at`；原工作目录或恢复日志缺失、ID 无法精确继续时说明原因，保留可识别记录的其他操作。

Grok 支持单条、多选和整个来源的 7／30 天移除。确认后逐条复核身份、运行状态、文件占用与适用的年龄条件，再将整条会话目录移入废纸篓。Grok Build 或会话宿主仍在运行、检测结果无法确认时暂停移除；普通单条失败继续，运行状态变化则停止剩余项，分别报告已移入、跳过、失败和未执行。独立关联记录不自动连带，外部搜索索引与远端副本保留，旧片段仍可能出现在 Grok 搜索中。基于 Grok Build 1.0.70 的本机格式验证，前置检查不构成与 Grok 启动之间的原子互斥。详见 [ADR-0030](./docs/adr/0030-grok-session-removal-preserves-local-recovery-boundary.md)。

Qoder 国际版与 Qoder CN（国内版）是两个独立来源，分别读取 `~/.qoder/projects` 与 `~/.qoder-cn/projects`。一条记录由转写文件与同名配套目录（本地状态、子代理对话）共同构成；只有配套目录而没有转写的记录以「未命名会话」显示并同样可移除。刷新诊断日志不属于会话记录，不展示也不移除。来源支持搜索、使用状态筛选，以及按年月、按会话项目或按大小查看，并可在 macOS Terminal 中按原工作目录执行 `qodercli --resume`（国内版 `qoderclicn --resume`）继续会话。单条、多选和整个来源的 7／30 天移除都会把转写与配套目录一起移入废纸篓；CLI 运行中未被进程打开的记录仍可移除，使用中的记录保留。详见 [ADR-0034](./docs/adr/0034-qoder-editions-are-two-sources-and-records-include-sidecar-data.md)。

OpenCode 来源通过已登记且运行中的本地服务分页读取元数据，不启动服务、不读取消息正文，也不管理配置。它全局展示各项目的活动与归档会话及父子关系，可按最后活动时间的年月或按会话项目分组，分组可折叠，搜索时自动展开命中的项目；进入页面时读取，可手动刷新。官方元数据没有单条记录大小，因此不提供按大小排序。打开前复核会话仍存在，再通过 macOS Terminal 的 `opencode attach` 连接指定会话和工作目录，不创建分支或解除归档。单条及明确选择的批量删除通过 OpenCode 服务执行，连带删除子会话；删除前核对运行状态，确认框说明此操作不进入废纸篓且无法恢复。

「永久删除 7／30 天前的记录」作用于整个 OpenCode 来源，不受搜索和归档筛选限制；以确认时刻减去 N 个 24 小时为固定门槛，目标及全部后代都须严格早于门槛且未运行。有近期或运行中后代的父会话保留，其中独立符合条件的旧子分支仍可删除。确认冻结目标及父子关系，删除前重新核对；首次复核发现变化时整批不开始，执行中发现变化或失败时停止后续操作并保留已完成结果。活动状态不可读时，列表仍展示元数据，按年龄入口禁用。官方 API 未提供原子条件删除，客户端最后一次检查与 DELETE 之间仍有竞态窗口。详见 [ADR-0022](./docs/adr/0022-opencode-age-deletion-preserves-recent-descendants.md)。

## 开发环境

### Codex 管理

入口为侧栏「Codex」，包含「插件市场／Hooks／Skills」三个页签，只管理当前 `CODEX_HOME`（默认 `~/.codex`）；使用相同目录的 CLI 与桌面 App 共用这份本地配置。即使只使用桌面 App，也需要应用的 PATH 中有兼容的 Codex CLI。插件与 Hooks 已验证版本为 0.162.1，Skills 为 0.163.0；这些不是最低支持版本，各项能力分别判断兼容性。

「插件市场」默认展示本机 Codex 发现或配置的市场，展开后浏览已安装与未安装插件，按名称或简介搜索，并以「全部／已安装／未安装」筛选。插件清单需要 CLI 支持 `codex plugin list --available --json`。首次进入、手动及操作后读取；安装状态与用户默认启用设置分别显示，不从缓存是否存在推断安装。

插件列表与详情展示版本、来源、安装和认证策略，并按本地可读文件补充简介、作者及技能名称、MCP 服务名和 Hooks 事件的只读清单。兼容 portable、Codex 和 Claude 插件 manifest；详情标明来自安装副本还是来源目录。未下载的远程插件保留目录信息，无法读取的字段和组件明确标为未知或尚不可读取，不为预览自动下载或安装。组件声明不代表已加载、连接或获得信任；可跳转现有 Hooks 管理页。

安装、启停、重新安装和卸载均为确认后的单项操作，执行前复核插件身份、来源、安装状态、策略与配置。安装和重新安装委托 Codex 执行并将插件启用；重新安装已禁用插件也会启用，不承诺取得上游最新版。安装策略不允许或无法核实时不能安装或重新安装，连接认证仍在 Codex 中完成。卸载委托 Codex 移除安装副本及配置，应用不追加删除原始来源、凭据、插件数据或 Hooks 信任记录。

用户配置未显式设置启用值时显示未知，可确认后指定启用或禁用；启停只更新该插件的 `enabled`，保留其他配置、注释和文件权限。检测到外部修改时要求重新确认。此次补全的范围、验证与执行边界见 [PRD](./.scratch/codex-marketplace-plugin-completion/PRD.md)、[验证记录](./.scratch/codex-marketplace-plugin-completion/VERIFICATION.md) 和 [ADR-0014](./docs/adr/0014-plugin-lifecycle-uses-cli-and-details-use-readable-local-files.md)。不提供公共插件目录、插件或市场发布、项目配置、批量操作、技能编辑、MCP 服务启停或认证管理。

没有已安装插件的市场仍可浏览目录，空市场也保留。插件找不到对应市场时，按原市场名保留分组并注明「未出现在市场清单中」，不提供该分组的市场源维护操作。两份清单的错误与操作资格分别判断：市场读取失败不妨碍符合资格的插件操作，插件读取失败也不阻止独立可用的市场维护。

保存成功不代表当前会话已生效，项目设置也可能覆盖用户默认值。配置读取失败时禁止修改；保存与后续刷新分别报告结果。接入边界见 [ADR-0011](./docs/adr/0011-codex-plugins-use-cli-inventory-and-user-config.md)。

市场源在「插件市场」内管理，使用官方市场清单，支持添加 Git 仓库简写（含 `owner/repo@ref`）、HTTP(S)／SSH Git URL 或本地市场根目录。「Git 高级选项」可指定分支或标签及多个稀疏检出目录；本地来源支持 `.agents/plugins/marketplace.json` 和 `.claude-plugin/marketplace.json` 布局。私有仓库沿用本机 Git 认证，应用不提供凭据保存。「重新读取」读取本机市场与插件目录清单；「同步市场」逐个同步 Git 来源，本地目录修改后可重新读取，无需 Git 同步。

市场维护需要 CLI 支持 `plugin marketplace` 命令及 `app-server` 的 `config/read` 配置来源信息（已验证 0.162.1）。只有来源、用户配置和官方配置归属都可核实时才提供维护动作；默认、受管理或归属不明的市场只读。同步和移除前确认目标，执行前重新核实，外部变更时中止旧操作；同名不同来源不自动替换。

同步市场可能影响多个已配置插件，即使插件已禁用；它不等于单项重新安装，也不承诺取得上游最新版。移除市场只委托官方命令，Git 市场本地副本会被移除，应用不追加插件卸载或原始来源删除。命令结果和随后清单读取结果分别报告。同步语义见 [市场源 PRD](./.scratch/codex-marketplace-management/PRD.md) 和 [ADR-0012](./docs/adr/0012-marketplace-refresh-follows-codex-sync-semantics.md)。

「Hooks」采用原生清单，展示事件、命令或 MCP 工具、来源、启用与信任状态，可展开完整操作、匹配条件、超时及配置路径。总开关开启时包含用户配置和已启用插件的 Hooks；项目配置及已禁用插件不展开。总开关关闭时说明无法枚举，不把空清单解释成没有配置。

Hooks 依赖 CLI 的 `app-server` 清单、功能状态和配置读写能力。只有已信任、非托管且来源可核实的单条 Hook 才能确认后启停；信任审查使用 Codex CLI 的 `/hooks` 或桌面 App 的 Hooks 界面。本工具只写该 Hook 的用户级 `enabled`，不修改信任记录、定义、总开关或插件设置。保存前复核定义、信任、启用状态及配置版本，外部变化时中止并重新读取，不自动覆盖重试。

Hooks 首次进入、手动刷新和操作后读取；插件安装、启停、重新安装、卸载或市场维护后，再次进入 Hooks 会重读。保存成功与随后读取失败分别报告，过期清单暂时不能修改；保存后请在新会话中验证。需求、验证与边界见 [Hooks PRD](./.scratch/codex-hooks-management/PRD.md)、[验证记录](./.scratch/codex-hooks-management/VERIFICATION.md) 和 [ADR-0013](./docs/adr/0013-codex-hooks-use-native-inventory-and-user-state.md)。

「Skills」通过原生清单查看当前用户技能，支持名称／说明／路径搜索、来源与启停筛选及只读 `SKILL.md` 详情。已有普通目录、共享或链接技能只提供 Codex 启停；插件技能可跳转所属插件，内置和其他来源只读。禁用插件未被原生发现的技能不补读，项目技能不进入用户管理。已在 Codex CLI **0.163.0** 验证。

可从 GitHub 仓库（子目录、分支／标签）或本地目录检查并安装一个技能，独立复制到当前 `CODEX_HOME/skills`，新装启用。应用仅维护自己创建并记录的副本，不接管既有技能或其他工具的记录；目标目录存在时拒绝覆盖。更新跟随已记录分支、固定标签提交或原本地目录，保留启停选择；副本有本地修改时停止更新。卸载把副本及本地修改一起移入废纸篓，保留原始来源。

所有技能维护都先预览、单项确认，再核对配置、来源记录、内容及目录身份；操作与清单刷新结果分别反馈。GitHub 来源沿用本机 Git 认证，不运行技能脚本；含链接／特殊文件的安装来源不复制。安装来源及基准保存在 `CODEX_HOME/.package-manager-skills.json`，不可读或身份无法核实时暂停文件维护。验证范围见 [Skills 验证记录](./.scratch/codex-skills-management/VERIFICATION.md)，设计边界见 [ADR-0019](./docs/adr/0019-codex-skills-use-native-discovery-and-owned-installations.md)。

### Claude Code 管理

侧栏「Claude Code」包含「插件市场／Hooks／Skills」三个页签，只管理 `CLAUDE_CONFIG_DIR` 指定的当前用户目录，默认 `~/.claude`。应用 PATH 中需要有 `claude`；市场、插件与 Hooks 写入仅开放给已验证的 **2.1.300**，Skills 写入单独验证为 **2.1.302**。CLI 缺失或版本未经相应能力验证时暂停写入，仍尽可能展示可读取的 Hook 与技能定义。

市场支持 GitHub／Git、本地目录或 `marketplace.json`、远程 JSON，以及 Git 分支／标签和稀疏检出目录。展开市场可搜索、筛选和查看插件详情，确认后单项安装、更新、卸载、启用或禁用。更新市场目录与更新插件分别操作；依赖联动由原生 CLI 决定。详情仅读取已有本地内容，缺失信息明确说明，不自动下载。托管或归属不明的来源只读。

移除市场可能连带卸载插件及删除可删除的插件数据。确认框列出受影响的用户插件；后端再次检查全部安装作用域，存在项目、local 或其他非用户安装，或无法确定影响时阻止移除。

Hooks 展示用户定义与用户已安装市场插件的声明，包含禁用插件。用户定义支持 `command`、`http`、`mcp_tool`、`prompt`、`agent` 结构化编辑，预览后保存；原始配置和插件定义只读。保存保留其他定义、未知字段、引用脚本及用户总开关；外部修改会中止旧提交并保留草稿。没有逐条启停、信任或运行测试入口。定义清单不代表会话正在执行的内容，保存后请在 Claude 中核对加载结果。

操作与随后重读的结果分别反馈，不自动重放写入。实现范围及验证边界见 [PRD](./.scratch/claude-code-management/PRD.md) 和 [验收记录](./.scratch/claude-code-management/VERIFICATION.md)。

Skills 展示当前用户的独立技能、旧版命令、用户已安装插件技能（含禁用插件）及可识别的同步技能，提供搜索、来源／调用设置筛选和只读详情；定义存在不代表当前会话已加载。调用设置使用原生 `skillOverrides` 的四种模式及移除用户覆盖，分别显示技能名称与实际设置名称；按名称影响用户默认行为，仍受作者声明与更高层配置约束。插件和同步技能交所属来源维护。

GitHub（子目录、分支／标签）和本地目录经检查确认后复制到当前 Claude 目录的 `skills`，来源记录保存在 `.package-manager-claude-skills.json`。仅本应用新建且身份可核实的副本可更新或卸载；已有目录、共享链接不接管。更新跟随记录来源，固定标签保留原提交；本地修改、名称变化或冲突时停止。卸载将整份副本移入废纸篓。安装、更新和卸载均保留原来源及按名称的调用设置，不运行技能脚本。详见 [Skills 需求](./.scratch/claude-skills-management/PRD.md)、[验证记录](./.scratch/claude-skills-management/VERIFICATION.md) 和 [ADR-0020](./docs/adr/0020-claude-skills-use-definition-inventory-and-native-name-overrides.md)。

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
src-tauri/target/release/bundle/macos/DevScope.app
src-tauri/target/release/bundle/dmg/DevScope_0.1.0_aarch64.dmg
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

Maven build artifact cleanup:
mvn -B -N -f <pom.xml> clean

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

管理器维护由一个工作流统一管理确认、执行和快照核对。确认期间冻结目标与预演，暂停新的手动扫描和维护，已入队的扫描继续。执行结果立即展示，之后读取目标的完整快照及适用补充信息；读取失败会保留执行结果，“重新读取”只重试读取。执行失败或回执未确认也会尝试核对，不自动重放维护。明确未执行的无方案结果跳过核对。

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
- 确认后清理扫描会话中的 Rust / Maven 构建目录候选；前端只能提交后端签发的根目录、扫描和候选 ID，执行前会重新验证项目、`target` 身份及根目录边界。
- 确认后永久清理同一扫描会话中已验证的 Node 依赖目录；执行前再次检查项目、目录身份和根目录边界。
- 确认后把合格的会话记录移入废纸篓；每条记录动手前重判资格。
- 确认后把合格的 VS Code 工作区存储记录移入废纸篓；要求 VS Code 退出，执行前和每一项前重判项目路径，恢复的记录留在原处。
- 带路径身份断言地删除 npm 的 `_npx` 目录：断言绝对路径、以 `npm config get cache` 的返回值为前缀、basename 恰为 `_npx`，任一条不满足就报失败而不继续。

清理的执行边界：

- 管理器缓存通过 `run_cache_cleanup` 接受一个 12 值管理器枚举；可选的维护前快照 ID 仅用于历史关联，不影响执行资格。前端**在语法上无法表达"执行哪条命令"**，allowlist 因此是类型系统的性质而不是约定。
- 项目派生数据清理只接受后端当前扫描会话中的 candidate ID，不接受前端提供路径或 Cargo 参数；重扫和切换预设会使旧会话立即失效。
- 结构化 args，不拼 shell string。
- 清理专用 300 秒超时，与扫描的 5–15 秒、卸载的 30 秒分开——避免"缓存很大"被误报成"超时"，而超时会 kill 子进程、留下删了一半的状态。
- 多步骤方案遇错即停，并区分「部分完成」和「完全失败」。

当前不允许的行为：

- 绕过 `_npx` 或扫描会话依赖目录的护栏，删除任意文件或目录。
- 移除「路径存在」「远程工作区」「路径无法访问」的 VS Code 工作区存储记录，或在 VS Code 运行时执行移除。
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
- 不提供派生数据清理撤销。维护历史覆盖管理器缓存清理／npm、pnpm 全局包卸载、项目清理、VS Code 工作区存储移除和会话记录操作；会话记录与 VS Code 工作区存储记录可在清空废纸篓前通过系统恢复，OpenCode 永久删除无法恢复。

新增管理器的清理能力，只需在 Rust 静态表和 `src/cleanupCopy.ts` 各加一条；新增"自行删除目录"这类例外，需要和 `_npx` 同等强度的身份断言论证。

## 项目结构

```text
src/
  main.tsx         React entry
  App.tsx          前端应用骨架
  components/      React UI 组件
  hooks/           React 工作流接入、选择与复制/打开行为
  utils/           展示文案、筛选和格式化工具
  styles.css       Tailwind 入口和全局基础样式
  state.ts         pip 信号合并与清理结果文案
  managerMaintenanceWorkflow.ts 管理器扫描、维护与核对的统一状态所有者
  managerMaintenanceTauriEffects.ts 原生命令与设置存储适配
  globalSearch.ts 跨管理器搜索与稳定对象定位
  managerHistory.ts 历史快照投影与完整性约束下的差异比较
  maintenanceHistory.ts 跨领域维护记录类型、计数、标签与日期分组
  historyRevision.ts 跨领域操作完成后的历史页重读信号
  cleanupCopy.ts   每个管理器的清理文案、按钮位置、回收量来源

src-tauri/
  src/lib.rs       Tauri command 定义与注册
  src/command.rs   结构化命令执行、超时、失败分类
  src/disk_usage.rs 文件系统遍历与 hardlink 去重
  src/environment_inspection.rs 应用 PATH 命令候选的只读文件系统检查
  src/manager_history.rs 管理器快照的原子保存、限额和读取
  src/maintenance_history.rs 跨领域维护记录、v1 迁移、保留、中断与后续读取
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

`cargo test` 覆盖包括：

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
- PATH 优先级、同文件入口、损坏链接、非可执行文件及部分无法读取
- 快照和维护记录重启读取、保留限额、损坏文件保护、并发写入，以及历史写入失败不改变执行结果
- 目录预设迁移、独立深度、路径去重、不可用目录和保存失败时的状态保留
- 会话记录逐项移除原因，来源级失败不计入记录失败数

`pnpm test` 覆盖包括：

- 清理文案表：无方案管理器缺席、按钮只挂在拥有它的路径卡片上
- 全清型显示实测占用；prune 型（pnpm / uv）不显示数字并给出说明
- Homebrew 的回收量取自 dry-run 而非路径占用，并展示逐条清单
- Homebrew 在 dry-run 落地前不提供执行入口
- Docker 只展示本次会清理的资源类型，卷被排除
- 部分完成保留已执行步骤，执行结果与快照核对独立展示，弹窗保持打开
- Yarn 2+ 在 `Unsupported` 下仍有清理入口；管理器 `Missing` 时没有
- 健康页建议只跳转、不执行，也没有批量入口
- FVM 只读：版本清单紧凑表格、版本目录与 git 缓存内联路径、文案表缺席且路径卡片无清理入口、存量偏好自动补启用
- 总览入口、未扫描与缺失状态、目录占用下限
- 扫描并发限制、任务去重、停用排队任务、失败保留快照、定向重试与维护互斥
- 冻结确认、过期回调、重复确认、执行回执超时、核对失败后只读重试及 StrictMode 订阅
- 软件包搜索后复制和卸载保持正确对象
- 跨管理器稳定身份搜索、不同运行时、Maven 完整版本集合与 Docker 状态比较
- 自动归档时机、失败观察、维护历史结果分离及历史读取竞态
- 跨领域维护历史 v1 迁移、500 条已关闭记录保留、执行中保护、启动中断标记与后续读取一次性写入
- 历史页领域／状态筛选、详情分节、深链选中与快照对比回链
- 项目清理批次、VS Code 移除、会话移除与 OpenCode 删除的逐目标写入、摘要派生与漂移展示
- 来源变化、不完整清单及目录测量不足时的差异约束和界面提示
- 预设切换使候选失效、批次期间禁止切换、深度编辑和保存失败处理
- 会话记录筛选清空选择、按年龄操作全来源、逐项结果与操作错误

## 后续候选

- Homebrew services / doctor / Brewfile。
- Rust project dependency discovery / rustup toolchain inventory。
- 增加 README 截图。
