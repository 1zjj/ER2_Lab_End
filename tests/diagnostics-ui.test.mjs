import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const render = app.slice(app.indexOf('  function renderDataSourceDiagnostics('), app.indexOf('  function renderManager('));
const handler = app.slice(app.indexOf('  async function showWeeklySource('), app.indexOf("  document.getElementById('retry-button').addEventListener"));
const source = { baseName: 'Test base', tableName: 'Weekly', tableId: 'test-table', tableUrl: '', schema: { ok: true } };
function setup() {
  const output = { textContent: '', innerHTML: '' }, button = { disabled: false };
  const nodes = { 'weekly-source-result': output, 'weekly-source-button': button };
  const requests = [];
  const ui = vm.createContext({ state: { activeRole: 'manager', dashboard: { profile: { sub: 'test-manager', roles: ['student', 'teacher', 'manager'] } } },
    document: { getElementById: id => nodes[id] || null }, config: {},
    escapeHtml: value => String(value).replaceAll('<', '&lt;'), availableLink: () => '<a>test</a>',
    request: async path => { requests.push(path); return source; } });
  vm.runInContext(render + handler, ui);
  return { ui, nodes, output, button, requests };
}

for (const role of ['student', 'teacher']) {
  const { ui, requests } = setup(); ui.state.activeRole = role;
  assert.equal(ui.renderDataSourceDiagnostics(), '', 'Manager identity must not add diagnostics to another role view');
  await ui.showWeeklySource(); assert.equal(requests.length, 0);
}
{
  const { ui, requests } = setup(); ui.state.dashboard.profile.roles = ['student'];
  assert.equal(ui.renderDataSourceDiagnostics(), '');
  await ui.showWeeklySource(); assert.equal(requests.length, 0, 'View name cannot confer a manager role');
}
{
  const { ui, button, output, requests } = setup();
  assert.match(ui.renderDataSourceDiagnostics(), /<details\b/);
  assert.doesNotMatch(ui.renderDataSourceDiagnostics(), /<details[^>]*\sopen(?:[\s=>])/);
  assert.equal(requests.length, 0, 'Rendering is not a diagnostic request');
  let finish;
  ui.request = path => { requests.push(path); return new Promise(resolve => { finish = resolve; }); };
  const pending = ui.showWeeklySource();
  assert.equal(button.disabled, true);
  await ui.showWeeklySource(); assert.equal(requests.length, 1, 'Ignore repeated clicks while reading');
  finish(source); await pending;
  assert.match(output.innerHTML, /test-table/); assert.equal(button.disabled, false);
  assert.deepEqual(requests, ['/api/admin/weekly-source']);
}
for (const change of ['role', 'account', 'remount', 'revoked', 'expired']) {
  const { ui, nodes, output, button } = setup();
  let finish; ui.request = () => new Promise(resolve => { finish = resolve; });
  const pending = ui.showWeeklySource();
  if (change === 'role') ui.state.activeRole = 'student';
  if (change === 'account') ui.state.dashboard.profile.sub = 'different-account';
  if (change === 'remount') nodes['weekly-source-result'] = { innerHTML: '' };
  if (change === 'revoked') ui.state.dashboard.profile.roles = ['student'];
  if (change === 'expired') ui.state.dashboard = null;
  finish(source); await pending;
  assert.equal(output.innerHTML, '', 'Discard stale result after ' + change);
  assert.equal(button.disabled, false);
}
{
  const { ui, output, button } = setup();
  ui.request = async () => { throw new Error('模拟读取失败'); };
  await ui.showWeeklySource();
  assert.equal(output.textContent, '模拟读取失败'); assert.equal(button.disabled, false);
  ui.request = async () => source; await ui.showWeeklySource();
  assert.match(output.innerHTML, /test-table/, 'A failed diagnostic can be retried');
}
console.log('PASS diagnostics UI: manager view only, initially collapsed, explicit read, repeat-click guard, stale result isolation and retry');
