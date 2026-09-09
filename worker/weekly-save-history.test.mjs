import assert from 'node:assert/strict';
import service from './src/runtime.js';
import { WEEKLY_FIELDS } from './src/weekly-write.js';
import { weeklyRevision, weeklyDates } from './src/weekly-history.js';
import { mockWeeklyCoordinator } from './test-weekly-coordinator.mjs';

const env = { FEISHU_APP_ID: 'save-history-app', FEISHU_APP_SECRET: 'fixture', SESSION_SECRET: 'save-history-session', FRONTEND_URL: 'https://workbench.example/' };
for (const name of ['MEMBERS', 'AUTH_PROJECTS', 'PROJECT_MEMBERS', 'PROJECTS', 'WEEKLY']) {
  env[name + '_TABLE_ID'] = name.toLowerCase(); env[name + '_BASE_APP_TOKEN'] = 'fixture-' + name.toLowerCase();
}
const member = n => ({ record_id: 'member-' + n, fields: { '人员编号': 'P-00' + n, '姓名': '测试' + n,
  '飞书成员': [{ id: 'ou_' + n }], '人员状态': '在组', '人员边界': '团队内', '成员类别': '博士' } });
const realNow = Date.now; let clock = realNow(); Date.now = () => clock;
let reports, people, attempts, fail, hideNextRead;
function reset() { clock += 61000; reports = []; people = [member(1), member(2)]; attempts = []; fail = ''; hideNextRead = false; env.WEEKLY_WRITES = mockWeeklyCoordinator(env); }
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input); assert.equal(url.hostname, 'open.feishu.cn');
  if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'fixture' });
  const match = url.pathname.match(/\/tables\/([^/]+)\/(records|fields)(?:\/([^/]+))?$/);
  assert.ok(match, 'Unexpected mock API: ' + url.pathname);
  const [, table, kind, id] = match;
  if (kind === 'fields') return Response.json({ code: 0, data: { items: Object.entries(WEEKLY_FIELDS).map(([field_name, types]) => ({ field_name, type: types[0] })), has_more: false } });
  if (!options.body) {
    if (table === 'weekly' && hideNextRead) { hideNextRead = false; return Response.json({ code: 0, data: { items: [], has_more: false } }); }
    // Force multiple Feishu pages so history cannot accidentally stop at page one.
    const all = table === 'members' ? people : table === 'weekly' ? reports : [];
    const offset = Number(url.searchParams.get('page_token') || 0), end = offset + 17;
    return Response.json({ code: 0, data: { items: all.slice(offset, end), has_more: end < all.length, page_token: end < all.length ? String(end) : '' } });
  }
  assert.equal(table, 'weekly', 'Never write personnel, relationships or other tables');
  attempts.push(options.method);
  if (fail === 'processing') return Response.json({ code: 1254607 }, { status: 400 });
  if (fail === 'rejected') return Response.json({ code: 1254015, msg: 'field rejected' });
  if (fail === 'no-write') throw new Error('network response unknown');
  const fields = JSON.parse(options.body).fields;
  const record = id ? reports.find(r => r.record_id === id) : { record_id: 'weekly-' + reports.length, fields: {} };
  Object.assign(record.fields, fields); if (!id) reports.push(record);
  if (fail === 'lost-response') throw new Error('response lost after remote commit');
  if (fail === 'readback') hideNextRead = true;
  return Response.json({ code: 0, data: { record } });
};
async function api(path, body, n = 1) {
  const payload = Buffer.from(JSON.stringify({ purpose: 'session', sub: 'ou_' + n, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  const r = await service.fetch(new Request('https://worker.example' + path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + payload + '.' + sig, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  return { status: r.status, data: await r.json() };
}
const draft = (requestId = 'weekly-save-1', progress = '本周结果') => ({ requestId, progress, nextPlan: '下周计划', evidence: '产出 https://example.com/result\nhttps://lab.feishu.cn/docx/test', baseRevision: '' });
let count = 0;
async function test(name, fn) { reset(); await fn(); count++; console.log('PASS weekly save/history:', name); }
try {
  await test('concurrent identical first submits create one verified record', async () => {
    const result = await Promise.all([api('/api/reports', draft()), api('/api/reports', draft())]);
    assert.deepEqual(result.map(r => r.status), [200, 200]); assert.equal(reports.length, 1); assert.deepEqual(attempts, ['POST']);
    assert.ok(result.every(r => r.data.readBackVerified));
  });
  await test('concurrent different first submits never overwrite each other', async () => {
    const result = await Promise.all([api('/api/reports', draft()), api('/api/reports', draft('weekly-save-2', '另一台设备'))]);
    assert.deepEqual(result.map(r => r.status).sort(), [200, 409]); assert.equal(attempts.length, 1); assert.equal(reports.length, 1);
  });
  await test('current revision can edit; stale revision and old retry cannot revert it', async () => {
    const a = await api('/api/reports', draft());
    const b = await api('/api/reports', { ...draft('weekly-save-2', '确认修改'), baseRevision: a.data.report.revision });
    assert.equal(b.status, 200); assert.notEqual(a.data.report.revision, b.data.report.revision);
    assert.equal((await api('/api/reports', { ...draft('weekly-save-3', '陈旧草稿'), baseRevision: a.data.report.revision })).status, 409);
    assert.equal((await api('/api/reports', draft())).status, 409);
    assert.equal((await api('/api/reports', draft('weekly-save-1', '改动请求内容'))).status, 409);
    assert.equal(reports[0].fields['本周完成与结果'], '确认修改'); assert.deepEqual(attempts, ['POST', 'PUT']);
  });
  await test('lost response and coordinator restart recover from durable journal without another write', async () => {
    fail = 'lost-response'; assert.equal((await api('/api/reports', draft())).data.code, 'WEEKLY_WRITE_UNCERTAIN');
    env.WEEKLY_WRITES.restart(); fail = '';
    const r = await api('/api/reports', draft()); assert.equal(r.status, 200); assert.equal(r.data.deduplicated, true);
    assert.deepEqual(attempts, ['POST']); assert.equal(reports.length, 1);
  });
  await test('uncertain invisible upstream write cannot trigger a blind second create', async () => {
    fail = 'no-write'; const first = await api('/api/reports', draft()); assert.equal(first.data.code, 'WEEKLY_WRITE_UNCERTAIN');
    env.WEEKLY_WRITES.restart(); fail = '';
    const retry = await api('/api/reports', draft()); assert.equal(retry.status, 503); assert.equal(retry.data.code, 'WEEKLY_WRITE_UNCERTAIN');
    assert.deepEqual(attempts, ['POST']);
  });
  await test('HTTP 400 data-not-ready is ambiguous, not permission to duplicate', async () => {
    fail = 'processing'; assert.equal((await api('/api/reports', draft())).data.code, 'WEEKLY_WRITE_UNCERTAIN'); fail = '';
    assert.equal((await api('/api/reports', draft())).data.code, 'WEEKLY_WRITE_UNCERTAIN'); assert.equal(attempts.length, 1);
  });
  await test('explicit rejected write can be retried after the upstream problem is fixed', async () => {
    fail = 'rejected'; assert.notEqual((await api('/api/reports', draft())).status, 200); fail = '';
    assert.equal((await api('/api/reports', draft())).status, 200); assert.equal(reports.length, 1); assert.equal(attempts.length, 2);
  });
  await test('unconfirmed readback retains pending state and next read confirms original record', async () => {
    fail = 'readback'; assert.equal((await api('/api/reports', draft())).data.code, 'WEEKLY_READBACK_FAILED'); fail = '';
    assert.equal((await api('/api/reports', draft())).status, 200); assert.equal(attempts.length, 1);
  });
  await test('missing coordinator refuses writes; identity is rechecked on retry', async () => {
    const binding = env.WEEKLY_WRITES; delete env.WEEKLY_WRITES;
    assert.equal((await api('/api/reports', draft())).status, 503); env.WEEKLY_WRITES = binding;
    assert.equal((await api('/api/reports', draft())).status, 200);
    people[0].fields['人员状态'] = '离组'; assert.equal((await api('/api/reports', draft())).status, 403); assert.equal(attempts.length, 1);
  });
  await test('history reads every page, filters before counting and keeps all five fields', async () => {
    for (let n = 1; n <= 45; n++) reports.push({ record_id: 'history-' + n, fields: {
      '飞书OpenID': 'ou_1', '周次': '2025-W' + String(n).padStart(2, '0'), '提交状态': '已提交',
      '本周完成与结果': '结果' + n, '学习与方法': '学习', '证据链接': 'https://example.com/' + n, '问题与阻塞': '无', '下周计划': '计划', '提交时间': '2025-09-05T10:01:00Z' } });
    reports.push({ record_id: 'private-other-user', fields: { '飞书OpenID': 'ou_2', '周次': '2026-W01', '提交状态': '已提交' } },
      { record_id: 'private-project', fields: { '飞书OpenID': 'ou_1', '周次': '2026-W02', '提交状态': '已提交', '项目编号': 'PRJ-099' } },
      { record_id: 'draft', fields: { '飞书OpenID': 'ou_1', '周次': '2026-W03', '提交状态': '草稿' } });
    const pages = await Promise.all([1, 2, 3].map(p => api('/api/reports/history?page=' + p + '&openId=ou_2')));
    assert.ok(pages.every(r => r.status === 200 && r.data.total === 45 && r.data.pages === 3));
    const all = pages.flatMap(r => r.data.reports); assert.equal(new Set(all.map(r => r.recordId)).size, 45);
    assert.equal(all[0].weekId, '2025-W45'); assert.equal(all.at(-1).weekId, '2025-W01');
    assert.deepEqual(Object.keys(all[0].values).sort(), ['blockers', 'evidence', 'learning', 'nextPlan', 'progress']);
    assert.deepEqual(pages[0].data.years, ['2025']);
    const filtered = await api('/api/reports/history?year=2025&week=2'); assert.equal(filtered.data.total, 1); assert.equal(filtered.data.reports[0].weekId, '2025-W02');
    assert.equal((await api('/api/reports/history?year=2024')).data.total, 0);
    for (const query of ['page=-1', 'week=54', 'year=x']) assert.equal((await api('/api/reports/history?' + query)).status, 400);
    assert.equal(attempts.length, 0);
  });
  await test('ISO week dates, Shanghai saved time and stable revisions', async () => {
    const record = { record_id: 'date', fields: { '周次': '2020-W53', '提交时间': '2021-01-01T16:05:00Z' } };
    const dates = weeklyDates(record); assert.equal(dates.weekStart, '2020-12-28'); assert.equal(dates.weekEnd, '2021-01-03');
    assert.ok(dates.savedAt.includes('2021/01/02')); assert.ok(dates.savedAt.includes('00:05'));
    const revision = await weeklyRevision(record); record.fields['教师反馈'] = '反馈'; assert.equal(await weeklyRevision(record), revision);
    record.fields['本周完成与结果'] = '正文变化'; assert.notEqual(await weeklyRevision(record), revision);
  });
} finally { globalThis.fetch = originalFetch; Date.now = realNow; }
console.log('Weekly save/history tests passed:', count);
