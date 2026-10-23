# 命令位置关联

Status: ready-for-agent

## 目标与范围

把环境诊断中每个可执行命令候选的规范化目标路径，与当前会话已观察到的安装范围、包安装路径和 pip 解释器做路径包含／相等比较，解释同一命令的多个 PATH 候选分别落在哪些已观察位置内。用户可以看到：哪些候选有位置证据、哪些候选只落在更宽的管理范围内、哪些候选在当前观察中没有任何位置证据，以及哪些候选无法判断。

关联只陈述位置事实：不推断某管理器或包安装了该命令，不推荐“正确”来源，不比较版本，不执行候选，也不读取文件内容。

纳入：

- 已启用管理器在当前会话中的快照。
- 管理器级安装范围、包级安装路径、pip 观察来源的解释器。
- 环境诊断命令展开区的逐候选证据、命令摘要与面板级关联范围说明。
- 只读 Rust 关联命令；不修改快照 schema，不持久化，不执行程序。

不纳入：

- 维护操作、新的观察项、观察台账记录、关联历史或任何持久化。
- 新增页签、管理器页反向视图、从关联定位到具体包。
- 名称／版本／shebang／npm `bin` 字段推断；候选执行；文件内容读取。
- `ScanDiagnostics.executables`、Docker 端点、Maven 本地仓库、缓存、store、配置目录。
- 归属判断、“主来源”或“推荐来源”。

## 已确认决策

用户于 2026-10-23 分三轮确认，并在复核本机实测路径后修订了两项（纳入 pip 解释器、跨管理器具体度抑制）。

### 断言边界

- 只断言“可执行候选的规范化目标路径位于或等于某个已观察命令位置”。
- 不写“由…安装”“属于…”，不排序候选，不比较版本，不把关联当作维护授权或安装证明。
- 不改变现有 `selectedPath`（PATH 中首个可执行候选）与命令状态语义。

### 关联对象与位置纳入

- 两级位置：管理器安装范围与包安装路径；pip 解释器作为来源组成位置纳入。
- 只纳入安装类路径与包路径；缓存、store、本地仓库、配置目录不参与。
- `ScanDiagnostics.executables` 不参与：它只解析快照维护命令用到的 program，不能证明扫描实际执行了该 CLI。
- 已停用管理器不参与；即使内存中仍有快照也排除。

### 证据规则

- 候选必须 `status === "executable"` 且有 `target`；其他候选不产生关联。
- 只使用规范化路径的包含／相等；不按文件名、包名、版本、shebang 或 npm `bin` 元数据推断，不执行候选。
- 目标路径使用环境诊断观察到的 canonical `target`；位置路径由 Rust 在计算时规范化。
- 规范化失败的位置作为证据缺口返回，不静默丢弃。
- 文件位置只做相等；目录位置做路径边界感知的包含（组件级，不是字符串前缀）。

### 具体度与跨管理器嵌套

- 同一管理器内：显示最具体的来源根 + 所有命中的包 + 解释器。
- 跨管理器：只在目录型位置之间比较具体度；更具体的目录命中抑制更宽的目录命中。
- 文件相等匹配（解释器、文件型包路径）不抑制任何位置，也不被目录型匹配抑制。
- 被抑制的跨管理器位置进入折叠的「其他更宽的包含位置」，每个被完全抑制的管理器显示其最具体的一条位置。
- 不做跨候选去重：同一文件出现在多个 PATH 项时，每个候选分别显示证据。

### 状态与覆盖

- **已关联**：至少一条可见包含／相等关系。
- **未找到**：没有任何可见匹配，且至少存在一个可用位置；文案固定为「当前已观察位置中未找到」。
- **无法判断**：完全没有可用位置（例如本次会话没有扫描任何已启用管理器，或所有位置都无法规范化）。
- `partial`、最近扫描异常、观察失效仍可显示已有关联，但必须在组头标注。
- 未扫描、失败、`partial`、`unsupported` 与已停用管理器列入关联范围说明。
- 关联计算失败与「无法判断」分开表达；失败时不显示「未找到」。

