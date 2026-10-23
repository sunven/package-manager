# 跨领域维护历史

Status: ready-for-agent

## 目标与范围

把现有只覆盖管理器缓存清理与 npm／pnpm 全局包卸载的持久维护记录，扩展为覆盖项目清理、VS Code 工作区存储移除和会话记录操作的跨领域维护历史。一次用户确认对应一条记录，批次中的每个操作目标保留独立结果；各领域继续保留自己的资格、恢复边界、状态原因和空间口径。

纳入领域：

- 管理器维护：缓存清理、全局包卸载。
- 项目清理：一轮清理批次（Rust target 与 Node 依赖目录可混合）。
- VS Code 工作区存储移除：一次确认移除的一批记录。
- 会话记录操作：Codex／Claude 移入废纸篓，OpenCode 永久删除（含级联删除）。

不纳入：Codex／Claude 的插件、市场、技能、钩子等代理扩展维护；观察快照与项目扫描本身不进入维护记录。

设计依据：[ADR-0027](../../../docs/adr/0027-cross-domain-maintenance-history-shares-envelope-not-policy.md)；关联 ADR-0023（会话操作共享生命周期、不共享策略）与 ADR-0026（VS Code 移除资格，其「不新增维护记录」结论已被取代）。

## 已确认决策

用户于 2026-10-23 分三轮确认以下决策。

### 范围、入口与粒度

- v1 纳入上述四个领域，包含 OpenCode 永久删除；代理扩展维护后续再做。
- 维护记录只记录会改变本机状态的操作，不并入只读观察。
- 现有「总览 > 历史」提升为顶层「历史」页，内含「维护记录」与「快照对比」两个分区；各领域页提供回链。
- 一条记录 = 一次用户确认的维护操作／批次；每个目标作为子结果保留，单目标操作只有一个子结果。
- 统一记录外壳 + 领域负载；不把四个领域压成通用删除模型。
- 执行摘要统一为 `succeeded / partial / failed / notExecuted / unconfirmed`，领域原始状态、原因和消息保留在子结果中。
- 「后续读取」与「核对」是两个独立事实：管理器维护有核对，会话与 VS Code 移除有后续读取，项目清理两者都没有；清理调用内的重新测量属于执行结果。
- 全局保留最近 500 条已关闭记录，不提供清空、导出或置顶；被淘汰记录关联的快照允许超出保留范围。

### 记录生命周期

- 用户确认后、第一个目标动手前创建记录；预检失败也留下一条 `notExecuted` 记录；取消确认不留下记录。
- 每完成一个目标就写入该目标结果；批次结束关闭记录。
- 应用退出时仍未关闭的记录，在下次启动、任何操作开始前标记为「已中断」，保留已写入目标结果，摘要保持 `unconfirmed`，之后按正常保留规则淘汰。
- 执行中的记录不因 500 条上限被淘汰。
- 历史写入失败只提示，不改变操作结果。写入权在 Rust；前端不能写入任意目标结果。

### 确认范围与空间口径

- 保存「规则 + 展示快照」：目标被移除后仍能读懂记录。
- 按年龄的会话移除只冻结来源 + 天数门槛 + 确认时条数；执行时候选总数另记。
- OpenCode 保存 `planId`、类型、门槛、冻结的根／级联列表；实际完成集合另记，并标出计划外新增后代。
- 只记录领域本来就有的测量；统一表述为目录占用或测量下限，不写「已释放空间」；会话操作没有测量就不显示大小；不为历史新增测量。

### 历史页与展示

- 列表返回摘要，选中后再取完整详情；按日期分组倒序；领域单选 + 状态筛选；首版不做时间范围、全文搜索或 ⌘K 接入。
- 进入页面时读取，操作完成后递增修订号触发重读；提供手动刷新；不轮询、不实时推送。执行中的记录在下一次读取时显示为「执行中」。
- 详情固定包含恢复边界、确认范围、执行结果、后续读取或核对、关联入口；沿用各领域现有状态与原因文案。
- 显示漂移：按年龄会话的确认条数 vs 执行时总数、OpenCode 计划外新增后代、项目清理因停止而未开始的目标。
- 领域结果区在记录落盘后显示「已保存到维护历史」；落盘失败显示警告。
- 历史导航放在「总览」之后；总览保留快捷入口；快照对比移入历史页第二分区。

