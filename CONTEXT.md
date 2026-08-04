# Package Manager Control Center

一个本机开发环境观察与维护工具。它把多个互不相干的包管理器（npm、pnpm、Yarn、nvm、Homebrew、Maven、pip、Cargo、Docker、Bun、uv）和本地项目构建产物的磁盘占用与健康信号收敛成一套统一词汇，并在此之上提供受约束的维护操作。

## Language

### 管理器与扫描

**管理器 (Manager)**:
一个被本工具观察的本机包管理器或运行时版本管理器。
_Avoid_: 包管理工具、工具链

**快照 (Snapshot)**:
对单个管理器执行一轮只读扫描后得到的完整观察结果，包含包清单、路径、占用、诊断信息。
_Avoid_: 状态、数据、结果

**信号 (Signal)**:
附着在单个包上的一条可观察事实，例如「可更新」「叶子包」「悬空」。信号只描述现状，不隐含应当采取的动作。
_Avoid_: 标签、警告、问题

**不支持 (Unsupported)**:
管理器状态之一，仅表示**该管理器无法提供等价的全局包清单**。它不否定该管理器的缓存路径、占用统计或清理能力。
_Avoid_: 不可用、未适配

### 磁盘占用对象

**缓存 (Cache)**:
管理器为加速后续操作而保存的、可由管理器自行重新生成的派生数据。缓存的清理具有「最坏后果是下次变慢」的性质。
_Avoid_: 临时文件、垃圾

**存储 (Store)**:
pnpm 特有的内容寻址包存储。物理文件被 hardlink 到各项目，因此占用统计必须去重。
_Avoid_: 缓存（store 与 cache 在 pnpm 中是不同对象）

**本地仓库 (Local Repository)**:
Maven 的 `~/.m2/repository`。它在语义上是缓存，但没有任何官方子命令可以清理它。
_Avoid_: Maven 缓存

### 项目构建产物

**构建产物 (Build Artifact)**:
由本地项目构建生成、可通过重新构建恢复的派生数据。构建产物由项目拥有，不属于管理器自身的缓存或存储。
_Avoid_: 管理器缓存、target 缓存

**扫描根目录 (Scan Root)**:
用户为一轮构建产物扫描选定的本机目录。它限定项目发现的范围，并与 Cargo workspace 或单个项目目录无关。
_Avoid_: 工作区、项目目录

**Rust 项目 (Rust Project)**:
扫描根目录内由 `Cargo.toml` 标识的本地项目目录。
_Avoid_: Cargo 包、Cargo workspace

**构建目录候选 (Build Directory Candidate)**:
Rust 项目中与 `Cargo.toml` 直接同级、名为 `target` 的文件系统条目。候选会出现在扫描结果中，但只有通过身份检查后才是可清理的构建目录。
_Avoid_: 构建目录、清理候选

**构建目录 (Build Directory)**:
不是符号链接、且根级包含 `CACHEDIR.TAG` 或 `.rustc_info.json` 的构建目录候选。v1 不把 Cargo 配置指向的自定义或共享 `target-dir` 视为构建目录。
_Avoid_: target 缓存、Cargo 缓存

### 维护操作

**清理 (Cleanup)**:
回收可重建派生数据的操作。清理的对象可以是管理器缓存，也可以是项目构建产物；Homebrew 旧版本是记录在案的唯一例外。
_Avoid_: 清除、删除、清空

**构建目录清理 (Build Directory Cleanup)**:
通过 Cargo 对用户选中的构建目录执行清理。它维护的是项目构建产物，不是 Cargo 管理器缓存。
_Avoid_: Cargo 缓存清理、target 删除

**卸载 (Uninstall)**:
移除用户曾主动安装的全局包或工具。它删除的是用户资产而非派生数据，因此与[清理](#维护操作)是两类不同的操作，安全标准也不同。
_Avoid_: 清理、移除

**清理方案 (Cleanup Plan)**:
一个管理器要完成清理所需的**步骤序列**，而不是单条命令。步骤有两种：执行 allowlisted 命令，或执行带路径护栏的目录删除。没有清理方案的管理器与「按钮被禁用」是不同状态——前者是本工具在架构上不提供该能力。
_Avoid_: 清理命令、维护操作

**委托清理 (Delegated Cleanup)**:
把删除动作交给拥有相应派生数据的 CLI 执行，本工具只负责选择受支持的操作及其对象。这是本工具清理能力的默认形态。
_Avoid_: 执行命令

**护栏删除 (Guarded Deletion)**:
本工具亲自删除目录的操作形态。仅在管理器官方没有任何命令能清理该目录时才允许，且删除前必须断言路径身份。目前唯一实例是 npm 的 `_npx` 目录。
_Avoid_: 直接删除、强制删除