### 时点与生命周期

- 关联是派生结果：环境诊断 `capturedAt` + 管理器快照 + 扫描状态 + 台账失效状态。
- 不持久化、不新增观察项、不写台账、不自动扫描管理器。
- 环境诊断、管理器快照、扫描时间／异常状态或管理器失效状态变化时自动重算；不新增刷新按钮。
- 显示两侧观察时间；不宣称两个观察同时发生。

### 界面

- 只放在健康 → 环境诊断。
- 静态 program→managers 按钮保留，增加「相关管理器」标签，与位置证据区分。
- 面板顶部固定说明「位于已观察位置不代表由该管理器或包安装」。

### 计算

- 新增只读 Rust 命令；不修改快照 schema、不持久化、不执行任何程序。
- 前端负责构建位置描述与展示；Rust 负责规范化、匹配与跨管理器抑制标记。

## 位置纳入清单

### 管理器来源根

| 管理器 | 纳入的 `PathKind` | 说明 |
| --- | --- | --- |
| npm | `GlobalModules` | 全局包安装根 |
| pnpm | `GlobalModules` | 其自身 CLI 可能由 corepack 提供，关联结果以实际路径为准 |
| Yarn | `GlobalDir` | 仅 Yarn Classic；Yarn 2+ 为 `Unsupported` |
| nvm | `NvmNodeVersions` | 不使用更宽的 `NvmDir` |
| Homebrew | `Prefix`、`Cellar`、`Caskroom` | `Prefix` 是宽范围，只有宽范围命中时标为「管理范围」 |
| Maven | 无 | `LocalRepository` 不是命令安装位置 |
| pip | `SitePackages`、`UserSite` | 另加解释器位置，见下 |
| Cargo | `CargoBin` | — |
| Docker | 无 | `DockerConfig`、`DockerBuildx`、`DockerDesktopData` 都不是命令安装位置 |
| Bun | `BunInstall` | `BunInstall` 是 `~/.bun`，可能包含缓存子树；只处理 PATH 候选 |
| uv | `UvTools`、`UvPythonInstallations` | — |
| FVM | `FvmVersions` | — |

明确排除的 `PathKind`：`Cache`、`NpxCache`、`Store`、`NvmDir`、`CargoRegistryCache`、`CargoRegistrySource`、`CargoGitCache`、`CargoGitCheckouts`、`DockerConfig`、`DockerBuildx`、`DockerDesktopData`、`BunCache`、`UvCache`、`FvmGitCache`、`LocalRepository`。

### 包路径

- `PackageRow.path` 非 `null` 且 `PackageKind` 不属于排除集合时纳入。
- 排除：`MavenArtifact`、`DockerImage`、`DockerContainer`、`DockerVolume`。
- `UvTool`、Yarn 包等 `path = null` 的行自然不产生包级关联。
- 路径可能是目录（npm/pnpm/Homebrew/pip/nvm/uv Python/FVM 等）或文件（Cargo 已安装二进制、Bun 全局 bin）；匹配统一使用「相等或包含」，文件自然退化为相等。

### pip 解释器

- 来源：`ManagerSnapshot.pip.pythonExecutable`。
- 仅做文件相等匹配；显示为「解释器」。
- 该位置表示「Pip 观察使用的解释器」，不表示 Pip 安装了该 Python。
- `pip3` 指向另一个未被观察的解释器时，仍如实显示未找到。

### 不在位置清单中的管理器细节

- Maven、Docker 的观察范围不包含自身 CLI 安装位置，因此 `mvn`、`java`、`docker` 通常只会通过 Homebrew 等其他已观察位置关联。
- pip 观察不包含命令脚本安装目录（环境 `bin/`），因此 pip 安装的 console script 可能只落入更宽的 Homebrew Prefix，或完全未找到。
- 这些是已确认的能力边界，不用文件名、shebang 或包元数据补足。

## 具体度与抑制算法

### 术语

