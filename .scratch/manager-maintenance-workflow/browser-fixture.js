// Isolated browser fixture: every native call is intercepted, including writes.
import { managerFixture, presetSettings } from '/src/test/fixtures.ts';
localStorage.setItem('package-manager.enabledManagers', JSON.stringify(['Npm', 'Homebrew']));
localStorage.setItem('package-manager.migratedFvm', '1');
const size = { status: 'Ready', bytes: 4096, human: '4 KB', files: 1, directories: 1, skipped: 0, message: null };
const command = { program: 'npm', args: ['cache', 'clean', '--force'], preview: 'npm cache clean --force', timeoutMs: 300000 };
const fixture = { calls: [], cleaned: false, deferMeasure: false, failMeasurement: null, completeMeasurement: null };
window.maintenanceFixture = fixture;
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: () => 1,
  invoke: async (name, args) => {
    fixture.calls.push({ name, args });
    if (name === 'get_project_cleanup_settings') return presetSettings();
    if (name === 'scan_manager') {
      const manager = managerFixture(args.manager, {
        paths: [{ label: '缓存目录', kind: 'Cache', path: '/fixture/npm-cache', size: { ...size, status: 'Pending' } }],
        packages: [{ name: '@example/tool', version: '1.0.0', kind: 'Generic', path: '/fixture/node_modules/@example/tool', source: 'global', signals: [], actions: [] }],
      });
      if (args.manager === 'Homebrew') manager.homebrew = {
        formulaCount: 1, caskCount: 0, outdatedCount: 0, leafCount: 1, outdated: [], leaves: ['example'],
        cleanup: { status: 'Pending', command: { ...command, program: 'brew', args: ['cleanup', '--dry-run'], preview: 'brew cleanup --dry-run' }, rawOutput: '', reclaimedBytes: null, reclaimedHuman: null, message: null, failure: null },
      };
      return { manager, scanDurationMs: 12 };
    }
    if (name === 'measure_path_size') {
      if (fixture.deferMeasure) return new Promise((resolve, reject) => {
        fixture.completeMeasurement = () => { fixture.deferMeasure = false; resolve(size); };
        fixture.failMeasurement = () => { fixture.deferMeasure = false; reject(new Error('/fixture/' + 'long-directory-name/'.repeat(12) + '：模拟目录读取失败')); };
      });
      return { ...size, bytes: fixture.cleaned ? 0 : 4096, human: fixture.cleaned ? '0 B' : '4 KB' };
    }
    if (name === 'hydrate_homebrew_cleanup') return {
      status: 'Ready', command: { ...command, program: 'brew', preview: 'brew cleanup --dry-run' },
      rawOutput: Array.from({ length: 12 }, (_, i) => 'Would remove: /fixture/Cellar/' + 'long-package-name-'.repeat(6) + i).join('\n'),
      reclaimedBytes: 4096, reclaimedHuman: '4 KB', message: null, failure: null,
    };
    if (name === 'run_cache_cleanup') {
      fixture.cleaned = true;
      fixture.deferMeasure = true;
      return { manager: args.manager, outcome: 'Succeeded', steps: [{ label: '清理缓存', command, state: 'Succeeded', stdout: '', stderr: '', failure: null }], message: null };
    }
    if (name === 'plugin:path|resolve_directory') return '/fixture';
    if (name.startsWith('plugin:')) return null;
    throw new Error('Fixture does not implement ' + name);
  },
};
