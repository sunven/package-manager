# Maven 构建目录使用委托清理

Maven 项目的 `target` 是项目派生数据，官方清理命令是 `mvn clean`。我们决定把 Maven 构建目录纳入项目清理，沿用 [ADR-0003](./0003-build-cleanup-uses-scan-session-candidates.md) 的扫描会话模型，机制为委托清理：后端只接受当前扫描会话中的候选 ID，执行时以 `mvn -B -N -f <pom.xml> clean` 清理用户选中的候选。`-N`（non-recursive）保证只清理选中模块，不连带删除未选中的子模块 `target`。身份检查要求候选根级包含 Maven 产物标记（如 `maven-status/`、`classes/`、`test-classes/`），执行前重新验证。扫描时仅在发现 Maven 候选时探测 `mvn --version`；不可用时 Maven 候选标为不可清理，不影响其他候选类型。

## Considered Options

- **护栏删除 `target`**（类似 [ADR-0004](./0004-node-dependency-directories-use-guarded-deletion.md) 的 node_modules）：被否决。`target` 有官方清理命令，删除语义应由 Maven 定义；且 `target` 没有 `CACHEDIR.TAG` 级别的硬标记，路径身份论证强度不足。
- **不带 `-N`**：被否决。会越过批次冻结的候选集合，连带删除未选中的子模块构建目录。
- **离线开关 `-o`**：被否决。clean 插件未缓存时 `-o` 会直接失败；不加 `-o` 的代价是首次运行可能下载 clean 插件写入 `~/.m2`，属非破坏性副作用。

## Consequences

- v1 只按约定名 `target` 处理，不解析 pom 自定义的 `<directory>`；此类项目 `mvn clean` 清理的是自定义目录，`target` 候选会以 PartiallyCompleted 如实呈现，而不是假成功。
- v1 只用 PATH 上的 `mvn`，不偏好项目内 `mvnw`。
- 与 [ADR-0001](./0001-delegated-cache-cleanup.md) 一致：本工具不亲自删除 Maven 构建目录；该能力不构成对管理器缓存护栏删除的放宽。