### 隐私与安全

- 只记录识别与展示所需元数据（来源、目标身份、路径、最后活动时间、状态与原因）；不记录文件内容、消息正文、完整命令输出或环境变量。
- 数据仅保存在本机，不导出。
- 所有文本字段截断到 2000 字符；stdout／stderr 不写入历史。

## 领域映射

| 领域 | 操作 | 模式 | 确认范围 | 执行结果 | 后续读取 | 核对 | 恢复边界 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `manager` | `cleanupCache` | — | 管理器、维护前快照 | 步骤状态、失败信息 | 无 | 有（重新扫描 + 前后快照） | 委托清理／护栏删除，按原操作 |
| `manager` | `uninstallGlobalPackage` | — | 管理器、包名、维护前快照 | 成功／失败消息 | 无 | 有 | 用户资产移除，按原操作 |
| `projectCleanup` | `cleanBatch` | `completed` / `stopped` | 扫描会话、根目录、候选顺序与确认时测量 | 逐候选状态、命令、前后测量、失败信息 | 无 | 无 | Rust／Maven 委托清理；Node 依赖永久护栏删除 |
| `vscodeStorage` | `removeWorkspaceStorage` | — | 工作区记录展示快照 | 逐记录状态、原因、消息 | 自动重扫 | 无 | 移入废纸篓，清空前可恢复 |
| `sessionRecord` | `removeToTrash` | `single` / `selected` / `olderThan` | 来源与模式；单条／选中存记录快照，按年龄存门槛与确认条数 | 逐记录状态、原因、消息 | 自动重扫 | 无 | 移入废纸篓，清空前可恢复 |
| `sessionRecord` | `deletePermanently` | `single` / `selected` / `olderThan` | `planId`、门槛、冻结根／级联快照 | 逐根状态、消息、实际完成 ID | 自动重扫，预检失败可 `notRequested` | 无 | OpenCode 服务永久删除，含子会话，无法恢复 |

## 统一记录模型

线格式使用 camelCase。字段定义以本文件为准，Rust 与 TypeScript 镜像保持一致。

```ts
type MaintenanceDomain = "manager" | "projectCleanup" | "vscodeStorage" | "sessionRecord";

type MaintenanceOperation =
  | "cleanupCache"
  | "uninstallGlobalPackage"
  | "cleanBatch"
  | "removeWorkspaceStorage"
  | "removeToTrash"
  | "deletePermanently";

type ExecutionSummary = "succeeded" | "partial" | "failed" | "notExecuted" | "unconfirmed";
type FollowUpReadStatus = "notRequested" | "ready" | "failed";
type VerificationStatus = "succeeded" | "failed" | "notStarted" | "skipped";

interface MaintenanceRecord {
  id: string;
  domain: MaintenanceDomain;
  operation: MaintenanceOperation;
  startedAt: number;
  finishedAt: number | null;
  execution: ExecutionSummary;
  interrupted: boolean;
  message: string;
  followUpRead: FollowUpRead | null;
  verification: Verification | null;
  detail: DomainDetail;
}

interface FollowUpRead {
  status: FollowUpReadStatus;
  recordedAt: number;
  message: string | null;
}

interface Verification {
  status: VerificationStatus;
  recordedAt: number | null;
  message: string | null;
  beforeSnapshotId: string | null;
  afterSnapshotId: string | null;
}
```

`followUpRead` 最多写一次；管理器 `verification` 沿用现有可重试语义，最后一次写入生效。后续读取在自动重扫结束后写入，后续手动刷新不回写历史。

