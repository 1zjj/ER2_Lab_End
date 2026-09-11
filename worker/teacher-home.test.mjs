import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import service from './src/runtime.js';

// Exercise the real authenticated API with same-name people, paginated records,
// and a Shanghai week rollover. No real Feishu requests or writes are permitted.
const realFetch = globalThis.fetch, RealDate = Date;
let now = RealDate.parse('2026-09-10T10:00:00Z');
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const env = { SESSION_SECRET: 'synthetic-reading-count-secret', FEISHU_APP_ID: 'fixture', FEISHU_APP_SECRET: 'fixture', FRONTEND_URL: 'https://fixture.test' };
for (const name of ['MEMBERS', 'AUTH_PROJECTS', 'PROJECT_MEMBERS', 'LITERATURE']) {
  env[name + '_TABLE_ID'] = name.toLowerCase(); env[name + '_BASE_APP_TOKEN'] = 'fixture-' + name.toLowerCase();
}
const people = ['a', 'b', 'c'].map((id, index) => ({ record_id: 'person-' + id, fields: {
  '人员编号': 'P-00' + (index + 1), '姓名': '同名合成成员', '飞书成员': [{ id: 'ou_' + id }],
  '人员状态': '在组', '人员边界': '团队内', '成员类别': id === 'a' ? 'RA' : '博士', '保密等级': '内部',
  '系统职责': id === 'a' ? ['管理员', '课程审核'] : []
} }));
const rows = [];
function addRows(owner, week, count, at = now) {
  for (let i = 0; i < count; i++) rows.push({ record_id: 'reading-' + rows.length, fields: {
    '提交人OpenID': 'ou_' + owner, '提交人姓名': '同名合成成员', '周次': week,
    '论文标题': '合成文献-' + rows.length, '提交时间': at, '提交人角色': '学生 / 管理员 / 教师'
  } });
}
addRows('b', '2026-W37', 40);
addRows('a', '2026-W37', 2, now - 86400000);
addRows('a', '2026-W36', 9, now - 6 * 86400000);
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input); assert.equal(url.hostname, 'open.feishu.cn');
  if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'fixture', expire: 7200 });
  assert.equal(options.method, 'GET', 'Counting cannot write data');
  const table = url.pathname.match(/\/tables\/([^/]+)\/records$/)?.[1]; assert.ok(table, url.pathname);
  const records = table === 'members' ? people : table === 'literature' ? rows : [];
  const start = Number(url.searchParams.get('page_token') || 0), end = start + 20;
  return Response.json({ code: 0, data: { items: records.slice(start, end), has_more: end < records.length, page_token: String(end) } });
};
async function readingFor(id) {
  const payload = Buffer.from(JSON.stringify({ purpose: 'session', sub: 'ou_' + id, exp: Math.floor(now / 1000) + 3600 })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return service.fetch(new Request('https://fixture.test/api/literature', { headers: { Authorization: 'Bearer ' + payload + '.' + sig } }), env);
}
try {
  for (const [id, count] of [['a', 2], ['b', 40], ['c', 0]]) {
    const response = await readingFor(id); assert.equal(response.status, 200);
    const { literature } = await response.json();
    assert.equal(literature.mineCount, count, 'Own count uses OpenID and current week across all pages');
    assert.equal(literature.minimum, 3); assert.equal(literature.completed, count >= 3);
    assert.equal(literature.items.length, 30, 'Shared recent list size cannot determine personal completion');
    assert.ok(literature.items.every(item => item.role === '博士'), 'Shared bylines belong to each author, not the logged-in RA');
  }
  addRows('a', '2026-W37', 2, now + 1000);
  const updatedReading = (await (await readingFor('a')).json()).literature;
  assert.equal(updatedReading.mineCount, 4, 'Actual count is not capped at three');
  assert.equal(updatedReading.items[0].role, 'RA');
  assert.equal(updatedReading.items[2].role, '博士', 'Same-name authors resolve by OpenID');
  now = RealDate.parse('2026-09-13T16:00:00Z');
  const nextWeek = (await (await readingFor('a')).json()).literature;
  assert.equal(nextWeek.weekId, '2026-W38'); assert.equal(nextWeek.mineCount, 0);
  assert.ok(nextWeek.items.length > 0, 'Last-seven-days shared records survive the personal week reset');
  people[0].fields['人员边界'] = '团队外';
  assert.equal((await readingFor('a')).status, 403, 'Existing session cannot read internal literature after scope revocation');
} finally { globalThis.fetch = realFetch; globalThis.Date = RealDate; }

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const week = { id: '2026-W37', label: '合成周次', dueLabel: '周五 18:00' };
const report = { recordId: 'report-a', weekId: week.id, submittedAt: '2026-09-10', values: {
  progress: '完成合成实验', blockers: '标定误差偏高\n<img src=x onerror="window.injected=true">', nextPlan: '复核参数'
} };
const students = [
  { id: 'student-a', name: '合成学生甲', project: '合成项目', status: '已提交', tone: 'red', blocker: report.values.blockers, currentReport: report },
  { id: 'student-b', name: '合成学生乙', project: '', status: '已提交', tone: 'green', blocker: '无', currentReport: { ...report, recordId: 'report-b', values: { blockers: '无' } } },
  { id: 'student-c', name: '合成学生丙', project: '', status: '未提交', tone: 'orange', blocker: '等待本周记录', currentReport: null },
  { id: 'student-old', name: '过期合成记录', project: '', status: '已提交', tone: 'red', blocker: '过期阻塞', currentReport: { ...report, weekId: '2026-W36' } }
];
const settle = async predicate => {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 3)); }
  throw Error('UI did not settle');
};
async function setup({ mineCount = 2, studentRows = students, weeklyError = false, roles = ['student', 'teacher', 'manager'], memberCategory = '', activateTeacher = true } = {}) {
  const errors = [], requests = [];
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, { url: 'https://fixture.test/#session=fixture-token', runScripts: 'outside-only', virtualConsole });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.scrollTo = () => {}; w.confirm = () => true; w.AbortSignal = AbortSignal;
  w.eval(readFileSync(new URL('../config.js', import.meta.url), 'utf8'));
  w.ER2_CONFIG = { demo: false, apiBase: 'https://api.test', feishuWikiUrl: 'https://fixture.feishu.cn/wiki/fixture' };
  const profile = { sub: 'fixture', personId: 'P-001', name: '合成登录人', roles, memberCategory };
  const weekly = { profile, week, student: { report: { status: 'pending', values: {} }, history: [] }, teacher: { students: structuredClone(studentRows), stats: { submitted: 2, missing: 1, blocked: 1 } } };
  const bootstrap = { progressive: true, profile, week, student: { ...weekly.student, course: { lessons: [] }, tasks: [], links: [], projects: [] }, teacher: { ...weekly.teacher, commonIssues: ['不再显示'], courseReview: { visible: false } }, manager: { stats: { members: 4, projects: null, courses: 1 }, automations: [] }, literature: null, catalog: [], moduleErrors: {}, moduleLoading: { weekly: true, projects: true, literature: true, extras: true }, capabilities: { courses: { enabled: false } } };
  w.fetch = async (input, options = {}) => {
    const url = new URL(input, w.location.href), path = url.pathname + url.search;
    assert.ok(['fixture.test', 'api.test'].includes(url.hostname));
    requests.push({ path, method: options.method || 'GET' });
    const data = {
      '/data/catalog.json': [], '/api/dashboard': { ...bootstrap, progressive: false, moduleLoading: {},
        moduleErrors: weeklyError ? { weekly: '暂时无法读取' } : {},
        literature: { mineCount, minimum: 3, completed: mineCount >= 3, items: [{ id: 'shared-other', submitter: '其他合成成员', title: '共享文献', contribution: '合成贡献' }] } },
      '/api/weekly': weeklyError ? Response.json({ error: 'synthetic weekly failure' }, { status: 503 }) : weekly,
      '/api/projects': { projects: [] },
      '/api/literature': { literature: { mineCount, minimum: 3, completed: mineCount >= 3, items: [{ id: 'shared-other', submitter: '其他合成成员', title: '共享文献', contribution: '合成贡献' }] } },
      '/api/dashboard?section=extras': { ...bootstrap, moduleLoading: {}, moduleErrors: {} },
      '/api/finance': { ready: true, statuses: { draft: '草稿' }, access: { canSubmit: true, canReview: true, canConfigure: true } }
    }[path];
    assert.notEqual(data, undefined, 'Unexpected route ' + path);
    return data instanceof Response ? data : Response.json(data);
  };
  w.eval(w.document.querySelector('script:not([src])').textContent);
  for (const file of ['draft-store', 'guide-store', 'learning-center', 'finance']) w.eval(readFileSync(new URL('../' + file + '.js', import.meta.url), 'utf8'));
  w.eval(source);
  await settle(() => w.document.querySelector('[data-open-literature]') && w.document.querySelector('[data-role]'));
  if (activateTeacher && roles.includes('teacher')) w.document.querySelector('[data-role="teacher"]').click();
  await settle(() => w.document.querySelector(weeklyError ? '[data-reload-module="weekly"]' : roles.includes('teacher') ? '[data-open-teacher-attention]' : '[data-open-report]'));
  return { w, dom, errors, requests };
}
{
  const { w, dom, errors } = await setup({ roles: ['manager', 'teacher'], memberCategory: 'PI', activateTeacher: false });
  try {
    assert.equal(w.document.querySelector('#role-nav [data-role]:first-child').dataset.role, 'teacher');
    assert.equal(w.document.querySelector('#role-nav [data-role="teacher"]').classList.contains('active'), true);
    assert.match(w.document.querySelector('#app-root').textContent, /教师汇总页/);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
}
{
  const { w, dom, errors, requests } = await setup();
  const d = w.document;
  try {
    assert.match(d.querySelector('.literature-panel').textContent, /每人每周至少 3 篇/);
    assert.equal(d.querySelector('.literature-count strong').textContent, '2 / 3');
    assert.match(d.querySelector('.literature-count span').textContent, /合成登录人/);
    assert.match(d.querySelector('.literature-status').textContent, /还需 1 篇/);
    assert.equal(d.querySelectorAll('.literature-item').length, 1);
    assert.doesNotMatch(d.querySelector('#app-root').textContent, /本周共性问题|教师快捷入口/);
    const before = requests.length, card = d.querySelector('[data-open-teacher-attention]');
    assert.equal(card.tagName, 'BUTTON'); assert.equal(card.querySelector('strong').textContent, '1');
    card.click(); assert.equal(d.querySelector('#teacher-attention-dialog').open, true);
    assert.equal(d.querySelectorAll('.attention-list li').length, 1);
    assert.match(d.querySelector('#teacher-attention-body').textContent, /合成学生甲.*来源：周报.*2026-W37/s);
    assert.equal(d.querySelector('.attention-blocker').textContent, report.values.blockers);
    assert.equal(d.querySelector('.attention-blocker img'), null, 'Blocker text cannot inject HTML');
    d.querySelector('[data-attention-student]').click();
    assert.equal(d.querySelector('#teacher-attention-dialog').open, false);
    assert.equal(d.querySelector('#student-detail-dialog').open, true);
    assert.equal(d.querySelector('#feedback-record-id').value, 'report-a');
    assert.match(d.querySelector('#student-detail-body').textContent, /完成合成实验/);
    d.querySelector('[data-close-dialog="student-detail-dialog"]').click();
    card.click();
    assert.equal(requests.length, before, 'Opening and navigating the attention list needs no additional requests');
    d.querySelector('[data-role="student"]').click();
    assert.equal(d.querySelector('#teacher-attention-dialog').open, false);
    assert.equal(d.querySelector('#teacher-attention-body').textContent, '');
    d.querySelector('[data-role="teacher"]').click();
    d.querySelector('[data-open-teacher-attention]').click();
    const oldButton = d.querySelector('[data-attention-student]');
    // Revoking an existing session also invalidates retained dialog buttons.
    w.dispatchEvent(new w.CustomEvent('er2-session-denied', { detail: { status: 403 } }));
    oldButton.click();
    assert.equal(d.querySelector('#teacher-attention-dialog').open, false);
    assert.equal(d.querySelector('#teacher-attention-body').textContent, '');
    assert.equal(d.querySelector('#student-detail-dialog').open, false, 'Old dialog action cannot reopen private data after revocation');
    assert.ok(requests.every(r => r.method === 'GET'));
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
}
for (const mineCount of [0, 5]) {
  const { w, dom, errors } = await setup({ mineCount, studentRows: [] });
  try {
    assert.equal(w.document.querySelector('.literature-count strong').textContent, mineCount + ' / 3');
    assert.match(w.document.querySelector('.literature-status').textContent, mineCount ? /可继续提交/ : /还需 3 篇/);
    w.document.querySelector('[data-open-teacher-attention]').click();
    assert.match(w.document.querySelector('#teacher-attention-body').textContent, /暂无需要关注/);
    w.document.querySelector('[data-close-dialog="teacher-attention-dialog"]').click();
    assert.equal(w.document.querySelector('#teacher-attention-dialog').open, false);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
}
for (const options of [{ weeklyError: true }, { roles: ['student'] }]) {
  const { w, dom, errors } = await setup(options);
  try {
    assert.equal(w.document.querySelector('[data-open-teacher-attention]'), null);
    assert.ok(w.document.querySelector('[data-open-literature]'), 'Literature remains usable when weekly data fails');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
}
console.log('PASS personal weekly reading counts, week rollover, scoped teacher attention details, safe text, navigation, empty state and revocation');
