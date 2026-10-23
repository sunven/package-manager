// Isolated browser fixture for the cross-domain maintenance history page.
// Every native call is intercepted; no real scan or maintenance runs.
import { managerFixture, presetSettings } from '/src/test/fixtures.ts';
import { snapshotDraft } from '/src/managerHistory.ts';

localStorage.setItem('package-manager.enabledManagers', JSON.stringify(['Npm']));
localStorage.setItem('package-manager.migratedFvm', '1');

const now = Date.now();
const pkg = (version) => ({ name: 'tool', version, kind: 'Generic', path: null, signals: [], actions: [] });
const snapshot = (id, capturedAt, extra = {}) => ({
  ...snapshotDraft(managerFixture('Npm', { scopeKey: 'root', packages: [], ...extra }), null),
  id,
  capturedAt,
});
const snapshots = [
  snapshot('snapshot-new', now - 60_000, { packages: [pkg('2.0.0')] }),
  snapshot('snapshot-old', now - 3_600_000, { packages: [pkg('1.0.0')] }),
];

const managerSummary = {
  id: 'op-manager',
  domain: 'manager',
  operation: 'cleanupCache',
  startedAt: now - 120_000,
  finishedAt: now - 110_000,
  execution: 'succeeded',
  interrupted: false,
  subject: { managerId: 'Npm', targetCount: 2 },
  counts: { total: 2, succeeded: 2, failed: 0, skipped: 0, notAttempted: 0 },
  followUpReadStatus: null,
  verificationStatus: 'failed',
};
const managerRecord = {
  id: 'op-manager',
  domain: 'manager',
  operation: 'cleanupCache',
  startedAt: now - 120_000,
  finishedAt: now - 110_000,
  execution: 'succeeded',
  interrupted: false,
  message: '缓存清理已完成\n缓存目录：已完成\n_npx 目录：已完成',
  followUpRead: null,
  verification: {
    status: 'failed',
    recordedAt: now - 100_000,
    message: '重新读取时目录无法测量',
    beforeSnapshotId: 'snapshot-old',
    afterSnapshotId: 'snapshot-new',
  },
  detail: {
    kind: 'manager',
    managerId: 'Npm',
    target: null,
    steps: [
      { label: '缓存目录', state: 'succeeded', failureMessage: null },
      { label: '_npx 目录', state: 'succeeded', failureMessage: null },
    ],
  },
};

const projectSummary = {
  id: 'op-project',
  domain: 'projectCleanup',
  operation: 'cleanBatch',
  startedAt: now - 240_000,
  finishedAt: now - 230_000,
  execution: 'partial',
  interrupted: false,
  subject: { rootPath: '/code', targetCount: 2 },
  counts: { total: 2, succeeded: 1, failed: 1, skipped: 0, notAttempted: 0 },
  followUpReadStatus: null,
  verificationStatus: null,
};
const projectRecord = {
  id: 'op-project',
  domain: 'projectCleanup',
  operation: 'cleanBatch',
  startedAt: now - 240_000,
  finishedAt: now - 230_000,
  execution: 'partial',
  interrupted: false,
  message: '项目清理批次已结束',
  followUpRead: null,
  verification: null,
  detail: {
    kind: 'projectCleanup',
    scope: {
      scanId: 'scan-1',
      scanRootId: 'root-1',
      scanRootPath: '/code',
      batchId: 'batch-1',
      candidates: [
        { candidateId: 'candidate-1', kind: 'RustTarget', projectPath: '/code/app', directoryPath: '/code/app/target', order: 0, confirmedBytes: 120000000, confirmedComplete: true },
        { candidateId: 'candidate-2', kind: 'NodeModules', projectPath: '/code/web', directoryPath: '/code/web/node_modules', order: 1, confirmedBytes: 45000000, confirmedComplete: true },
      ],
    },
    finish: 'completed',
    results: [
      { candidateId: 'candidate-1', status: 'Succeeded', command: 'cargo clean', beforeBytes: 120000000, afterBytes: 0, cleanedBytes: 120000000, measurementStatus: 'Missing', message: null, failureMessage: null, effectFailureMessage: null },
      { candidateId: 'candidate-2', status: 'Failed', command: null, beforeBytes: 45000000, afterBytes: 45000000, cleanedBytes: 0, measurementStatus: 'Ready', message: null, failureMessage: '目录被其他进程占用', effectFailureMessage: null },
    ],
  },
};

