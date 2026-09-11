import { LITERATURE_FIELDS } from './src/literature-write.js';
import assert from 'node:assert/strict';
import service from './src/runtime.js';
import { feishuRequest } from './src/index.js';
import { LearningRecords } from './src/learning-coordinator.js';
import { mockWeeklyCoordinator } from './test-weekly-coordinator.mjs';
import { WEEKLY_FIELDS } from './src/weekly-write.js';
import { weeklyRevision } from './src/weekly-history.js';

const env = { SESSION_SECRET: 'read-test-secret', FEISHU_APP_ID: 'read-test-app', FEISHU_APP_SECRET: 'fixture-only',
  FRONTEND_URL: 'https://fixture.test/', LEARNING_RECORDS_ENABLED: 'true' };
for (const name of ['MEMBERS', 'AUTH_PROJECTS', 'PROJECT_MEMBERS', 'PROJECTS', 'WEEKLY', 'LITERATURE', 'TASKS', 'LINKS']) {
  env[name + '_TABLE_ID'] = name.toLowerCase(); env[name + '_BASE_APP_TOKEN'] = 'fixture-' + name.toLowerCase();
}
const person = n => ({ record_id: 'person-' + n, fields: { '人员编号': 'P-00' + n, '姓名': '合成学生' + n,
  '飞书成员': [{ id: 'ou_' + n }], '人员状态': '在组', '人员边界': '团队内', '成员类别': '博士', '保密等级': '内部' } });
const people = [person(1), person(2), { ...person(9), fields: { ...person(9).fields, '系统职责': ['管理员'] } }];
const projects = [{ record_id: 'p1', fields: { '项目编号': 'PRJ-001', '项目阶段': '执行中', '保密等级': '内部' } }];
const relations = [{ record_id: 'r1', fields: { '关联人员': ['person-1'], '关联项目': ['p1'], '权限级别': '编辑',
  '授权状态': '有效', '工作台授权确认': '已确认', '权限落实状态': '已落实', '成员边界': '团队内',
  '加入日期': '2020-01-01', '权限到期日': '2099-01-01', '审批人': [{ id: 'ou_9' }] } }];
