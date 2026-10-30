# Android SDK 清单读取本地元数据，维护委派 CLI

Android SDK 没有单一的包数据库：每个组件目录携带 `package.xml`，少数组件（如 NDK、cmdline-tools）只携带 `source.properties`。官方 CLI 有两套：`sdkmanager` 已弃用；新的 `android sdk list` 才把 NDK 与 cmdline-tools 计入清单。样本 SDK 根上，`sdkmanager --list_installed` 报告 9 项并漏掉 NDK 与 cmdline-tools，新 CLI 报告 11 项但把两者版本显示为 unknown；两者都需要 Java，新 CLI 单次读取约 3.7 秒。

决定：观察只读取 SDK 根目录内的逐组件元数据（`package.xml` + `source.properties`），不调用 CLI、不联网；组件身份采用元数据中的分号路径。维护动作执行时再解析 SDK 根内的新 `android` CLI（用 `--sdk` 绑定根目录），缺失时回退 `sdkmanager --uninstall`；CLI 缺失只影响操作资格，不影响观察。删除由 CLI 完成，沿用 [ADR-0001](0001-delegated-cache-cleanup.md) 的委托边界。

## Considered Options

- 以新 `android sdk list` 为清单：官方视图，但要求新版 cmdline-tools 与 Java；实测已安装版本显示 unknown，扫描明显变慢；旧 SDK 还需回退第二套 CLI 解析。否决。
- 以 `sdkmanager --list_installed` 为清单：已弃用，且在样本 SDK 上漏报 NDK 与 cmdline-tools。否决。
- 本地元数据 + 护栏删除：组件是用户资产，删除应由拥有它的 CLI 执行；自己删除会复制 SDK 的组件布局知识并承担误删风险。否决。
- 联网读取远端仓库并标记可更新：把网络状态混入快照，与「信号只描述本地可复核事实」冲突；更新只作为可复制命令。否决。
- 本地元数据清单 + CLI 维护：采纳。

## Consequences

- 清单覆盖所有带可解析元数据的组件，包括 CLI 漏报的 NDK 与 cmdline-tools；没有可解析元数据的目录不造行，只让快照呈现 `Partial`。
- 观察不依赖 Java、CLI 或网络；扫描成本主要是 SDK 根目录的占用测量。
- 观察来源是单一 SDK 根（`ANDROID_HOME` → `ANDROID_SDK_ROOT` → 默认路径）；根路径变化即范围变化。
- 卸载资格要求 SDK 根内可解析到可用的 CLI；新 CLI 与 `sdkmanager` 的包名分隔符不同（斜杠与分号），由组件身份派生。
- 确认时的 SDK 根随维护请求冻结；执行时在该根内重新核对组件，不在环境变量后来指向的其他根上操作。
- CLI 的实际删除行为属于被委托方；本工具按目标记录拒绝或失败，不推断整体成功，也不承诺可恢复。
- 只有集中式包索引的旧版布局标记为 `Unsupported`；根目录与占用仍可观察。
- 不安装、不更新，也不检查 AVD 或运行中进程对组件的引用；更新只作为可复制命令，不执行。