```ts
interface MaintenanceRecordSummary {
  id: string;
  domain: MaintenanceDomain;
  operation: MaintenanceOperation;
  startedAt: number;
  finishedAt: number | null;
  execution: ExecutionSummary;
  interrupted: boolean;
  subject: {
    managerId?: ManagerId;
    target?: string;
    rootPath?: string;
    source?: "codex" | "claude" | "opencode" | "vscode";
    mode?: "single" | "selected" | "olderThan";
    targetCount: number;
  };
  counts: { total: number; succeeded: number; failed: number; skipped: number; notAttempted: number };
  followUpReadStatus: FollowUpReadStatus | null;
  verificationStatus: VerificationStatus | null;
}
```

### 领域负载

```ts
interface ManagerDetail {
  kind: "manager";
  managerId: ManagerId;
  target: string | null;
  steps: ManagerStep[] | null; // 旧记录为 null
}

interface ManagerStep {
  label: string;
  state: "succeeded" | "failed" | "skipped";
  failureMessage: string | null;
}

interface ProjectCleanupDetail {
  kind: "projectCleanup";
  scope: {
    scanId: string;
    scanRootId: string;
    scanRootPath: string;
    batchId: string;
    candidates: ProjectCleanupCandidateSnapshot[];
  };
  finish: "completed" | "stopped";
  results: ProjectCleanupTargetResult[];
}

interface ProjectCleanupCandidateSnapshot {
  candidateId: string;
  kind: ProjectDataKind;
  projectPath: string;
  directoryPath: string;
  order: number;
  confirmedBytes: number | null;
  confirmedComplete: boolean;
}

interface ProjectCleanupTargetResult {
  candidateId: string;
  status: ProjectCleanupStatus;
  command: string;
  beforeBytes: number | null;
  afterBytes: number | null;
  cleanedBytes: number | null;
  measurementStatus: DirectoryMeasurementStatus;
  message: string;
  failureMessage: string | null;
  effectFailureMessage: string | null; // IPC 失败、没有原生结果时使用
}

interface VscodeStorageDetail {
  kind: "vscodeStorage";
  scope: { workspaces: VscodeWorkspaceSnapshot[] };
  results: VscodeStorageRemovalItem[];
}

interface VscodeWorkspaceSnapshot {
  id: string;
  name: string;
  projectPath: string | null;
  storagePath: string;
  kind: string;
  projectStatus: string;
  removable: boolean;
  removalBlockReason: string | null;
  bytes: number | null;
  usageComplete: boolean;
}

type SessionRecordDetail = SessionTrashDetail | OpenCodeDeletionDetail;

interface SessionTrashDetail {
  kind: "sessionTrash";
  scope: {
    source: "codex" | "claude";
    mode: "single" | "selected" | "olderThan";
    days: number | null;
    confirmedCount: number | null;
    confirmedRecords: SessionRecordSnapshot[] | null; // olderThan 为 null
  };
  executionTotal: number | null;
  results: SessionRemovalItem[];
}

interface SessionRecordSnapshot {
  id: string;
  title: string;
  workingDirectory: string | null;
  lastActivityMs: number | null;
}

interface OpenCodeDeletionDetail {
  kind: "openCodeDeletion";
  scope: {
    source: "opencode";
    mode: "single" | "selected" | "olderThan";
    planId: string;
    days: number | null;
    cutoffMs: number | null;
    confirmedRoots: OpenCodeSessionSnapshot[];
    confirmedAffected: OpenCodeSessionSnapshot[];
  };
  completedIds: string[];
  results: OpenCodeDeletionItem[];
}

interface OpenCodeSessionSnapshot {
  id: string;
  title: string;
  workingDirectory: string | null;
  lastActivityMs: number | null;
  archived: boolean;
  parentId: string | null;
}
```

领域负载由 `detail.kind` 判别：`manager`、`projectCleanup`、`vscodeStorage`、`sessionTrash`、`openCodeDeletion`。项目清理的目标若因批次停止而未执行，不会出现在 `results`；详情按 `scope.candidates` 与 `results` 的差集显示「未执行（批次停止）」。中断记录同理显示「未确认」。