const literatureRows = [];
const businessProjects = [
  { record_id: 'business-1', fields: { '项目编号': 'PRJ-001', '项目名称': '合成项目', '状态': '执行中','保密等级':'内部' } },
  { record_id: 'business-hidden', fields: { '项目编号': 'PRJ-999', '项目名称': '不可见项目', '状态': '执行中','保密等级':'内部' } }
];
let rows = [], calls = [], writes = 0, failed = '', holdMember, onRead;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input); assert.equal(url.hostname, 'open.feishu.cn', 'All upstream requests are intercepted');
  if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'fixture' });
  const match = url.pathname.match(/\/tables\/([^/]+)\/(records|fields)(?:\/([^/]+))?$/);
  assert.ok(match, url.pathname); const [, table, kind, id] = match;
  calls.push(table + ':' + kind + ':' + options.method);
  if (kind === 'fields') return Response.json({ code: 0, data: { items: Object.entries(table === 'literature' ? LITERATURE_FIELDS : WEEKLY_FIELDS)
    .map(([field_name, types]) => ({ field_name, type: types[0] })), has_more: false } });
  if (options.method === 'GET') {
    if (failed === table) return Response.json({ code: 99991672, msg: 'synthetic rejection' });
    const items = { members: people, auth_projects: projects, project_members: relations, projects: businessProjects, weekly: rows, literature: literatureRows }[table] || [];
    if (id) return Response.json({ code: 0, data: { record: items.find(r => r.record_id === id) } });
    const result = Response.json({ code: 0, data: { items: structuredClone(items), has_more: false } });
    if (onRead) onRead(table);
    if (table === 'members' && holdMember) { const wait = holdMember; holdMember = null; await wait(); }
    return result;
  }
  assert.ok(['weekly', 'literature'].includes(table), 'No personnel or permission mutations');
  writes++;
  const record = id ? rows.find(r => r.record_id === id) : { record_id: 'record-' + writes, fields: {} };
  Object.assign(record.fields, JSON.parse(options.body).fields);
  if (table === 'weekly' && !id) rows.push(record);
  if (table === 'literature' && !id) literatureRows.push(record);
  return Response.json({ code: 0, data: { record } }, { status: 200 });
};
async function request(path, n = 1, body, extraHeaders = {}) {
  const encoded = Buffer.from(JSON.stringify({ purpose: 'session', sub: 'ou_' + n, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded))).toString('base64url');
  return new Request('https://fixture.test' + path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + encoded + '.' + sig, 'Content-Type': 'application/json', ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const call = async (path, n, body, config = env, headers = {}) => service.fetch(await request(path, n, body, headers), config);
const draft = { requestId: 'performance-weekly-1', progress: '原五项测试正文', learning: '学习收获', evidence: 'https://example.com', blockers: '', nextPlan: '后续计划', baseRevision: '' };
try {
  env.WEEKLY_WRITES = mockWeeklyCoordinator(env);
  const counts = {};
  for (const path of ['/api/me', '/api/weekly', '/api/reports/history', '/api/dashboard']) {
    calls = []; const response = await call(path); assert.equal(response.status, 200);
    assert.ok(response.headers.get('Server-Timing').includes('members_'));
    counts[path] = calls.length;
  }
  assert.deepEqual(counts, { '/api/me': 1, '/api/weekly': 2, '/api/reports/history': 2, '/api/dashboard': 8 });
  calls = []; const core = await (await call('/api/dashboard?section=core')).json();
  assert.equal(core.progressive, true); assert.deepEqual(core.moduleLoading, { literature: true });
  assert.deepEqual(core.moduleDeferred, { extras: true });
  assert.equal(calls.length, 5, 'Core first paint only reads identity, weekly, projects and authorization');
  assert.equal(calls.some(c => /^(literature|tasks|links):/.test(c)), false);
  calls = []; const bootResponse = await call('/api/bootstrap'); const boot = await bootResponse.json();
  assert.equal(bootResponse.status, 200); assert.equal(calls.length, 5, 'Bootstrap starts all required first-paint reads in one round');
  assert.ok(typeof boot.readContext === 'string' && boot.readContext.includes('.'));
  calls = []; const acceleratedLiterature = await call('/api/literature', 1, undefined, env, { 'X-ER2-Read-Context': boot.readContext });
  assert.equal(acceleratedLiterature.status, 200);
  assert.deepEqual(calls.map(c => c.split(':')[0]), ['literature'], 'A signed read context avoids repeating the personnel read');

  calls = []; let releaseMember;
  const memberGate = new Promise(resolve => { releaseMember = resolve; });
  holdMember = () => memberGate;
  const simultaneous = [call('/api/me'), call('/api/me')];
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.filter(c => c.startsWith('members:')).length, 1, 'Identical concurrent reads share one Feishu request');
  releaseMember();
  assert.deepEqual((await Promise.all(simultaneous)).map(response => response.status), [200, 200]);
  calls = []; const first = await call('/api/reports', 1, draft, env, { 'X-ER2-Read-Context': boot.readContext });
  assert.equal(first.status, 200); assert.equal((await first.json()).readBackVerified, true);
  assert.equal(calls.length, 7); assert.equal(writes, 1);
  assert.equal(calls.filter(c => c.startsWith('members:')).length, 3, 'Writes ignore the read context; entry, coordinator and pre-write identities remain fresh');
  console.log('PASS read counts:', JSON.stringify({ ...counts, 'POST /api/reports': calls.length }));

  calls = []; const start = await (await call('/api/dashboard/start')).json();
  assert.equal(start.progressive, true); assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(start.moduleLoading).sort(), ['extras','literature','projects','weekly']);
  failed = 'project_members';
  assert.equal((await call('/api/dashboard/start')).status, 200, 'Unrelated grant outage cannot block the identity shell');
  failed = 'weekly'; calls = [];
  assert.equal((await call('/api/dashboard?section=extras')).status, 200);
  assert.equal(calls.some(c => /^(weekly|literature|projects):/.test(c)), false, 'Extra modules never read unrelated business tables');
  failed = '';
  for (const code of [1254290,1254291,1255001]) {
    const fixtureFetch = globalThis.fetch; let attempts = 0;
    globalThis.fetch = async () => Response.json(++attempts === 1 ? { code } : { code:0, data:{} });
    try { await feishuRequest('/synthetic-retry', { readDeadline: Date.now()+2000 }); assert.equal(attempts,2); }
    finally { globalThis.fetch = fixtureFetch; }
  }
  console.log('PASS identity-only bootstrap, independent extra modules and HTTP-200 transient-code retries');

  failed = 'project_members';
  for (const path of ['/api/me', '/api/weekly', '/api/reports/history']) assert.equal((await call(path)).status, 200);
  assert.equal((await (await call('/api/reports/history', 2)).json()).total, 0, 'Never return another student’s report');
  rows[0].fields['统一项目编号'] = 'PRJ-001';
  assert.equal((await call('/api/reports/history')).status, 502, 'Scoped history must fail closed when grants cannot be verified');
  failed = ''; assert.equal((await call('/api/reports/history')).status, 200);
  relations[0].fields['权限到期日'] = '2020-01-01';
  assert.equal((await (await call('/api/reports/history')).json()).total, 0);
  assert.equal((await call('/api/reports', 1, { ...draft, requestId: 'denied-linked-weekly', baseRevision: await weeklyRevision(rows[0]) })).status, 403);
  relations[0].fields['权限到期日'] = '2099-01-01'; delete rows[0].fields['统一项目编号'];
  console.log('PASS personal history survives unrelated grants outage; scoped history and edits still enforce current grants');

  failed = 'literature'; const partialResponse = await call('/api/dashboard');
  const partial = await partialResponse.json(); assert.equal(partialResponse.status, 200);
  assert.equal(partial.literature, null); assert.ok(partial.moduleErrors.literature);
  assert.equal(partial.student.report.status, 'submitted');
  assert.equal(partial.student.home.todos.some(t => t.id === 'literature-target'), false);
  failed = 'members'; const denied = await call('/api/dashboard'); assert.equal(denied.status, 502);
  assert.equal((await denied.json()).binding, 'MEMBERS_TABLE_ID'); failed = '';
  const failure = await call('/api/literature', 1, { requestId: 'independent-literature', title: '论文', contribution: '贡献', noteUrl: 'https://example.com/note' }, { ...env, WEEKLY_TABLE_ID: '' });
  assert.equal(failure.status, 201);
  console.log('PASS optional failure is explicit, required identity fails closed, literature does not require a weekly table');

  failed = 'projects';
  const projectFailureResponse = await call('/api/dashboard');
  const projectFailure = await projectFailureResponse.json();
  assert.equal(projectFailureResponse.status, 200);
  assert.ok(projectFailure.moduleErrors.projects); assert.equal(projectFailure.manager.stats.projects, null);
  assert.equal(projectFailure.moduleDiagnostics.projects.requestId, projectFailureResponse.headers.get('X-Request-ID'));
  assert.deepEqual(Object.keys(projectFailure.moduleDiagnostics.projects).sort(), ['code', 'requestId', 'upstreamCode']);
  assert.equal(projectFailure.moduleDiagnostics.projects.code, 'TABLE_READ_FAILED');
  assert.equal(projectFailure.moduleDiagnostics.projects.upstreamCode, 99991672);
  assert.equal(JSON.stringify(projectFailure).includes('synthetic rejection'), false, 'No raw upstream error in dashboard');
  assert.equal((await call('/api/projects')).status, 502, 'Read failure is not a confirmed empty project list');
  failed = 'weekly'; calls = [];
  const writesBeforeRetry = writes;
  const recoveredResponse = await call('/api/projects');
  const recovered = await recoveredResponse.json(); assert.equal(recoveredResponse.status, 200);
  assert.deepEqual(recovered.projects.map(p => p.code), ['PRJ-001']); assert.equal(recovered.activeCount, 1);
  assert.deepEqual(calls.map(c => c.split(':')[0]).sort(), ['auth_projects', 'members', 'project_members', 'projects']);
  businessProjects[0].fields['状态'] = projects[0].fields['项目阶段'] = '归档';
  const archived = await (await call('/api/projects')).json();
  assert.equal(archived.projects.length, 0); assert.equal(archived.activeCount, 0, 'Archived project without an explicit read exception is hidden');
  businessProjects[0].fields['状态'] = projects[0].fields['项目阶段'] = '执行中';
  relations[0].fields['权限到期日'] = '2020-01-01';
  const withdrawn = await (await call('/api/projects')).json();
  assert.deepEqual(withdrawn.projects, []); assert.equal(withdrawn.activeCount, 0, 'Fresh grant check after withdrawal');
  relations[0].fields['权限到期日'] = '2099-01-01';
  failed = 'project_members'; assert.equal((await call('/api/projects')).status, 502, 'Cannot retry around unavailable authorization');
  failed = ''; assert.equal(writes, writesBeforeRetry, 'Project retries never write records');
  console.log('PASS project diagnostics, independent recovery, authorized active counts and revocation on retry');

  const beforeWrites = writes;
  let memberReads = 0;
  onRead = table => { if (table === 'members' && ++memberReads === 2) people[0].fields['人员状态'] = '离组'; };
  const revoked = await call('/api/reports', 1, { ...draft, requestId: 'revoked-before-write', progress: '不得保存', baseRevision: await weeklyRevision(rows[0]) });
  assert.equal(revoked.status, 403); assert.equal(writes, beforeWrites);
  onRead = null; people[0].fields['人员状态'] = '在组';
  console.log('PASS revocation between coordinator entry and pre-write check prevents mutation');

  const storage = { get: async () => undefined, list: async () => new Map(), transaction: async fn => fn(storage) };
  const coordinator = new LearningRecords({ storage }, env);
  let entered, release;
  const blocked = new Promise(resolve => release = resolve);
  const started = new Promise(resolve => entered = resolve);
  holdMember = () => { entered(); return blocked; };
  const slow = coordinator.fetch(await request('/api/learning', 1)); await started;
  let timer;
  try {
    const fast = await Promise.race([coordinator.fetch(await request('/api/learning', 2)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Learning read queued behind another user')), 1000); })]);
    assert.equal(fast.status, 200);
  } finally { clearTimeout(timer); release(); }
  assert.equal((await slow).status, 200);
  people[1].fields['人员状态'] = '离组';
  assert.equal((await coordinator.fetch(await request('/api/learning', 2))).status, 403);
  console.log('PASS slow learning reader does not block another reader; departure is checked on the next request');

  const before = calls.length;
  await assert.rejects(feishuRequest('/never-request', { readDeadline: Date.now() - 1 }), e => e.status === 504 && e.code === 'READ_TIMEOUT');
  assert.equal(calls.length, before, 'Expired budget must not start another upstream call');
  console.log('PASS expired read budget stops retries without touching storage');
} finally { globalThis.fetch = originalFetch; }