- **位置描述**：前端从当前快照构建的 `source`、`package` 或 `interpreter` 位置。
- **目录型位置**：来源根或目录型包路径。
- **文件型位置**：解释器、文件型包路径。
- **可见匹配**：未被跨管理器抑制的匹配。

### Rust 匹配

1. 对每个位置路径做 `canonicalize` 与元数据读取；失败的位置 ID 放入 `unreadableLocationIds`。
2. 对每个目标：
   - 文件型位置：canonical target 与 canonical location 相等时产生 `equal` 匹配。
   - 目录型位置：canonical target 等于或位于 canonical location 之下时产生 `contained` 匹配；使用组件级 `Path::starts_with`，确保 `/a/b` 不匹配 `/a/bc`。
3. 仅对同一目标、跨管理器的**目录型匹配**做抑制：
   - 若匹配 A 的目录严格包含匹配 B 的目录，且 A、B 属于不同管理器，则 A 被 B 抑制。
   - 取能抑制 A 的最深（canonical 路径最长）目录匹配作为 `suppressedBy`；深度相同不互相抑制。
   - 文件型匹配不参与抑制。
4. 返回全部匹配（含被抑制的），以及无法规范化的位置 ID。

### 前端展示选择

- 按管理器分组；只有存在至少一条可见匹配的管理器才显示为可见组。
- 同管理器内：
  - 来源行：最具体的可见来源匹配（canonical 路径最长）。
  - 包行：所有可见包匹配，按 canonical 路径从深到浅。
  - 解释器行：所有可见解释器匹配。
- 「其他更宽的包含位置」：仅列出**所有匹配都被抑制**的管理器；每个管理器取最具体的一条被抑制位置。已经出现在可见组里的管理器不再重复列入。
- 同一管理器的更宽来源根（如 Homebrew Prefix 与 Cellar）不在折叠区重复列出；来源行已经选择最具体的一条。
- 相等路径不互相抑制；来自不同管理器的相等路径都可见。

### 典型结果

以下为通用路径示例，实现不得硬编码任何管理器与命令的对应关系。

| 场景 | 可见结果 | 折叠的宽范围 |
| --- | --- | --- |
| `node` 在 nvm 版本目录 | Nvm 来源 + Node 版本包 | 无 |
| `npm` 在 nvm 的全局模块目录 | Npm 来源 + npm 包 | nvm（版本目录是其父范围） |
| `pnpm`／`yarn` 是 corepack shim | Npm 来源 + corepack 包 | nvm |
| `python3` 指向 uv Python | Uv 来源 + Uv Python 包 + Pip 解释器 | 无 |
| `pip3` 指向 `/usr/bin` | 未找到 | 无 |
| `brew` 在 Homebrew Prefix | Homebrew 管理范围 | 无 |
| `uv`／`fvm` 由 Homebrew 安装 | Homebrew Cellar + 对应 formula 包 | 无 |
| `mvn` 在 SDKMAN、`docker` 在应用包内 | 未找到 | 无 |

`pnpm`／`yarn` 关联到 npm/corepack 是有意的路径事实：它们的 shim 实际位于 npm 观察到的全局模块目录中。静态「相关管理器」仍指向 Pnpm／Yarn，两者回答不同问题。

## 状态模型

### 逐候选

```ts
type CommandLocationState = "associated" | "notFound" | "indeterminate" | "notApplicable";
```

- `notApplicable`：候选不是 `executable` 或没有 `target`；不显示关联内容。
- `indeterminate`：没有任何可用位置。
- `associated`：至少一条可见匹配。
- `notFound`：有可用位置，但没有任何匹配。

### 命令摘要

- 没有可执行候选（如 `missing` 命令）：不追加关联摘要。
- 关联计算失败：不追加摘要，只显示面板级错误。
- `indeterminate`：显示「无法判断」。
- 有可见匹配：显示「已关联 N 个管理器」，N 为该命令所有可执行候选的可见管理器去重数。
- 无可见匹配：显示「当前已观察位置中未找到」。

### 面板

