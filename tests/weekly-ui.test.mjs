import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const extract = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const display = vm.createContext({ escapeHtml, URL });
vm.runInContext(extract('  function evidenceMarkup(', '  function renderActiveView('), display);
const evidence = '<img src=x onerror=alert(1)>\n代码 https://example.com/code\n文档 https://lab.feishu.cn/docx/test';
const html = display.evidenceMarkup(evidence);
assert.equal(html.includes('<img'), false);
assert.ok(html.includes('&lt;img'));
assert.equal((html.match(/<a /g) || []).length, 2);
assert.equal(display.evidenceMarkup('javascript:alert(1)').includes('<a '), false);
assert.equal(display.evidenceMarkup('https://user:password@example.com').includes('<a '), false);

async function submit(response, refresh = response, disabled = false) {
  const effects = [];
  const form = { reportValidity: () => true, reset: () => effects.push('reset') };
  const context = vm.createContext({
    DEMO_MODE: false, state: { session: 'test', dashboard: { week: { id: '2026-W37' }, student: { history: [] } } },
    elements: { reportForm: form, reportSubmit: { disabled }, reportError: {}, reportDialog: {} },
    FormData: class { entries() { return Object.entries({ progress: '输入正文', nextPlan: '下周计划', evidence }); } },
    request: async path => { if (path === '/api/weekly' && refresh instanceof Error) throw refresh; return path === '/api/weekly' ? refresh : response; }, pendingRequestId: () => 'request-1',
    draftKeys: { report: 'draft' }, draftScope: () => 'week',
    privateDrafts: { remove: () => effects.push('remove') }, clearDraft: () => effects.push('clear'),
    closeDialog: () => effects.push('close'), renderActiveView: () => effects.push('render'), showToast: () => effects.push('toast')
  });
  vm.runInContext(extract('  async function submitReport(', '  async function submitLiterature('), context);
  await context.submitReport({ preventDefault() {} });
  return { context, effects };
}
const unconfirmed = await submit({ ok: true });
assert.deepEqual(unconfirmed.effects, []);
assert.equal(unconfirmed.context.elements.reportError.hidden, false);
assert.ok(unconfirmed.context.elements.reportError.textContent.includes('草稿已保留'));
const values = { progress: '已从服务器读回的正文', learning: '', evidence, blockers: '', nextPlan: '下周计划' };
const confirmed = await submit({ ok: true, readBackVerified: true,
  report: { recordId: 'rec-confirmed', weekId: '2026-W37', submittedAt: '2026-09-07', values } });
assert.equal(confirmed.context.state.dashboard.student.history[0].recordId, 'rec-confirmed');
assert.equal(confirmed.context.state.dashboard.student.report.values.progress, values.progress);
assert.ok(confirmed.effects.includes('clear'));
const fresh = { week: { id: '2026-W37' }, student: { report: { values }, history: [] }, teacher: { students: [{ id: 'test', status: '已提交' }], stats: { submitted: 1 } } };
const updated = await submit({ ok: true, readBackVerified: true, report: { values } }, fresh);
assert.equal(updated.context.state.dashboard.teacher.students[0].status, '已提交');
const refreshFailure = await submit({ ok: true, readBackVerified: true, report: { values } }, new Error('offline'));
assert.ok(refreshFailure.effects.includes('clear'));
assert.equal(refreshFailure.context.elements.reportError.hidden, true);
assert.deepEqual((await submit({}, {}, true)).effects, []);

// Exercise the actual expiry callback plus the real owner-scoped store. A new
// login cannot recover the draft until bind() confirms the same account.
const entries = new Map();
const storage = { get length() { return entries.size; }, key: i => [...entries.keys()][i], getItem: k => entries.get(k) ?? null,
  setItem: (k, v) => entries.set(k, v), removeItem: k => entries.delete(k) };
let handler;
const auth = vm.createContext({ sessionStorage: storage,
  state: { session: 'old', dashboard: {} }, API_BASE: 'https://api.example',
  location: { hash: '#session=test-session', pathname: '/', search: '', href: 'https://workbench.example/' }, history: { replaceState() {} },
  document: { getElementById: () => ({}), querySelectorAll: () => [] }, elements: { app: {} }, showError() {},
  window: { addEventListener: (name, fn) => { handler = fn; }, dispatchEvent: e => handler(e) },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  fetch: async () => ({ status: 401 })
});
vm.runInContext(readFileSync(new URL('../draft-store.js', import.meta.url), 'utf8'), auth);
auth.privateDrafts = auth.window.ER2DraftStore.create(storage);
auth.privateDrafts.bind('person-a'); auth.privateDrafts.set('report', '2026-W37', 'unsaved text');
vm.runInContext(extract("  window.addEventListener('er2-session-denied'", '  async function loadDashboard('), auth);
await auth.authenticatedFetch('https://api.example');
assert.equal(auth.state.dashboard, null);
vm.runInContext(extract('  function readSession(', '  function escapeHtml('), auth);
assert.equal(auth.readSession(), 'test-session');
const reloadedStore = auth.window.ER2DraftStore.create(storage);
assert.equal(reloadedStore.get('report', '2026-W37'), null);
reloadedStore.bind('person-a'); assert.equal(reloadedStore.get('report', '2026-W37'), 'unsaved text');
reloadedStore.bind('person-b'); assert.equal(reloadedStore.get('report', '2026-W37'), null);
auth.privateDrafts = reloadedStore;
reloadedStore.set('report', '2026-W37', 'different account draft');
handler({ detail: { status: 403 } });
assert.equal(reloadedStore.get('report', '2026-W37'), null);
console.log('PASS weekly UI: text/link escaping, preserve unconfirmed drafts, display confirmed server record');
console.log('PASS weekly UI: expiry recovery, account isolation, denied-access cleanup, submit guard and teacher refresh');
