Status: ready-for-agent

# 接通领域页回链并验证跨领域历史

## Parent

.scratch/package-manager-opportunities/cross-domain-maintenance-history/PRD.md

## What to build

把各领域操作结果与维护历史接通：结果区显示记录是否已保存、可跳转到对应历史记录；跨领域写入都触发历史页重读；清理旧的 `ManagerHistory.operations` 过渡形状，更新架构图并做端到端验证。

### 回链与修订号

- App 维护一个历史请求状态 `{ domain?: MaintenanceDomain; recordId?: string }`，由领域页设置并切换 `activeView = "history"`；`HistoryPage` 消费后选中记录、应用领域筛选。
- 在各领域结果区增加回链：
  - 管理器：`MaintenanceConfirmationBanner` 在回执带 `historyId` 时显示「已保存到维护历史」；带 `historyWarning` 时显示警告；核对更新后链接仍指向同一记录。
  - 项目清理：批次结果摘要/提示在批次回执带 `historyId` 时显示链接；警告同理。
  - 会话记录与 OpenCode：结果 Alert 中显示链接；OpenCode `notRequested` 不影响链接。
  - VS Code：结果 Alert 中显示链接。
- 链接点击后打开历史页并选中记录；记录已超出保留范围或不存在时，历史页显示可读错误并保留列表，不静默失败。
- 所有领域在操作完成、后续读取写入和核对写入后递增现有 `historyRevision`，使历史页在下次进入或手动刷新时看到新事实。不要引入轮询或事件推送。
- 历史写入警告与历史读取错误保持分开：写入警告留在操作结果区；读取错误只在历史页显示。

### 清理过渡形状

- 移除 `list_manager_history` 返回的 `operations` 字段与 `ManagerHistory.operations`；维护操作只通过 `list_maintenance_history` 读取。
- 移除 `src/managerHistory.ts` 中仅服务于旧 HistoryPanel 的操作类型与标签；保留快照类型、差异比较和完整性规则。
- 删除 issue 01 为兼容旧 UI 加入的管理器操作映射代码，更新相关 Rust／TS 测试。
- 确认健康页、总览快捷入口、HistoryPage 与领域回链之间没有第二个维护操作列表。

### 文档与架构图

- 更新 `README.md` 的项目结构：
  - 新增 `src/components/HistoryPage.tsx`、`src/hooks/useMaintenanceHistory.ts`、`src/maintenanceHistory.ts`。
  - 新增 `src-tauri/src/maintenance_history.rs`，并说明 `manager_history.rs` 只负责快照。
  - 更新维护记录测试范围，加入跨领域、迁移、中断、后续读取与漂移。
- 检查 `PRODUCT.md`、`README.md`、`CONTEXT.md` 与 ADR-0027 的表述一致：四个领域、500 条、后续读取 / 核对分离、代理扩展维护不在范围内。
- 检查 ADR-0026 的部分取代链接可达。

### 验证

- 运行 `cargo test`、`pnpm test`、`pnpm build`。
- 使用隔离浏览器 fixture 验证：
  - 四个领域的记录都能在历史页出现并按领域／状态筛选。
  - 管理器记录可跳转快照对比；项目清理详情显示未开始目标；按年龄会话显示确认条数与执行总数；OpenCode 显示计划外后代；VS Code 显示后续读取。
  - 领域结果区回链能打开并选中对应记录。
  - 旧 v1 管理器记录迁移后可读，快照链接可用。
  - 历史页无全文搜索、时间范围、清空或导出入口。
- 不执行真实维护或真实删除。

## Acceptance criteria

- [ ] 四个领域的结果区都能显示「已保存到维护历史」并跳转到对应记录。
- [ ] 历史写入失败只在操作结果区提示，不改变操作结果。
- [ ] 操作完成、后续读取和核对写入后历史页能通过修订号看到新事实。
- [ ] `ManagerHistory.operations` 与旧维护操作列表完全移除，只保留一个维护记录入口。
- [ ] README 架构图与测试范围反映统一历史存储和新页面。
- [ ] PRODUCT、README、CONTEXT、ADR-0027、ADR-0026 之间无互相矛盾的边界表述。
- [ ] 浏览器 fixture 覆盖四个领域记录、迁移记录、回链和详情差异。
- [ ] `cargo test`、`pnpm test`、`pnpm build` 通过。

## Blocked by

- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/02-add-history-page.md
- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/03-record-project-cleanup-batches.md
- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/04-record-session-record-removals.md
- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/05-record-opencode-deletions.md
- .scratch/package-manager-opportunities/cross-domain-maintenance-history/issues/06-record-vscode-storage-removals.md

## Comments

- 2026-10-23：由设计访谈创建。issue 01 保留旧操作映射仅用于过渡，本 issue 负责移除。