## 执行摘要派生

记录关闭时按以下顺序派生 `execution`；管理器清理的步骤也适用同一规则。

1. 中断：`unconfirmed`。
2. 预检或首个目标前失败：`notExecuted`。
3. 无成功且至少一个失败：`failed`。
4. 有成功且存在失败、跳过或未开始：`partial`。
5. 全部成功：`succeeded`。
6. 全部跳过或没有目标：`notExecuted`。

补充规则：

- 管理器缓存清理以步骤状态派生；`NoPlan` 直接为 `notExecuted`。全局包卸载只有一个目标。
- 项目清理中 `Rejected` 计为失败，`Skipped` 计为跳过；停止后未执行的目标计入未开始，使摘要为 `partial`。
- 会话移除的 `operation_error` 或 OpenCode `preflight_error` 视为首个目标前失败；来源级错误不折算成目标失败。
- VS Code 运行中途启动导致剩余记录 `Skipped/EditorStarted` 时，摘要为 `partial`。
- 后续读取失败不改变执行摘要；核对失败也不改变执行摘要。

## 写入点与命令边界

Rust 独占写入权。所有命令在历史写入失败时仍执行原操作，并通过 `historyId` / `historyWarning` 返回事实。

### 读取命令

- `list_maintenance_history()` → `{ records: MaintenanceRecordSummary[], warnings: string[] }`，摘要按 `startedAt` 倒序，最多 500 条。
- `get_maintenance_record(id)` → `MaintenanceRecord`。
- `list_manager_history(manager)` 最终改为只返回该管理器的快照与读取警告；维护操作统一从 `list_maintenance_history` 读取。这是对现有 `ManagerHistory.operations` 的破坏性调整，前端与测试需同步更新。
- 过渡顺序：issue 01 先保留 `list_manager_history.operations` 的旧形状以维持现有 HistoryPanel；issue 02 移除旧操作列表并迁移快照对比；issue 07 彻底删除旧字段与映射。

摘要包含：外壳字段、领域主题（管理器／包名、扫描根目录、来源／模式、目标数量）、目标计数（`total / succeeded / failed / skipped / notAttempted`）、后续读取状态和核对状态。摘要不携带逐目标负载。

### 管理器维护

- 沿用 `HistoryState::run` 的「先写开始、执行、再写结束」顺序，改为写 v2 文档。
- 缓存清理把原生步骤结构化写入 `ManagerDetail.steps`；新记录不再只依赖拼接后的 `message`。
- 核对继续使用 `update_maintenance_verification`，允许在记录关闭后更新；记录已被淘汰时返回现有「维护记录已超出保留范围」警告。

### 项目清理

- 新增 `begin_project_cleanup_history(scope)` → `{ historyId, historyWarning }`，在批次确认后、首个候选清理前调用。
- 清理命令增加可选 `historyId`；Rust 在该候选结束后追加 `ProjectCleanupTargetResult`。
- IPC 调用本身失败时 Rust 没有执行记录；前端把 `{ candidateId, message }` 放进 `effectFailures`，由关闭命令写入。该字段只接受当前记录 `scope.candidates` 内的 ID，写入结果的状态为 `Failed` 且 `effectFailureMessage` 非空。
- 新增 `finish_project_cleanup_history(historyId, finish, effectFailures, message)`，在批次完成或停止后调用；Rust 校验 ID、追加失败结果、派生摘要并设置 `finishedAt`。
- 历史写入失败不阻止候选清理；前端在批次结果中汇总警告。
- 项目清理不写 `followUpRead` 或 `verification`。

### 会话记录移入废纸篓

- `remove_session_records` 与 `remove_session_records_older_than` 增加确认范围参数：
  - 单条／选中：`source`、`ids`、`confirmedRecords` 展示快照。
  - 按年龄：`source`、`days`、`confirmedCount`；执行时扫描总数写入 `detail.executionTotal`。
