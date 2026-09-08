import assert from 'node:assert/strict';
import service from './src/runtime.js';
import { WEEKLY_FIELDS, weeklyValues } from './src/weekly-write.js';
import { runProfessorDigest, weekAt } from './src/professor-digest.js';
import { recordPage } from './src/feishu-record-page.js';
import { weeklyAutomationConfiguration } from './src/weekly-policy.js';

const env = { FEISHU_APP_ID: 'mock-app', FEISHU_APP_SECRET: 'mock-secret', SESSION_SECRET: 'mock-weekly-stability-secret',
  PROFESSOR_OPEN_ID: 'ou_pi', FRONTEND_URL: 'https://workbench.example/' };
for (const name of ['MEMBERS', 'AUTH_PROJECTS', 'PROJECT_MEMBERS', 'WEEKLY', 'LITERATURE', 'AUTOMATION_LOGS']) {
  env[name + '_TABLE_ID'] = name.toLowerCase(); env[name + '_BASE_APP_TOKEN'] = 'base-' + name.toLowerCase();
}
const person = (n, id, kind, duties = []) => ({ record_id: 'person-' + n, fields: {
  '成员编号': 'P-' + String(n).padStart(3, '0'), '姓名': '测试人员' + n, '飞书成员': [{ id }],
  '人员状态': '在组', '人员边界': '团队内', '成员类别': kind, '系统职责': duties
} });
const at = Date.parse('2026-09-11T10:00:00Z');
let people, reports, logs, sends, writes, reads, failures, emptyPages, revokeBeforeWrite;
function reset() {
  people = [person(1, 'ou_pi', 'PI', ['教授周报接收']), person(2, 'ou_ra', 'RA', ['管理员', '课程审核']), person(3, 'ou_student', '博士')];
  reports = []; logs = []; sends = []; writes = []; reads = []; failures = new Set(); emptyPages = new Set(); revokeBeforeWrite = false;
}
const response = data => Response.json(data);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input); assert.equal(url.hostname, 'open.feishu.cn');
  const body = options.body ? JSON.parse(options.body) : null;
  if (url.pathname.endsWith('/tenant_access_token/internal')) return response({ code: 0, tenant_access_token: 'mock-token' });
  if (url.pathname.endsWith('/im/v1/messages')) {
    if (failures.has(body.receive_id)) throw new Error('mock delivery failure');
    sends.push(body); return response({ code: 0, data: { message_id: 'mock-message' } });
  }
  const match = url.pathname.match(/\/apps\/([^/]+)\/tables\/([^/]+)\/(records|fields)(?:\/([^/]+))?$/);
  assert.ok(match, 'Unexpected mocked API: ' + url.pathname);
  const [, base, table, kind, recordId] = match;
  assert.equal(base, 'base-' + table);
  if (kind === 'fields') {
    if (revokeBeforeWrite) people[1].fields['成员类别'] = 'PI';
    return response({ code: 0, data: { items: Object.entries(WEEKLY_FIELDS).map(([field_name, types]) => ({ field_name, type: types[0] })), has_more: false } });
  }
  if (!body) {
    reads.push(table);
    if (failures.has(table)) return response({ code: 999, msg: 'mock table failure' });
    if (emptyPages.has(table)) return response({ code: 0, data: { total: 0, has_more: false } });
    return response({ code: 0, data: { items: ({ members: people, weekly: reports, automation_logs: logs })[table] || [], has_more: false } });
  }
  writes.push({ table, fields: body.fields });
  if (table === 'automation_logs') logs.push({ record_id: 'log-' + logs.length, fields: body.fields });
  if (table === 'weekly') {
    if (recordId) Object.assign(reports.find(r => r.record_id === recordId).fields, body.fields);
    else reports.push({ record_id: 'report-' + reports.length, fields: body.fields });
  }
  return response({ code: 0, data: { record: { record_id: recordId || 'report-0', fields: body.fields } } });
};
async function api(id, path, body) {
  const payload = Buffer.from(JSON.stringify({ purpose: 'session', sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return service.fetch(new Request('https://worker.example' + path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + payload + '.' + signature, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) }), env);
}
async function remind(config = env) {
  const queued = [];
  await service.scheduled({ scheduledTime: Date.parse('2026-09-11T03:00:00Z') }, config, { waitUntil: p => queued.push(p) });
  return Promise.all(queued);
}
let count = 0;
async function test(name, fn) { reset(); await fn(); count++; console.log('PASS weekly stability:', name); }
try {
  await test('reminder includes students with management duties and does not read literature', async () => {
    failures.add('literature'); await remind();
    assert.deepEqual(sends.map(s => s.receive_id).sort(), ['ou_ra', 'ou_student']);
    assert.equal(reads.includes('literature'), false);
  });
  await test('partial reminder retries only failed recipients and uses stable message IDs', async () => {
    failures.add('ou_student'); await assert.rejects(() => remind());
    assert.equal(sends.length, 1); assert.equal(sends[0].uuid.length, 32);
    const successfulUuid = sends[0].uuid;
    failures.clear(); await remind(); await remind();
    assert.equal(sends.length, 2); assert.equal(sends[0].uuid, successfulUuid);
    assert.equal(new Set(sends.map(s => s.uuid)).size, 2);
  });
  await test('missing reminder log binding fails before any delivery', async () => {
    const config = weeklyAutomationConfiguration({ ...env, AUTOMATION_LOGS_TABLE_ID: '' });
    assert.equal(config.remindersConfigured, false); assert.equal(config.digestConfigured, false);
    assert.ok(config.missingBindings.includes('AUTOMATION_LOGS_TABLE_ID'));
    await assert.rejects(() => remind({ ...env, AUTOMATION_LOGS_TABLE_ID: '' })); assert.equal(sends.length, 0);
  });
  await test('draft placeholders do not suppress reminders', async () => {
    reports.push({ fields: { '飞书OpenID': 'ou_ra', '周次': weekAt(at).id, '提交状态': '草稿' } });
    await remind(); assert.equal(sends.length, 2);
  });
  await test('digest includes the same dual-role roster as teacher page', async () => {
    const result = await runProfessorDigest(at, env);
    assert.equal(result.expected, 2);
    const page = await (await api('ou_ra', '/api/weekly')).json();
    assert.equal(page.teacher.students.length, result.expected);
  });
  await test('digest accepts explicit empty first pages for weekly and log tables', async () => {
    emptyPages.add('weekly'); emptyPages.add('automation_logs');
    const result = await runProfessorDigest(at, env);
    assert.equal(result.expected, 2); assert.equal(result.submitted, 0); assert.ok(sends.length);
  });
  await test('optional literature failure is labelled and does not block the weekly digest', async () => {
    failures.add('literature');
    const result = await runProfessorDigest(at, env);
    assert.equal(result.expected, 2);
    assert.ok(sends.some(s => s.content.includes('文献统计暂不可用')));
    assert.ok(sends.every(s => !s.content.includes('文献阅读 0 篇')));
  });
  await test('authoritative weekly read failure prevents a misleading digest', async () => {
    failures.add('weekly'); await assert.rejects(() => runProfessorDigest(at, env)); assert.equal(sends.length, 0);
  });
  await test('record parser rejects malformed, later-empty and incomplete pages', () => {
    assert.deepEqual(recordPage({ code: 0, data: { total: 0, has_more: false } }), { items: [], next: '' });
    for (const data of [{ items: null, total: 1, has_more: false }, { items: [], has_more: true }, { items: [], has_more: 'false' }])
      assert.throws(() => recordPage({ code: 0, data }));
    assert.throws(() => recordPage({ code: 0, data: { total: 0, has_more: false } }, 'next-page', 1));
  });
  await test('draft rows never appear as formally submitted to student or teacher', async () => {
    const week = (await (await api('ou_ra', '/api/weekly')).json()).week.id;
    reports.push({ record_id: 'draft', fields: { '飞书OpenID': 'ou_ra', '周次': week, '提交状态': '草稿' } });
    const page = await (await api('ou_ra', '/api/weekly')).json();
    assert.equal(page.student.report.status, 'pending'); assert.equal(page.student.history.length, 0);
    assert.equal(page.teacher.stats.submitted, 0);
  });
  await test('no-issue text does not turn teacher statistics red', async () => {
    const week = (await (await api('ou_ra', '/api/weekly')).json()).week.id;
    for (const blockers of ['无', '暂无阻塞。', 'NONE', 'n/a']) {
      reports = [{ record_id: 'saved', fields: { '飞书OpenID': 'ou_ra', '周次': week, '提交状态': '已提交', '问题与阻塞': blockers } }];
      const page = await (await api('ou_ra', '/api/weekly')).json();
      assert.equal(page.teacher.stats.blocked, 0); assert.equal(page.teacher.students.find(s => s.id === 'ou_ra').tone, 'green');
    }
  });
  await test('non-text form values are rejected without storing object text', async () => {
    const r = await api('ou_ra', '/api/reports', { progress: { bad: true }, nextPlan: 'next' });
    assert.equal(r.status, 400); assert.equal(writes.length, 0);
  });
  await test('student role revoked during submit prevents the final write', async () => {
    revokeBeforeWrite = true;
    const r = await api('ou_ra', '/api/reports', { progress: 'result', nextPlan: 'next' });
    assert.equal(r.status, 403); assert.equal(writes.length, 0);
  });
  await test('a deliberately cleared canonical value never revives an old alias', () => {
    assert.equal(weeklyValues({ fields: { '当前问题与阻塞': '', '问题与阻塞': 'obsolete issue' } }).blockers, '');
    assert.equal(weeklyValues({ fields: { '当前问题与阻塞': null, '问题与阻塞': 'obsolete issue' } }).blockers, '');
  });
} finally { globalThis.fetch = originalFetch; }
console.log('Weekly stability tests passed:', count);
