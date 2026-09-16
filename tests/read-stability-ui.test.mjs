import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

// A hung read must finish with an actionable error; no automatic write retry.
for (const method of ['GET', 'POST']) {
  let trigger, cleared = false, count = 0;
  const context = vm.createContext({ AbortController, API_BASE: 'https://test.invalid', state: { session: 'fixture' },
    setTimeout: (fn, ms) => { trigger = fn; assert.equal(ms, method === 'GET' ? 25000 : 45000); return 1; },
    clearTimeout: () => { cleared = true; },
    authenticatedFetch: (_, options) => { count++; return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
    }); }
  });
  vm.runInContext(extract('  async function request(', '  async function loadDashboard('), context);
  const result = context.request('/api/test', { method }); trigger();
  await assert.rejects(result, e => e.code === 'REQUEST_TIMEOUT' && e.status === 504 && (method !== 'POST' || e.message.includes('草稿已保留')));
  assert.equal(count, 1); assert.equal(cleared, true);
}

let abortBody, bodyStarted;
const bodyReading = new Promise(resolve => bodyStarted = resolve);
const bodyTimeout = vm.createContext({ AbortController, API_BASE: 'https://test.invalid', state: { session: 'fixture' },
  setTimeout: fn => { abortBody = fn; return 1; }, clearTimeout() {},
  authenticatedFetch: async (_, options) => ({ status: 200, ok: true, json: () => { bodyStarted(); return new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(Error('body timeout')), { once: true });
  }); } }) });
vm.runInContext(extract('  async function request(', '  async function loadDashboard('), bodyTimeout);
const waitingForBody = bodyTimeout.request('/api/reports/history');
await bodyReading; abortBody(); await assert.rejects(waitingForBody, e => e.code === 'REQUEST_TIMEOUT');

function dashboardContext(request) {
  const effects = [];
  const context = vm.createContext({ DEMO_MODE: false, URLSearchParams, location: { search: '', href: 'https://test.invalid' }, window: {},
    escapeHtml: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    state: { session: 'fixture', activeRole: 'student', readContext: '', dashboardLoading: false }, roleMeta: { student: {} }, request,
    tabStorage: { persistent: true }, privateDrafts: { bind() {} }, memberGuide: { bind() {} },
    elements: { accountName: {}, accountRole: {}, logoutButton: {}, notice: {}, error: {}, loading: {}, app: {} },
    setBusy() {}, showError: (_, message) => effects.push(message), renderAccount() {}, renderRoleNavigation() {},
    mergeCatalog: (a,b) => b || [], renderActiveView: () => effects.push('render') });
  vm.runInContext(extract('  async function loadDashboard(', '  function renderAccount('), context);
  return { context, effects };
}
const calls = [];
const requiredFailure = dashboardContext(async path => { calls.push(path); throw Object.assign(Error('人员读取失败'), { status: 502, binding: 'MEMBERS_TABLE_ID' }); });
await requiredFailure.context.loadDashboard();
assert.deepEqual(calls, ['/api/dashboard/start'], 'Identity-only entry; never repeat a failed identity read through fallback');
assert.deepEqual(requiredFailure.effects, ['人员读取失败']);

let clock = 0; const budgets = [];
const fallback = dashboardContext(async (path, options) => {
  budgets.push(options.readTimeoutMs);
  if (path === '/api/dashboard/start') { clock = 20000; throw Object.assign(Error('identity timed out'), { status: 504, code: 'REQUEST_TIMEOUT' }); }
  return { profile: { sub: 'same-user', roles: ['student'] }, weeklyOnly: true };
});
fallback.context.Date = { now: () => clock };
await fallback.context.loadDashboard();
assert.deepEqual(budgets, [20000], 'Only bounded identity verification can block the shell, with no repeated fallback');