- Rust 在执行前写开始，逐条追加 `SessionRemovalItem`，结束后关闭。
- 前端在自动重扫完成后调用 `record_maintenance_followup(historyId, refresh.status, refresh.message)`；只接受 `sessionRecord`／`vscodeStorage` 且未写过后续读取的记录。

### OpenCode 永久删除

- `commit_opencode_deletion` 从 `planId` 对应的内存计划取得确认范围，写入 `confirmedRoots`、`confirmedAffected`、`planId`、门槛。
- 逐根追加 `OpenCodeDeletionItem`；完成集合写入 `completedIds`。实际完成 ID 不在 `confirmedAffected` 中时，详情标记为计划外新增后代。
- 预检失败时记录 `notExecuted`；前端按 `shouldRefresh` 结果写入 `followUpRead`（可为 `notRequested`）。

### VS Code 工作区存储移除

- `remove_vscode_workspace_storage` 增加确认工作区展示快照参数；Rust 仍只按 ID 执行，但历史保存确认时的名称、项目路径、存储路径、状态与占用。
- 逐条追加 `VscodeStorageRemovalItem`，结束后关闭；前端在自动重扫完成后写后续读取。
- 编辑器中途启动导致剩余项跳过时，保留每条 `EditorStarted` 原因。

## 存储与迁移

- 新文件：`app_data_dir()/manager-history/maintenance-v2.json`，文档 `{ version: 2, items: [...] }`。
- 快照文件 `snapshots-<ManagerId>.json` 与每管理器 20 份限额不变。
- 首次读取 v2 文件缺失且 v1 `maintenance.json` 存在时，迁移 v1 的管理器操作：
  - 保留 `id`、`startedAt`、`finishedAt`、`execution`、`message`、`operation`、`managerId`、`target`、`verification` 与前后快照 ID。
  - `domain = "manager"`；`detail.steps = null`；`followUpRead = null`；`finishedAt` 为空的记录标记 `interrupted = true`。
  - 写入 v2 后保留 v1 原文件作为备份，不删除、不覆盖。
- v2 已存在时忽略 v1。v1 损坏或版本不支持时，不迁移、不覆盖，启动为空历史并提示。
- v2 损坏或版本不支持时，保留原文件、提示读取错误；后续写入不得覆盖。
- 写入使用临时文件 + `flush` + `sync_all` + 原子替换；进程内互斥；延续「损坏文件不覆盖、历史失败不改变操作结果」。
- 保留：最多 500 条已关闭记录（`finishedAt != null` 或 `interrupted`）。执行中的记录始终保留。迁移后按同一上限裁剪。
- 应用启动、任何操作开始前，把上一进程遗留的未关闭记录标记为已中断并持久化；标记失败只提示，不阻止启动。

## 历史页

### 导航与分区

- 新增顶层 `history` 视图，导航位于「总览」之后；移除健康页的「历史」子页签。
- 页面顶部两个分区：`维护记录`（默认）与`快照对比`。快照对比沿用现管理器选择器、前后快照选择、差异和详情组件。
- 总览保留「历史」快捷入口。进入历史页时可携带 `{ domain?, recordId? }`，用于领域页回链。

### 维护记录列表

- 按本地日期分组、倒序；每条显示时间、领域、操作、摘要上下文、执行摘要、目标计数、后续读取／核对状态。
- 领域单选：全部、管理器维护、项目清理、VS Code 工作区存储移除、会话记录操作。
- 状态筛选：全部、已完成、部分完成、失败、未执行、未确认。
- 执行中／已中断在「未确认」摘要内用独立标签显示。
- 分页或虚拟滚动，首版每页 50 条；摘要加载后客户端筛选。
- 首版不提供时间范围、全文搜索、⌘K 集成、清空或导出。

### 记录详情

主从布局：列表 + 右侧详情；窄窗口详情改为覆盖层。详情按顺序：

