# Maven 本地仓库未引用构件清理研究

Status: research-complete

研究日期：2026-11-04。范围：为 Clean Up 提供 Maven 本地仓库维护能力；“未使用”限定为用户指定扫描范围内没有观察到静态引用，不代表全机或运行时没有使用。本文记录事实与建议，不修改现有架构决定。

## 可核实的事实

### 本地仓库同时保存下载内容与本地资产

Maven 本地仓库同时保存从远程下载的构件，以及本机构建并安装的构件。后一类可能没有远程副本，因此不能把整仓库都视为“删除后仅需重新下载”的缓存。[S1]

仓库可以由多个构建共用。Resolver 文档明确讨论多线程、多进程、多主机共享本地仓库时需要锁与同步，并建议使用 Resolver 的本地仓库 API；直接操作布局可能破坏其假设。[S1]

本功能实现前，项目从 settings 推导仓库位置并只读统计构件与版本，没有记录各项目的引用关系。“多版本”和“SNAPSHOT”只是信号，不能推出未引用；见 `src-tauri/src/managers/maven.rs` 与 `src/developmentHealth.ts`。

### `_remote.repositories` 记录来源，不记录引用

Resolver 1.9.22 的 `EnhancedLocalRepositoryManager` 使用 `文件名>仓库键` 的 properties 记录构件来源。空仓库键表示本地安装；有非空远程仓库键表示曾从相应来源下载。未跟踪的文件也可能被视为本地安装，以兼容 simple local repository。[S2]

该跟踪文件没有“哪些项目正在使用”的集合、引用计数或最后使用时刻。Resolver 2.0.24 的实现还支持更复杂的仓库键与布局策略；不能仅固定识别 `>central`，也不能把缺少跟踪记录当成可删除。[S2][S3]

据此只能推导“观察到远程来源”与“观察到本地安装/来源未知”。远程来源记录不能证明远程构件目前仍存在、凭据仍有效，或离线构建不受影响。[S1][S2]

### `dependency:analyze` 的“unused”不是仓库层面的未使用

`dependency:analyze` 比较一个项目字节码使用的类与该项目声明的依赖，报告 used/undeclared、unused/declared 等集合；默认分析器工作在字节码层面，有反射等使用方式的限制。该 goal 会先执行 `test-compile`。[S4][S5]

因此一个项目的 unused-declared 不能证明某个本地仓库构件不被其他项目、其他 profile、测试/运行时资源或插件使用；也不适合作为纯只读磁盘扫描的一部分。上述“不足以证明”是由其项目级输入和字节码分析边界得出的推论。[S4][S5]

### `dependency:purge-local-repository` 没有全仓库未引用分析

普通 purge 根据当前项目的依赖集合选择构件。默认 `actTransitively=true`、`reResolve=true`、`resolutionFuzziness=version`；命令行在多模块 reactor 中还会遍历 reactor 项目。它删除已选择依赖并可重新解析，选择依据不是“其他项目都不使用”。[S6][S7]

官方参数文档只为 `manualInclude`/`manualIncludes` 说明 `groupId:artifactId` 形式。使用 GA 会进入 manual purge 分支，删除该 artifactId 目录，包含其全部版本；此分支直接返回，不执行普通 purge 的 `reResolve` 流程。[S6][S7]

需要准确区分文档与实现：Dependency Plugin 3.11.0 与 3.8.1 源码的 `gavToPath` 会把冒号分隔的所有段拼成路径，故 GAV 在这些版本实现中可指向版本目录。不能把“源码支持 GAV”误述为“官方参数契约承诺 GAV”，也不能误述为“manualInclude 永远只能删全部版本”。若依赖该实现行为，需固定插件版本并做针对性验证，不能使用任意 PATH Maven 自动选择的插件版本。[S7][S8]

### `dependency:go-offline` 比 dependency tree 更广，但不是全机引用台账

官方描述 go-offline 解析项目依赖、插件、报告及其依赖。3.11.0 实现收集 build/reporting/pluginManagement 中的插件，并解析插件的传递依赖与项目依赖；具体 include/exclude、reactor、scope 等参数会影响集合。[S9][S10]

Maven 模型构建包含父 POM 解析与 dependencyManagement import，但 go-offline 的输出不是“所有被读取的 POM/元数据文件”的结构化清单；只解析 `Resolved dependency` 日志不能据此保证保护了父 POM、import BOM 或构件描述符。[S9][S10][S16]