const pending = [];
const stale = dashboardContext(() => new Promise(resolve => pending.push(resolve)));
const a = stale.context.loadDashboard(), b = stale.context.loadDashboard();
const payload = sub => ({ profile: { sub, roles: ['student'] } });
await b;
assert.equal(pending.length, 1, 'A duplicate refresh while bootstrap is pending is suppressed');
pending[0](payload('first')); await a;
assert.equal(stale.context.state.dashboard.profile.sub, 'first');
assert.deepEqual(stale.effects, ['render']);
const accountChange = dashboardContext(async () => { accountChange.context.state.session = ''; return payload('old-account'); });
await accountChange.context.loadDashboard(); assert.equal(accountChange.context.state.dashboard, undefined);

const catalog = vm.createContext({ DEMO_MODE: false, URLSearchParams, location: { search: '' }, window: {},
  fetch: () => new Promise(() => {}), loadDashboard: () => calls.push('started-with-hung-catalog') });
vm.runInContext(extract('  const catalogRequest =', '}());'), catalog);
assert.equal(calls.at(-1), 'started-with-hung-catalog');

const literature = vm.createContext({ state: { dashboard: { moduleErrors: { literature: 'unavailable' }, literature: null } } });
vm.runInContext(extract('  function renderLiteratureSection(', '  function courseTone('), literature);
const html = literature.renderLiteratureSection();
assert.ok(html.includes('尚未确认')); assert.equal(html.includes('0 / 3'), false);
assert.equal(html.includes('data-open-literature'), false);
console.log('PASS read UI: shared deadlines, no blind retries, stale/account isolation, independent catalog load and unavailable counts');

let releaseProjects, projectCalls=0;
const isolated=dashboardContext(async path=>{
  if(path==='/api/dashboard/start') return {progressive:true,profile:{sub:'same-user',roles:['student']},week:{id:'2026-W38'},student:{report:{status:'pending'},projects:[]},teacher:{},moduleLoading:{weekly:true,projects:true,literature:true},moduleErrors:{}};
  if(path==='/api/projects'){projectCalls++;return new Promise(resolve=>releaseProjects=resolve);}
  if(path==='/api/weekly') throw Object.assign(Error('weekly unavailable'),{status:503});
  if(path==='/api/literature') return {literature:{items:[]}};
  throw Error('Unexpected route '+path);
});
isolated.context.updateModuleNotice=()=>{};
await isolated.context.loadDashboard();await new Promise(r=>setImmediate(r));
assert.equal(isolated.context.elements.app.hidden,false,'Shell stays visible while project request is pending');
assert.equal(isolated.context.state.dashboard.moduleErrors.weekly,'weekly unavailable');
assert.deepEqual(Array.from(isolated.context.state.dashboard.literature.items),[]);
await isolated.context.reloadModule('projects');assert.equal(projectCalls,1,'No duplicate module request');
vm.runInContext(extract('  function renderWeeklyCard(', '  function renderStudent('),isolated.context);
assert.doesNotMatch(isolated.context.renderWeeklyCard(),/填写本周|未提交|data-open-report/,'Failed weekly read is not a pending report');
releaseProjects({projects:[]});await new Promise(r=>setImmediate(r));
assert.equal(isolated.context.elements.app.hidden,false);
const events=[];
isolated.context.state.dashboard.moduleErrors.weekly='<img src=x onerror=alert(1)>；诊断编号：test';
const diagnosticHtml=isolated.context.modulePlaceholder('weekly','周报','panel');
assert.ok(diagnosticHtml.includes('&lt;img'));assert.ok(diagnosticHtml.includes('诊断编号：test'));assert.ok(!diagnosticHtml.includes('<img'));
const auth=vm.createContext({fetch:async()=>Response.json({code:'MODULE_FORBIDDEN'},{status:403}),window:{dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,detail){this.type=type;this.detail=detail;}}});
vm.runInContext(extract('  async function authenticatedFetch(', '  async function request('),auth);
await auth.authenticatedFetch('https://mock');assert.equal(events.length,0,'Module denial does not log out');
auth.fetch=async()=>Response.json({code:'IDENTITY_REVOKED'},{status:403});
await auth.authenticatedFetch('https://mock');assert.equal(events.length,1,'Identity revocation still clears private UI');
console.log('PASS identity-first shell, independent module failure, bounded duplicate retries and precise 403 handling');