- 没有可用位置且有可执行候选：面板级「无法判断」提示；不再逐条显示「未找到」。
- 关联命令失败：面板级「关联计算失败」；保留环境诊断内容；不显示「未找到」。
- 已停用管理器不参与；在关联范围中注明。

## 数据模型与 RPC

### 前端位置描述

```ts
type CommandLocationKind = "source" | "package" | "interpreter";

interface CommandLocationDescriptor {
  id: string;
  managerId: ManagerId;
  kind: CommandLocationKind;
  path: string;          // 快照中观察到的路径，展示用
  label: string;         // PathInfo.label / `${name}@${version}` / "解释器"
  canonicalPath?: never; // 规范化只发生在 Rust，前端不缓存
}
```

### RPC 输入

```ts
interface CommandLocationTarget {
  id: string;    // `${program}:${candidate.pathIndex}`
  target: string; // 环境诊断中的 canonical target
}

interface CommandLocationInput {
  id: string;    // 前端稳定 ID
  managerId: ManagerId;
  path: string;  // 观察到的路径
}

interface AssociateCommandLocationsRequest {
  targets: CommandLocationTarget[];
  locations: CommandLocationInput[];
}
```

### RPC 输出

```ts
interface CommandLocationMatch {
  targetId: string;
  locationId: string;
  relation: "equal" | "contained";
  canonicalLocation: string;   // 前端用于具体度排序，不用于展示
  suppressedBy: string | null; // 跨管理器更具体目录匹配的 locationId
}

interface AssociateCommandLocationsResult {
  matches: CommandLocationMatch[];
  unreadableLocationIds: string[];
}
```

### 命令

- 名称：`associate_command_locations`。
- Rust 模块：建议 `src-tauri/src/command_location_association.rs`。
- 注册：`src-tauri/src/lib.rs` 的 `generate_handler!`；沿用 `inspect_environment` 的 `spawn_blocking` 模式。
- 只读：只做 `canonicalize`／元数据读取／字符串比较；不读取文件内容，不执行候选，不写入任何位置。
- 输入路径应为绝对路径；无法读取或规范化的位置进入 `unreadableLocationIds`，不作为命令级错误。
- 不限制目标或位置数量；前端控制输入。实际计算为 O(目标数 × 位置数)，抑制只在命中集合上做。

### 前端构建规则

- 只处理 `enabledManagers` 中、当前会话有 `ManagerSnapshot` 的管理器。
- 来源根按上表过滤；包路径按排除集合过滤；pip 添加解释器。
- 相同 `(managerId, path, kind, label)` 的描述去重。
- 目标只包含 `status === "executable"` 且有 `target` 的候选；ID 使用 `${program}:${pathIndex}`，保留别名候选的重复。
- 不使用归档快照、`ScanDiagnostics`、缓存或已停用管理器的快照。

### 前端 Hook

建议新增 `src/hooks/useCommandLocationAssociations.ts`：

- 输入：`environment`、`enabledManagers`、`managerSnapshots`、`scanStates`、`observationLedger.records`。
- 用稳定 key 触发重算：环境对象、已启用管理器集合、快照对象、管理器的 `scannedAt`／`error`／`lastReadFailed`、管理器失效记录；扫描 `phase` 变化不应触发重算。
- 用序列号忽略过期响应，模式与 `useObservationTools` 一致。
- 没有目标或位置时不调用 RPC；全无可用位置时直接得出 `indeterminate`。
- 保留上一次结果直到新结果返回；提供 `busy`、`error`、`unreadableLocationIds`。
- 不调用 `recordObservation`，不新增观察项。

`App.tsx` 已持有 `state.managerSnapshots`、`state.scanStates`、`state.enabledManagers`、`observationLedger.records`；这些通过 `EnvironmentPanel` 的新 props 传入。

## 界面

### 面板头部

- 保留现有标题与“刷新诊断”按钮。
- 在现有说明后加入：「关联只说明候选的目标路径位于某次观察到的安装位置内；不代表该管理器或包安装了它，也不比较版本或选择正确来源。」
- 观察时间行追加「关联范围」折叠入口，概要显示已观察管理器数量。

### 命令摘要

