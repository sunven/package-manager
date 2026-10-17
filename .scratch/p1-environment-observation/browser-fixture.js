// Verification fixture. All native actions are intercepted, including writes.
import { managerFixture, presetSettings } from '/src/test/fixtures.ts';
import { snapshotDraft } from '/src/managerHistory.ts';
const managers = ['Npm', 'Pnpm', 'Nvm', 'Homebrew', 'Pip'];
localStorage.setItem('package-manager.enabledManagers', JSON.stringify(managers));
localStorage.setItem('package-manager.migratedFvm', '1');
const measured = { status: 'Ready', bytes: 1288490188, human: '1.2 GB', files: 4890, directories: 427, skipped: 0, message: null };
const pkg = (name, version, kind = 'Generic', path = `/fixture/global/node_modules/${name}`) => ({ observationId: JSON.stringify([kind, name, kind === 'Generic' && name === 'node' ? version : null]), name, version, kind, path, source: 'isolated browser fixture', actions: [], signals: [], observedVersions: null });
const current = (manager) => managerFixture(manager, {
  scopeKey: `${manager}:/fixture`,
  packages: manager === 'Nvm' ? [pkg('node', '20.19.0', 'Generic', '/fixture/.nvm/versions/node/v20.19.0'), pkg('node', '22.16.0', 'Generic', '/fixture/.nvm/versions/node/v22.16.0')] : manager === 'Homebrew' ? [pkg('node', '22.16.0', 'Formula', '/opt/homebrew/Cellar/node/22.16.0'), pkg('ripgrep', '14.1.0', 'Formula')] : [pkg('typescript', '5.9.3'), pkg('tsx', '4.20.5'), pkg('@biomejs/biome', '2.2.0'), pkg('eslint', '9.36.0')],
  paths: [{ kind: 'Cache', label: '缓存目录', path: `/fixture/${manager.toLowerCase()}/cache`, size: measured }, { kind: 'GlobalModules', label: '全局安装目录', path: `/fixture/${manager.toLowerCase()}/global/node_modules`, size: measured }],
});
const instant = Date.now();
let nextId = 10;
const archives = Object.fromEntries(managers.map((id) => {
  const latest = { ...snapshotDraft(current(id), null), id: `${id}-after`, capturedAt: instant - 3600000 };
  const before = { ...structuredClone(latest), id: `${id}-before`, capturedAt: instant - 86400000 };
  before.packages[0].version = id === 'Nvm' ? '20.19.0' : '5.7.2';
  before.packages.push({ ...before.packages[0], observationId: 'old-tool', name: 'legacy-build-tool', version: '1.0.0' });
  before.paths[0].bytes = 8589934592;
  return [id, [latest, before]];
}));
const fixture = window.p1Fixture = { calls: [], archives, failHistory: false, failEnvironment: false, partial: false, operations: [{ id: 'operation-1', managerId: 'Npm', operation: 'cleanupCache', target: null, startedAt: instant - 3700000, finishedAt: instant - 3690000, execution: 'succeeded', message: 'npm 缓存清理已完成；npx 目录护栏检查与清理已完成。', verification: 'failed', verificationMessage: '一个目录未能完整读取；维护执行结果已保留，可重新扫描核对。', beforeSnapshotId: 'Npm-before', afterSnapshotId: 'Npm-after' }] };
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1,
  invoke: async (name, args) => {
    fixture.calls.push({ name, args });
    if (name === 'get_project_cleanup_settings') return presetSettings();
    if (name === 'scan_manager') return { manager: current(args.manager), scanDurationMs: 32 };
    if (name === 'measure_path_size') return measured;
    if (name === 'save_manager_snapshot') {
      if (fixture.failArchives?.includes(args.draft.managerId)) throw new Error('隔离验证：此管理器的历史文件暂时无法保存。');
      const saved = { ...args.draft, id: `snapshot-${nextId++}`, capturedAt: Date.now() };
      archives[args.draft.managerId].unshift(saved);
      return saved;
    }
    if (name === 'list_manager_history') {
      if (fixture.failHistory) throw new Error('隔离验证：历史文件暂时无法读取，请重试。');
      const snapshots = structuredClone(archives[args.manager]);
      if (fixture.partial) { snapshots[0].complete = false; snapshots[0].message = '隔离验证：读取不完整，不能判定条目增减。'; }
      return { snapshots, operations: fixture.operations, warnings: [] };
    }
    if (name === 'inspect_environment') {
      if (fixture.failEnvironment) throw new Error('隔离验证：应用 PATH 暂时无法读取。');
      const paths = ['/fixture/.nvm/versions/node/v22.16.0/bin', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
      return { capturedAt: Date.now(), pathEntries: paths.map((path) => ({ original: path, path, issue: null })), commands: [
        { program: 'node', managers: ['Npm', 'Pnpm', 'Nvm'], selectedPath: `${paths[0]}/node`, status: 'multiple', candidates: [{ pathIndex: 0, path: `${paths[0]}/node`, target: `${paths[0]}/node`, status: 'executable', message: null }, { pathIndex: 1, path: '/opt/homebrew/bin/node', target: '/opt/homebrew/Cellar/node/22.16.0/bin/node', status: 'executable', message: null }] },
        { program: 'npm', managers: ['Npm'], selectedPath: `${paths[0]}/npm`, status: 'single', candidates: [{ pathIndex: 0, path: `${paths[0]}/npm`, target: '/fixture/.nvm/versions/node/v22.16.0/lib/node_modules/npm/bin/npm-cli.js', status: 'executable', message: null }] },
        { program: 'pnpm', managers: ['Pnpm'], selectedPath: '/opt/homebrew/bin/pnpm', status: 'aliases', candidates: [{ pathIndex: 1, path: '/opt/homebrew/bin/pnpm', target: '/fixture/corepack/pnpm', status: 'executable', message: null }, { pathIndex: 2, path: '/usr/local/bin/pnpm', target: '/fixture/corepack/pnpm', status: 'executable', message: null }] },
        { program: 'python3', managers: ['Pip'], selectedPath: '/usr/bin/python3', status: 'single', candidates: [{ pathIndex: 3, path: '/usr/bin/python3', target: '/usr/bin/python3', status: 'executable', message: null }] },
        { program: 'brew', managers: ['Homebrew'], selectedPath: null, status: 'unknown', candidates: [{ pathIndex: 1, path: '/opt/homebrew/bin/brew', target: null, status: 'unreadable', message: '隔离验证：文件无法读取' }] },
      ] };
    }
    if (name === 'plugin:path|resolve_directory') return '/fixture';
    if (name.startsWith('plugin:')) return null;
    throw new Error('Fixture does not implement ' + name);
  },
};
