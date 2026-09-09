import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const code = extract('  function updateModuleNotice(', '  function renderLearningCard(') +
  extract('  function projectHomepageUrl(', '  function renderStudent(');
const project = { code: 'PRJ-001', title: '合成项目', permission: 1, url: 'https://lcnywl4yrecr.feishu.cn/wiki/fixture' };

async function run(test) {
  const dom = new JSDOM('<main id="app"><section id="weekly"><input value="未提交的草稿"></section><section id="finance">审核</section><div id="projects"></div></main>',
    { url: 'https://fixture.test', runScripts: 'outside-only' });
  const w = dom.window, app = w.document.querySelector('#app'), calls = [];
  w.elements = { app };
  w.state = { session: 'fixture', activeRole: 'student', loadGeneration: 1, dashboard: {
    profile: { sub: 'fixture-member' }, student: { projects: [] }, manager: { stats: { projects: null } },
    moduleErrors: { projects: 'unavailable', literature: 'unavailable' },
    moduleDiagnostics: { projects: { requestId: '<img src=x onerror=alert(1)>' } }
  } };
  w.escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let respond = async () => ({ projects: [project], activeCount: 1 });
  w.request = async (path, options) => { calls.push({ path, options }); return respond(); };
  w.eval(code);
  app.querySelector('#projects').outerHTML = w.renderProjectCard();
  w.updateModuleNotice(); w.bindProjectRetry();
  const button = app.querySelector('[data-reload-projects]');
  try { await test({ w, app, calls, button, respond: fn => { respond = fn; } }); }
  finally { dom.window.close(); }
}

await run(async ({ w, app, calls, button, respond }) => {
  assert.equal(calls.length, 0, 'No automatic retry during rendering');
  assert.equal(app.querySelector('img'), null, 'Diagnostic identifiers are escaped');
  const weekly = app.querySelector('#weekly'), finance = app.querySelector('#finance');
  let finish; respond(() => new Promise(resolve => { finish = resolve; }));
  button.click(); assert.equal(calls.length, 1, 'Real button is wired');
  assert.equal(button.disabled, true); assert.equal(button.closest('section').getAttribute('aria-busy'), 'true');
  button.click(); await w.reloadProjects(button); assert.equal(calls.length, 1, 'Ignore duplicate clicks');
  finish({ projects: [project], activeCount: 1 });
  await new Promise(resolve => w.setTimeout(resolve, 0));
  assert.equal(app.querySelector('#weekly'), weekly); assert.equal(app.querySelector('#finance'), finance);
  assert.equal(weekly.querySelector('input').value, '未提交的草稿');
  assert.deepEqual(calls.map(c => c.path), ['/api/projects']); assert.equal(calls[0].options, undefined, 'Read only');
  assert.equal(w.state.dashboard.manager.stats.projects, 1);
  assert.equal(w.state.dashboard.moduleErrors.projects, undefined);
  assert.equal(w.state.dashboard.moduleDiagnostics.projects, undefined);
  assert.match(app.querySelector('[data-module-notice]').textContent, /文献阅读/);
  assert.doesNotMatch(app.querySelector('[data-module-notice]').textContent, /项目/);
  const link = app.querySelector('.project-home-card a');
  assert.equal(link.href, project.url); assert.equal(link.target, '_blank');
  assert.equal(app.querySelector('[data-reload-projects]'), null);
});

for (const result of [{}, { projects: null }, { projects: [null] }, { projects: [{ ...project, permission: 0 }] }]) {
  await run(async ({ w, app, button, respond }) => {
    respond(async () => result); await w.reloadProjects(button);
    assert.ok(w.state.dashboard.moduleErrors.projects);
    assert.match(app.querySelector('[data-project-read-status]').textContent, /尚未确认/);
    assert.equal(button.disabled, false); assert.doesNotMatch(app.textContent, /暂无已授权项目/);
  });
}
await run(async ({ w, app, button, respond }) => {
  respond(async () => { throw Error('模拟失败；诊断编号：retry-123'); });
  await w.reloadProjects(button);
  assert.match(app.querySelector('[data-project-read-status]').textContent, /retry-123/);
  assert.equal(button.disabled, false);
  delete w.state.dashboard.moduleErrors.literature;
  respond(async () => ({ projects: [], activeCount: 0 })); await w.reloadProjects(button);
  assert.match(app.textContent, /暂无已授权项目/); assert.equal(w.state.dashboard.manager.stats.projects, 0);
  assert.equal(app.querySelector('[data-module-notice]'), null);
});

for (const change of ['session', 'account', 'role', 'dashboard', 'reload', 'removed', 'denied']) {
  await run(async ({ w, app, button, respond }) => {
    const before = w.state.dashboard;
    let finish; respond(() => new Promise(resolve => { finish = resolve; }));
    const pending = w.reloadProjects(button);
    if (change === 'session') w.state.session = 'different-session';
    if (change === 'account') before.profile.sub = 'different-member';
    if (change === 'role') w.state.activeRole = 'manager';
    if (change === 'dashboard') w.state.dashboard = { ...before };
    if (change === 'reload') w.state.loadGeneration++;
    if (change === 'removed') button.closest('section').remove();
    if (change === 'denied') w.state.dashboard = null;
    finish({ projects: [project], activeCount: 1 }); await pending;
    assert.equal(before.student.projects.length, 0, 'Discard stale result after ' + change);
    assert.ok(before.moduleErrors.projects); assert.equal(app.querySelector('.project-home-card a'), null);
  });
}
console.log('PASS project retry UI: explicit GET, duplicate guard, preserved forms, confirmed results, failure recovery, safe diagnostics and stale session/view isolation');
