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

async function submit(response) {
  const effects = [];
  const form = { reportValidity: () => true, reset: () => effects.push('reset') };
  const context = vm.createContext({
    DEMO_MODE: false, state: { session: 'test', dashboard: { week: { id: '2026-W37' }, student: { history: [] } } },
    elements: { reportForm: form, reportSubmit: {}, reportError: {}, reportDialog: {} },
    FormData: class { entries() { return Object.entries({ progress: '输入正文', nextPlan: '下周计划', evidence }); } },
    request: async () => response, pendingRequestId: () => 'request-1',
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
console.log('PASS weekly UI: text/link escaping, preserve unconfirmed drafts, display confirmed server record');