1. 恢复边界说明。
2. 确认范围：领域特有字段与目标展示快照；按年龄会话显示「确认时 N 条」，OpenCode 显示计划与冻结列表。
3. 执行结果：批次汇总 + 逐目标表格；沿用领域状态与原因文案；显示漂移提示。
4. 后续读取或核对：状态、时间、消息；管理器显示前后快照入口；没有该步骤时显示「无后续读取」或「无核对步骤」。
5. 关联入口：领域页入口；管理器可跳转快照对比。

所有空间数字标注为目录占用／测量下限；不显示「已释放」总量。会话操作没有测量时不显示大小。历史不重新读取目标现状，不把目标仍存在或已消失解释为操作结果。

## 安全、隐私与边界

- Rust 校验记录 ID、领域、操作、后续读取状态与写入阶段；前端不能构造目标结果或改写确认范围。
- 历史写入失败、读取失败、损坏文件和版本不支持分别提示；历史读取失败不改变当前观察或操作结果。
- 只持久化元数据与展示快照；不写文件内容、会话标题以外的正文、stdout／stderr、环境变量。
- 路径（项目、存储、工作目录）属于本地历史；不提供导出、云同步或分享。
- 代理扩展维护、观察快照、扫描候选清单不进入维护历史。

## 非目标

- 不新增删除、清理或核对策略；不改变任何领域的资格、恢复方式或安全前置条件。
- 不为项目清理或 VS Code 移除新增操作后后台复核。
- 不提供历史清空、单条删除、置顶、导出、全文搜索或时间范围筛选。
- 不把历史做成撤销、备份或维护授权。
- 不记录代理扩展维护。

## 测试策略

- Rust：schema 序列化往返、v2 原子写、v1 迁移、500 条保留、执行中记录保护、启动中断标记、损坏／未来版本保护、并发写入。
- Rust 领域：管理器步骤结构化、项目清理开始／逐候选／结束与 IPC 失败、会话三种模式与后续读取、OpenCode 计划漂移与 `notRequested`、VS Code 编辑器中途启动。
- TypeScript：摘要计数与标签、筛选与日期分组、详情分节、恢复边界文案、漂移提示、链接解析。
- 工作流：历史写入失败不改变执行结果；项目清理批次停止；会话／VS Code 自动重扫后写后续读取；OpenCode 预检失败。
- UI：历史导航、快照对比未回归、列表筛选、详情加载、领域页回链、窄窗口覆盖层。
- 验证：`pnpm test`、`pnpm build`、`cargo test`；使用隔离浏览器 fixture 验证界面，不执行真实维护。

## Issues

- [01-add-unified-maintenance-history-store.md](./issues/01-add-unified-maintenance-history-store.md)
- [02-add-history-page.md](./issues/02-add-history-page.md)
- [03-record-project-cleanup-batches.md](./issues/03-record-project-cleanup-batches.md)
- [04-record-session-record-removals.md](./issues/04-record-session-record-removals.md)
- [05-record-opencode-deletions.md](./issues/05-record-opencode-deletions.md)
- [06-record-vscode-storage-removals.md](./issues/06-record-vscode-storage-removals.md)
- [07-surface-history-links-and-verify.md](./issues/07-surface-history-links-and-verify.md)

## 风险与验证点

- v1 迁移必须保留原文件；首次升级后要验证旧记录仍可读、ID／时间不变、快照链接可用。
- 逐目标写入会增加 JSON 重写频率；批次规模大时需确认不会明显拖慢清理。
- 项目清理的批次边界只在前端，历史正确性依赖 `begin` / `finish` / 逐候选 `historyId` 全部接线；任何一步失败都要在执行结果旁提示，而不是静默丢失。
- OpenCode 计划在 commit 时被消费，历史只能保存 `planId` 与冻结快照；实际完成集合可能包含计划外新增后代，详情必须显示漂移。
- 新建历史页会移动现有快照对比入口，需覆盖健康页、总览快捷入口与相关 UI 测试，避免出现两个历史入口。
