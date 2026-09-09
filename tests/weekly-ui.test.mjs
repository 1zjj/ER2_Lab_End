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
    DEMO_MODE: false, state: { session: 'test', dashboard: { profile: { sub: 'test' }, week: { id: '2026-W37' }, student: { history: [] } } },
    elements: { reportForm: form, reportSubmit: { disabled }, reportError: {}, reportReload: {}, reportDialog: {} },
    FormData: class { entries() { return Object.entries({ progress: '输入正文', nextPlan: '下周计划', evidence }); } },
    request: async path => { if (path === '/api/weekly' && refresh instanceof Error) throw refresh; return path === '/api/weekly' ? refresh : response; }, pendingRequestId: () => 'request-1',
    draftKeys: { report: 'draft' }, draftScope: () => 'week',
    privateDrafts: { get: () => '', set() {}, remove() {} }, clearDraft: () => effects.push('clear'),
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
const fresh = { profile: { sub: 'test' }, week: { id: '2026-W37' }, student: { report: { values }, history: [] }, teacher: { students: [{ id: 'test', status: '已提交' }], stats: { submitted: 1 } } };
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
const auth = vm.createContext({ learningUIInstance: { reset() {} }, sessionStorage: storage, tabStorage: storage, memberGuide: { bind() {} },
  state: { session: 'old', dashboard: {} }, API_BASE: 'https://api.example',
  location: { hash: '#session=test-session', pathname: '/', search: '', href: 'https://workbench.example/' }, history: { replaceState() {} },
  document: { getElementById: () => ({}), querySelectorAll: () => [] }, elements: { app: {}, roleNav: {}, mobileRoleNav: {}, searchResults: {} }, showError() {},
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

// Reproduce a report submitted on another device while this browser retains
// an empty draft. Opening edit must display the saved record, not empty fields.
const reportNames = ['progress', 'learning', 'evidence', 'blockers', 'nextPlan'];
const savedReport = { progress: '服务器正文', learning: '已保存的学习内容', evidence: 'https://example.com/output', blockers: '', nextPlan: '服务器计划' };
function reopenReport(rawDraft, saved = savedReport) {
  const fields = Object.fromEntries(reportNames.map(name => [name, { value: '上次表单残留' }]));
  const form = { reset: () => Object.values(fields).forEach(field => { field.value = ''; }),
    elements: { namedItem: name => fields[name] } };
  const context = vm.createContext({ privateDrafts: { get: () => rawDraft }, draftScope: () => '2026-W37', draftKeys: { report: 'report' },
    elements: { reportForm: form, reportWeekLabel: {}, reportError: {}, reportReload: {}, reportDialog: {} },
    state: { dashboard: { profile: { sub: 'test' }, week: { label: '当前周' }, student: { report: { values: saved } } } }, showDialog() {} });
  vm.runInContext(extract('  function restoreDraft(', '  function clearDraft('), context);
  vm.runInContext(extract('  function openReportDialog(', '  function openReportHistory('), context);
  context.openReportDialog();
  return Object.fromEntries(reportNames.map(name => [name, fields[name].value]));
}
for (const raw of [null, '{}', 'null', '[]', 'broken JSON', JSON.stringify(Object.fromEntries(reportNames.map(name => [name, '']))),
  JSON.stringify({ progress: ' \n ', requestId: 'irrelevant-old-metadata' })]) {
  assert.deepEqual(reopenReport(raw), savedReport, 'Empty or unusable drafts must not hide the saved report');
}
const meaningfulDraft = { progress: '尚未提交的修改', learning: '', evidence: '', blockers: '', nextPlan: ' ' };
assert.deepEqual(reopenReport(JSON.stringify(meaningfulDraft)), meaningfulDraft, 'A real draft must retain intentionally cleared fields');
assert.deepEqual(reopenReport(JSON.stringify({ evidence: 'https://example.com/unsaved' })), {
  progress: '', learning: '', evidence: 'https://example.com/unsaved', blockers: '', nextPlan: ''
}, 'A partial draft cannot inherit fields from an earlier open dialog');
assert.deepEqual(reopenReport(null, {}), Object.fromEntries(reportNames.map(name => [name, ''])), 'A fresh week has no stale dialog values');
console.log('PASS weekly UI: empty drafts show saved reports; meaningful drafts and intentionally empty fields are preserved');

// Responses from an earlier query/account must never replace the active history.
const pendingHistory = [];
const historyElements = { reportHistoryYear: { value: '' }, reportHistoryWeek: { value: '' },
  reportHistoryPrev: {}, reportHistoryNext: {}, reportHistoryStatus: {}, reportHistoryBody: {}, reportHistoryDialog: { open: true } };
const historyContext = vm.createContext({ DEMO_MODE: false, URLSearchParams, elements: historyElements,
  state: { session: 'session-a', dashboard: { profile: { sub: 'person-a' } }, reportHistory: { page: 1, pages: 1, generation: 0 } },
  request: path => new Promise((resolve, reject) => pendingHistory.push({ path, resolve, reject })),
  historyMarkup: records => records.map(r => r.recordId).join(',') });
vm.runInContext(extract('  async function loadReportHistory(', '  function openLiteratureDialog('), historyContext);
const page = (id, number = 1) => ({ reports: [{ recordId: id }], total: 42, page: number, pages: 3, years: ['2026', '2025'] });
const first = historyContext.loadReportHistory(1), second = historyContext.loadReportHistory(2);
pendingHistory[1].resolve(page('second', 2)); await second;
pendingHistory[0].resolve(page('obsolete')); await first;
assert.equal(historyElements.reportHistoryBody.innerHTML, 'second');
assert.equal(historyElements.reportHistoryPrev.disabled, false);
assert.ok(pendingHistory[1].path.includes('page=2'));
const failed = historyContext.loadReportHistory(3); pendingHistory[2].reject(new Error('offline')); await failed;
assert.equal(historyElements.reportHistoryBody.innerHTML, 'second');
assert.ok(historyElements.reportHistoryStatus.textContent.includes('上次读取结果'));
const switched = historyContext.loadReportHistory(3); historyContext.state.session = 'session-b';
historyContext.state.dashboard.profile.sub = 'person-b'; pendingHistory[3].resolve(page('private-a', 3)); await switched;
assert.equal(historyElements.reportHistoryBody.innerHTML, 'second', 'Late former-account result must not render');
console.log('PASS history UI: paging requests, stale response suppression, explicit read failure and account change guard');

// Conflict recovery asks before replacing a real local draft and does not post.
let acceptReload = false, clearCount = 0, reopened = 0;
const reloadContext = vm.createContext({ state: { session: 's', dashboard: { profile: { sub: 'test' }, week: { id: '2026-W37' }, student: {} } },
  elements: { reportReload: {}, reportError: {}, reportDialog: { open: true } },
  request: async path => { assert.equal(path, '/api/weekly'); return { week: { id: '2026-W37' }, student: { report: { revision: 'fresh' } } }; },
  window: { confirm: () => acceptReload }, clearDraft: () => clearCount++, draftKeys: { report: 'report' },
  draftScope: () => '2026-W37', privateDrafts: { remove() {} }, openReportDialog: () => reopened++ });
vm.runInContext(extract('  async function reloadSavedReport(', '  async function submitLiterature('), reloadContext);
await reloadContext.reloadSavedReport(); assert.equal(clearCount, 0); assert.equal(reopened, 0);
acceptReload = true; await reloadContext.reloadSavedReport(); assert.equal(clearCount, 1); assert.equal(reopened, 1);
assert.equal(reloadContext.state.dashboard.student.report.revision, 'fresh');
console.log('PASS conflict UI: replacing a draft requires an explicit choice; fresh version is loaded without a write');
