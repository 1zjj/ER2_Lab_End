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
    state: { session: 'fixture', activeRole: 'student' }, roleMeta: { student: {} }, request,
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
assert.deepEqual(calls, ['/api/dashboard'], 'Do not repeat a known failed MEMBERS read through fallback and /api/me');
assert.deepEqual(requiredFailure.effects, ['人员读取失败']);

let clock = 0; const budgets = [];
const fallback = dashboardContext(async (path, options) => {
  budgets.push(options.readTimeoutMs);
  if (path === '/api/dashboard') { clock = 24000; throw Object.assign(Error('project read failed'), { status: 502, binding: 'AUTH_PROJECTS_TABLE_ID' }); }
  return { profile: { sub: 'same-user', roles: ['student'] }, weeklyOnly: true };
});
fallback.context.Date = { now: () => clock };
await fallback.context.loadDashboard();
assert.deepEqual(budgets, [25000, 1000], 'The fallback must share the original page deadline');

const pending = [];
const stale = dashboardContext(() => new Promise(resolve => pending.push(resolve)));
const a = stale.context.loadDashboard(), b = stale.context.loadDashboard();
const payload = sub => ({ profile: { sub, roles: ['student'] } });
pending[1](payload('newer')); await b;
pending[0](payload('older')); await a;
assert.equal(stale.context.state.dashboard.profile.sub, 'newer');
assert.deepEqual(stale.effects, ['render'], 'An earlier refresh cannot overwrite newer data');
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