Profile 受 JDK、OS、属性、文件以及显式参数影响；一次 Maven 执行只看到当前激活的模型，不能覆盖所有以后可能激活的 profile。[S12]

Maven 生命周期中有隐式插件绑定：例如 jar packaging 的 compiler/resources/surefire/jar/install/deploy 等绑定由 Maven core 提供，不必全部写在项目 POM。[S13]

Core extensions 在启动时加载，build extensions 在读取项目后加载；它们可以扩展或替换核心组件。即使只运行 help/dependency goal，也已经启动 Maven、加载相应扩展并执行该 goal 的插件；go-offline 还可能下载构件，因此不是纯文件读取。[S14][S9]

### 文件访问时间不能充当可靠引用证明

macOS 内核公开 `MNT_NOATIME` 挂载标志，含义是禁用文件访问时间更新；还区分 strict atime。文件 atime 的可靠性受文件系统策略影响。[S15]

即便更新时间启用，IDE、扫描器、索引器等文件读取也不是 Maven 项目引用声明。由此可推导：mtime 表示写入，atime 表示受策略影响的读取，两者均不足以证明“从未使用”或“没有项目会再使用”。年龄过滤可以作为用户筛选条件，不能独立成为删除资格。

## 建议的首版边界

以下属于实现建议，不是 Maven 官方保证。

1. 以“扫描范围内未引用构件”为语义。显示扫描根目录、项目数、观察时间与未完整读取的项目；避免把这些候选称为全机未使用依赖。
2. 纯 XML 保守保护，不在扫描中启动 Maven 或执行项目生命周期。解析所有 profile 的声明，取保护集合并集，以多保留为优先。
3. 明确 GAV 引用保护该版本；version 未解析、缺省、属性不确定或范围动态时保护整个 GA。groupId/artifactId 无法确定、项目/仓库 POM 解析失败、达到遍历上限或扫描不完整时，报告无法判定并不允许清理。
4. 保护集合应涵盖 dependencies、dependencyManagement/import BOM、parent、build plugins、pluginManagement、reporting plugins、build extensions 与 `.mvn/extensions.xml`。遍历被保护仓库 POM 的这些声明以构成保守闭包。父 POM 的本地 relativePath、属性继承与 dependencyManagement 必须被考虑；缺少足以分析的模型时保持未知，不猜测。
5. 对仓库内 `packaging=maven-plugin` 的全部版本作保护，并继续保护它们的依赖闭包，用来覆盖隐式生命周期插件。此策略会保留旧插件，是首版可接受的保守限制。
6. 候选细化到 GAV 版本目录，只有完整、明确的远程来源才可进入；发现本地安装标记、未知 payload、无跟踪记录或本地/远程混合来源均保留。SNAPSHOT、非标准/split layout 可以首版全部保留，避免时间戳版本及布局兼容问题。[S1][S2]
7. `_remote.repositories` 的远程来源只降低丢失本地唯一构件的概率，不能保证可重新下载。产品确认应明确后续构建可能重新下载，并将选定版本移入废纸篓，保留恢复机会；清空废纸篓之前不承诺释放磁盘空间。
8. 执行前核对候选会话、规范化仓库根、项目文件变更、版本目录路径与文件/来源变化；用后端签发 ID，不接受前端任意路径。变化应要求重新扫描；不可只重新检查 basename 后继续删除。
9. Maven 构建并发是另外的限制：应用自己的操作锁不能阻止终端/IDE 构建。任何纯文件系统检查都不能提供与 Resolver 相同的完整同步保证；应明确产品边界并在实现设计中评估文件被占用与同仓库写入情况。[S1]
10. 静态 POM 闭包无法保证覆盖任意插件在运行时按配置、代码或网络决定下载的额外构件。例如 Surefire 历史版本按项目 classpath 自动选择测试 provider，未必在项目声明中显式配置。[S17] 未知扩展或这种动态机制需保守保护/标为不可判定；不应把一次成功的静态解析宣称为完整 Maven 执行引用证明。

## 与现有决定的关系

[ADR-0001](../../docs/adr/0001-delegated-cache-cleanup.md) 当前不允许 Maven 管理器本地仓库清理。若实现版本目录移入废纸篓，需要记录明确的新决定/例外及上述边界。本文没有撤销 ADR。

`CONTEXT.md` 中“本地仓库在语义上是缓存”和“没有任何官方子命令可以清理”的表述过于宽泛：官方资料明确包括本地安装资产，官方 Dependency Plugin 支持项目/指定构件 purge。应修正为混合用途本地仓库，以及官方 purge 不等于全仓库未引用 prune。[S1][S6]

