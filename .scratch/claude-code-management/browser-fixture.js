(async () => {
const { claudeExtensionFixture, claudeHookFixture } = await import('/src/test/claudeCodeFixtures.ts');
const fixture = { extensions: claudeExtensionFixture(), hooks: claudeHookFixture(), calls: [], preview: null, failRead: false };
window.claudeFixture = fixture;
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: () => 1,
  invoke: async (command, args) => {
    fixture.calls.push({ command, args });
    if (command === 'scan_claude_extensions') {
      if (fixture.failRead) throw new Error('模拟读取失败');
      return structuredClone(fixture.extensions);
    }
    if (command === 'scan_claude_hooks') return structuredClone(fixture.hooks);
    if (command === 'change_claude_extension') {
      const request = args.request;
      const plugin = fixture.extensions.plugins.find(p => p.id === request.target);
      if (plugin) {
        if (request.operation === 'Install') { plugin.installed = true; plugin.version = '1.0.0'; }
        if (request.operation === 'Uninstall') { plugin.installed = false; plugin.version = null; }
        if (request.operation === 'Enable' || request.operation === 'Disable') plugin.userEnabled = plugin.enabled = request.operation === 'Enable';
      }
      fixture.extensions.snapshotId += '-next';
      return { status: 'Succeeded', message: '模拟操作已完成，数据仅用于界面验证。', executed: true };
    }
    if (command === 'prepare_claude_hook') {
      fixture.preview = args.request;
      const current = fixture.hooks.hooks.find(h => h.id === args.request.hookId);
      return { previewId: 'preview-browser', source: fixture.hooks.configPath, before: current ? { event: current.event, matcher: current.matcher, handler: current.handler } : null, after: args.request.draft ?? null, message: '仅保存所选用户定义，保留其他配置和用户总开关。不会执行 Hook，也不会删除引用的脚本。' };
    }
    if (command === 'commit_claude_hook') {
      const req = fixture.preview;
      if (req.action === 'Create') fixture.hooks.hooks.unshift({ id: 'created-' + fixture.hooks.hooks.length, ...req.draft, source: fixture.hooks.configPath, pluginId: null, pluginEnabled: null, readOnlyReason: null });
      fixture.hooks.snapshotId += '-next';
      return { status: 'Succeeded', message: '模拟定义已保存。', executed: true };
    }
    if (command.startsWith('plugin:')) return null;
    throw new Error('Fixture does not implement ' + command);
  }
};
const label = document.createElement('div');
label.textContent = '合成测试数据 · 不连接本机 Claude';
label.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:1000;background:#142138;color:white;padding:6px 10px;border-radius:4px;font:12px system-ui;pointer-events:none';
document.body.append(label);
document.querySelectorAll('button').forEach(button => { if (button.textContent.trim() === 'Claude Code') button.click(); });
return 'Claude fixture installed';
})()