- 在现有 `program`、来源状态、`selectedPath` 后追加关联摘要。
- `aliases`／`multiple` 等现有状态不变。

### 命令展开区

- 保留「相关管理器」标签与按钮（按钮执行现有 `onOpenManager`）。
- 每个候选保留现有 PATH 项、路径、文件目标、消息。
- 可执行且有 target 的候选：

```text
[管理器组]
  npm · 观察于 2026/10/23 12:30 · 读取不完整        [查看管理器]
  管理范围 · Global modules · /…/lib/node_modules
  包 · corepack@0.34.6 · /…/node_modules/corepack
  解释器 · /…/bin/python3.12

[其他更宽的包含位置（1）]
  nvm · Node 版本目录 · /…/versions/node/v24.15.0
```

- 组头显示：管理器、观察时间、状态说明（读取不完整／最近扫描异常／最近扫描失败／观察已失效）、查看管理器。
- 组内顺序：管理范围 → 包（深到浅）→ 解释器。
- 路径展示快照中的观察路径；不使用 canonical 路径。
- 每条展示的位置路径提供复制操作，复用现有 `copyPath`。
- 无匹配：一行「当前已观察位置中未找到」。
- 被抑制的宽范围：折叠区标题「其他更宽的包含位置（N）」；说明「这些观察范围也包含该文件，但存在更具体的已观察位置；不代表安装归属。」
- 非 executable 候选不显示关联内容。
- 别名候选重复显示相同证据；不跨候选去重（命令状态已说明多个路径指向同一文件）。

### 关联范围

折叠区内容：

- 按 `managerOrder` 列出已启用管理器。
- 每个管理器显示：观察时间、状态（未扫描／扫描中／读取不完整／最近扫描异常／最近扫描失败／不支持）、可用位置数量。
- 没有纳入位置的已观察管理器注明「该观察范围不含命令安装位置」（Maven、Docker；Yarn 2+）。
- 列出已停用管理器：「已停用，不参与关联：…」。
- 注明「只使用当前会话中的管理器快照，不使用历史快照」。

### 无法判断与失败

- 无可用位置且有可执行候选：面板级提示「尚无已观察命令位置，无法判断关联。」；逐候选不显示「未找到」。
- 关联 RPC 失败：面板级「命令位置关联计算失败」+ 错误信息；保留诊断；不显示「未找到」。
- 计算中：显示「正在计算命令位置关联…」；保留上一次结果。

### 可访问性

- 关联组使用可识别的标题或 `aria-label`；复制按钮带位置类型；状态不只靠颜色。
- 折叠区保持键盘可达。

## 非目标

- 不新增维护操作、删除能力、清理授权或核对流程。
- 不新增观察项、不写观察台账、不新增覆盖度条目、不持久化关联结果。
- 不做安装归属、主来源、推荐来源或版本比较。
- 不执行候选，不读取文件内容，不解析 shebang，不读取 npm `bin` 字段。
- 不纳入 `ScanDiagnostics`、Docker 端点、Maven 本地仓库、缓存、store、配置目录。
- 不新增独立页签，不在管理器页反向显示命令，不提供从关联定位到具体包。
- 不自动扫描管理器，不使用历史快照。
- 不做跨候选去重或 shim 语义识别；corepack 只会作为普通包路径出现。

## 隐私与安全

- 关联结果只在内存中；不导出、不落盘、不写入维护历史。
- Rust 命令只读取路径元数据；不读取文件内容、不执行程序、不修改文件。
- 前端提交的路径只用于只读匹配，不能进入任何执行 allowlist 或删除路径。
- 报告中的路径属于本机；沿用现有本地数据边界。

## 测试策略

### Rust

- 文件相等匹配、目录组件级包含、`/a/b` 不匹配 `/a/bc`。
- 符号链接位置规范化；目标按环境观察的 canonical target 使用。
- 跨管理器目录抑制：nvm 版本目录 vs npm 全局目录；Homebrew Prefix vs npm/pip/Yarn 根；uv Python 根 vs pip site-packages。
- 文件匹配不抑制：uv Python 包 + pip 解释器同时可见。
- 相同路径不互相抑制；同管理器路径不产生跨管理器抑制。
- 无法规范化的位置进入 `unreadableLocationIds`。
- 不执行候选：使用会写标记文件的脚本作为候选，确认匹配后标记不存在。
- 空输入、无匹配、多目标多位置。