## 主要来源

- [S1 — Apache Maven Resolver: Local Repository](https://maven.apache.org/resolver/local-repository.html)
- [S2 — Resolver 1.9.22 EnhancedLocalRepositoryManager 源码](https://github.com/apache/maven-resolver/blob/maven-resolver-1.9.22/maven-resolver-impl/src/main/java/org/eclipse/aether/internal/impl/EnhancedLocalRepositoryManager.java)
- [S3 — Resolver 2.0.24 EnhancedLocalRepositoryManager 源码](https://github.com/apache/maven-resolver/blob/maven-resolver-2.0.24/maven-resolver-impl/src/main/java/org/eclipse/aether/internal/impl/EnhancedLocalRepositoryManager.java)
- [S4 — Dependency Plugin: dependency:analyze](https://maven.apache.org/plugins/maven-dependency-plugin/analyze-mojo.html)
- [S5 — Dependency Analyzer 1.17.0 DefaultProjectDependencyAnalyzer 源码](https://github.com/apache/maven-dependency-analyzer/blob/maven-dependency-analyzer-1.17.0/src/main/java/org/apache/maven/shared/dependency/analyzer/DefaultProjectDependencyAnalyzer.java)
- [S6 — Dependency Plugin: dependency:purge-local-repository 参数](https://maven.apache.org/plugins/maven-dependency-plugin/purge-local-repository-mojo.html)
- [S7 — Dependency Plugin 3.11.0 PurgeLocalRepositoryMojo 源码](https://github.com/apache/maven-dependency-plugin/blob/maven-dependency-plugin-3.11.0/src/main/java/org/apache/maven/plugins/dependency/PurgeLocalRepositoryMojo.java)
- [S8 — Dependency Plugin 3.8.1 PurgeLocalRepositoryMojo 源码](https://github.com/apache/maven-dependency-plugin/blob/maven-dependency-plugin-3.8.1/src/main/java/org/apache/maven/plugins/dependency/PurgeLocalRepositoryMojo.java)
- [S9 — Dependency Plugin: dependency:go-offline](https://maven.apache.org/plugins/maven-dependency-plugin/go-offline-mojo.html)
- [S10 — Dependency Plugin 3.11.0 GoOfflineMojo 源码](https://github.com/apache/maven-dependency-plugin/blob/maven-dependency-plugin-3.11.0/src/main/java/org/apache/maven/plugins/dependency/resolvers/GoOfflineMojo.java)
- [S11 — Dependency Plugin 3.11.0 ResolverUtil 源码](https://github.com/apache/maven-dependency-plugin/blob/maven-dependency-plugin-3.11.0/src/main/java/org/apache/maven/plugins/dependency/utils/ResolverUtil.java)
- [S12 — Apache Maven: Introduction to Build Profiles](https://maven.apache.org/guides/introduction/introduction-to-profiles.html)
- [S13 — Maven 3.9.11 Core Default Bindings](https://maven.apache.org/ref/3.9.11/maven-core/default-bindings.html)
- [S14 — Apache Maven: Guide to Using Extensions](https://maven.apache.org/guides/mini/guide-using-extensions.html)
- [S15 — Apple XNU mount.h，MNT_NOATIME / MNT_STRICTATIME](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/mount.h)
- [S16 — Maven Model Builder: Introduction](https://maven.apache.org/maven-model-builder/)
- [S17 — Maven Surefire: Selecting Providers](https://maven.apache.org/components/surefire/maven-surefire-plugin/examples/providers.html)
- [S18 — Maven 3.9.9 MavenXpp3Reader 源码](https://maven.apache.org/ref/3.9.9/maven-model/xref/org/apache/maven/model/io/xpp3/MavenXpp3Reader.html)：默认通过 `EntityReplacementMap.defaultEntityReplacementMap` 读取 POM。
- [S19 — Plexus XML 默认实体映射源码](https://github.com/codehaus-plexus/plexus-xml/blob/master/src/main/java/org/codehaus/plexus/util/xml/pull/EntityReplacementMap.java)：包括标准 Latin-1 命名实体，例如 `oslash` 为 U+00F8。

2026-11-04 只读检查真实仓库：6 个缺失外部 POM 的 Apache Maven 插件 JAR 均包含对应 GA 的 `META-INF/maven/<groupId>/<artifactId>/pom.xml`。此观察只证明该模型在当前 JAR 内，不能证明完整传递引用。模型内容作为数据读取并观察 JAR 摘要；没有启动 Maven 或执行插件。