const sessionSummary = {
  id: 'op-session',
  domain: 'sessionRecord',
  operation: 'removeToTrash',
  startedAt: now - 300_000,
  finishedAt: now - 290_000,
  execution: 'partial',
  interrupted: false,
  subject: { source: 'codex', mode: 'olderThan', targetCount: 3 },
  counts: { total: 3, succeeded: 2, failed: 1, skipped: 0, notAttempted: 0 },
  followUpReadStatus: 'ready',
  verificationStatus: null,
};
const sessionRecord = {
  id: 'op-session',
  domain: 'sessionRecord',
  operation: 'removeToTrash',
  startedAt: now - 300_000,
  finishedAt: now - 290_000,
  execution: 'partial',
  interrupted: false,
  message: '已移入 2 项，跳过 0 项，失败 1 项。',
  followUpRead: { status: 'ready', recordedAt: now - 289_000, message: null },
  verification: null,
  detail: {
    kind: 'sessionTrash',
    scope: { source: 'codex', mode: 'olderThan', days: 30, confirmedCount: 2, confirmedRecords: null },
    executionTotal: 3,
    results: [
      { id: 'session-a', status: 'Moved', reason: null, message: null },
      { id: 'session-b', status: 'Moved', reason: null, message: null },
      { id: 'session-c', status: 'Failed', reason: 'TrashFailed', message: 'Finder 失败' },
    ],
  },
};

const vscodeSummary = {
  id: 'op-vscode',
  domain: 'vscodeStorage',
  operation: 'removeWorkspaceStorage',
  startedAt: now - 360_000,
  finishedAt: now - 350_000,
  execution: 'succeeded',
  interrupted: false,
  subject: { source: 'vscode', targetCount: 1 },
  counts: { total: 1, succeeded: 1, failed: 0, skipped: 0, notAttempted: 0 },
  followUpReadStatus: 'ready',
  verificationStatus: null,
};
const vscodeRecord = {
  id: 'op-vscode',
  domain: 'vscodeStorage',
  operation: 'removeWorkspaceStorage',
  startedAt: now - 360_000,
  finishedAt: now - 350_000,
  execution: 'succeeded',
  interrupted: false,
  message: '已移入 1 项，跳过 0 项，失败 0 项。',
  followUpRead: { status: 'ready', recordedAt: now - 349_000, message: null },
  verification: null,
  detail: {
    kind: 'vscodeStorage',
    scope: { workspaces: [{ id: 'ws-1', name: 'old-project', projectPath: '/old/project', storagePath: '/Code/workspaceStorage/ws-1', kind: 'Folder', projectStatus: 'Missing', removable: true, removalBlockReason: null, bytes: 2048, usageComplete: true }] },
    results: [{ id: 'ws-1', status: 'Moved', reason: null, message: null }],
  },
};

const summaries = [managerSummary, projectSummary, sessionSummary, vscodeSummary];
const records = {
  'op-manager': managerRecord,
  'op-project': projectRecord,
  'op-session': sessionRecord,
  'op-vscode': vscodeRecord,
};

window.__historyCalls = [];
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: () => 1,
  invoke: async (name, args) => {
    window.__historyCalls.push(name);
    if (name === 'get_project_cleanup_settings') return presetSettings();
    if (name === 'scan_manager') return { manager: managerFixture('Npm'), scanDurationMs: 5, diagnostics: { pathEntries: [], executables: [] } };
    if (name === 'save_manager_snapshot') return { ...args.draft, id: `snapshot-${Date.now()}`, capturedAt: Date.now() };
    if (name === 'list_manager_history') return { snapshots, warnings: [] };
    if (name === 'list_maintenance_history') return { records: summaries, warnings: [] };
    if (name === 'get_maintenance_record') return records[args.id];
    if (name === 'inspect_environment') return { capturedAt: now, pathEntries: [], commands: [] };
    if (name === 'scan_session_records') return { codex: { directory: '', status: 'Missing', records: [], message: null }, claude: { directory: '', status: 'Missing', records: [], message: null } };
    if (name === 'scan_opencode_sessions') return { status: 'unavailable', records: [], message: 'fixture', activeSessionIds: null, activityMessage: null };
    if (name === 'scan_vscode_storage') return { storagePath: '', status: 'Missing', workspaces: [], message: null };
    if (name === 'get_vscode_editor_status') return 'Stopped';
    if (name === 'measure_path_size') return { status: 'Ready', bytes: 0, human: '0 B', files: 0, directories: 0, skipped: 0, message: null };
    if (name === 'plugin:path|resolve_directory') return null;
    if (name.startsWith('plugin:')) return null;
    return null;
  },
};