### TypeScript

- 描述构建：管理者过滤、`PathKind` 纳入/排除、`PackageKind` 排除、pip 解释器、已停用管理器、`path = null`。
- 目标构建：只取 executable 且有 target；别名候选保留独立 ID。
- 可见匹配选择：最具体来源根、包深到浅、解释器最后、折叠区只列完全被抑制的管理器。
- 状态派生：associated／notFound／indeterminate／notApplicable；命令摘要去重计数；RPC 失败不产生 notFound。
- 范围说明：未扫描、partial、失败、unsupported、无位置、已停用。
- 不调用 `recordObservation`。
- 过期响应按序列号丢弃。

### UI

- 使用 `src/test/fixtures.ts` 与 mock `invoke`：
  - nvm/npm/corepack 场景：npm 可见、nvm 折叠。
  - uv/pip 场景：Uv + Pip 解释器。
  - Homebrew 宽范围：管理范围行。
  - 未找到、无法判断、RPC 失败、扫描中、失效说明。
  - 相关管理器按钮仍可导航；复制路径回调；折叠区可展开。
- 不执行真实扫描或维护。

### 验证

- `pnpm test`
- `pnpm build`
- `cargo test`
- 在 `pnpm tauri dev` 下用真实本机路径核对至少：nvm 管理的 node/npm/pnpm/corepack、uv 管理的 python3 与 pip、Homebrew 安装的 uv/fvm、`brew`、未关联的 `mvn`/`docker`。
- 不使用真实维护操作。

## 风险与验证点

- **跨时点规范化**：环境诊断、管理器扫描与关联计算发生在不同时刻；界面显示两侧观察时间，不宣称同时性，也不把关联当作当前安装状态。位置无法读取时只算证据缺口。
- **宽范围误导**：Homebrew Prefix 可能包含 pip 安装的 console script，但未观察其 `bin/`；没有 shebang/bin 元数据时无法正确归属。用「管理范围」标签与固定说明降低误读，不引入推断。
- **具体度抑制可能隐藏运行环境**：例如 nvm 版本目录被 npm 全局目录抑制；折叠区保留该事实。测试必须覆盖 nvm/npm 与 Homebrew/npm。
- **性能**：位置可能上千；按稳定 key 重算，规范化每个位置一次，避免因扫描阶段变化或无关台账变化重复调用。
- **失效与不完整**：positive 匹配仍显示，但必须标注；negative 只在有可用位置时使用限定文案。
- **RPC 失败与未找到混淆**：失败状态必须独立，且不渲染「未找到」。
- **快照语义差异**：`PackageRow.path` 可能是目录、文件或 `null`；构建描述时按规则过滤，不能假设都是目录。
- **静态映射与证据混淆**：`command.managers` 仅是导航；关联范围可以包含不在该列表中的管理器（如 Homebrew 对 `python3`）。
- **不新增观察项**：不得调用台账接口，避免把派生关联误表示为新的观察覆盖度。

## 实施切片（建议）

1. Rust `command_location_association` 模块、命令注册与测试：规范化、文件/目录匹配、跨管理器抑制、不可读位置。
2. TypeScript 描述构建与纯派生函数：位置清单、目标、可见/抑制选择、状态与摘要。
3. Hook 与 `App.tsx`／`EnvironmentPanel` 接线：props、序列号、稳定重算 key、busy/error、不写台账。
4. 界面：证据分组、折叠宽范围、命令摘要、关联范围、无法判断/失败提示、复制与导航。
5. 验证：Rust/TS/UI 测试、`pnpm build`、真实本机路径核对。

不新增 ADR：该语义边界可由本 PRD 记录并随产品演进调整，尚未达到难以逆转的程度。
