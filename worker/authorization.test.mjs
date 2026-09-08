import { mockWeeklyCoordinator } from './test-weekly-coordinator.mjs';
import { weeklyRevision } from './src/weekly-history.js';
import { WEEKLY_FIELDS } from './src/weekly-write.js';
import assert from 'node:assert/strict';
import service from './src/runtime.js';
import { authority, canProject, strictBinding, identity } from './src/authorization.js';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { checkBindings } from './check-p0-bindings.mjs';
import { SCHEMAS } from './src/v2/schema.js';

const secret = 'test-only-authority-session-secret-32';
const env = { SESSION_SECRET: secret, FEISHU_APP_ID: 'mock-app', FEISHU_APP_SECRET: 'mock-secret', FRONTEND_URL: 'https://portal.example' };
for (const key of ['MEMBERS', 'AUTH_PROJECTS', 'PROJECT_MEMBERS', 'PROJECTS', 'WEEKLY', 'COURSES', 'TASKS', 'LINKS', 'LITERATURE']) {
  env[key + '_TABLE_ID'] = key.toLowerCase();
  env[key + '_BASE_APP_TOKEN'] = 'base-' + key.toLowerCase();
}
const person = (id, extra = {}) => ({ record_id: 'rec-p' + id, fields: {
  '成员编号': 'P-' + String(id).padStart(3, '0'), '姓名': '模拟人员' + id,
  '飞书成员': [{ id: 'ou_' + id }], '人员状态': '在组', '人员边界': '团队内', '成员类别': '博士', '系统职责': [], '保密等级': '内部', ...extra
} });
const project = (id, extra = {}) => ({ record_id: 'rec-prj' + id, fields: {
  '项目编号': 'PRJ-' + String(id).padStart(3, '0'), '项目阶段': '执行中', '保密等级': '内部', ...extra
} });
const relation = (pid, prj, extra = {}) => ({ record_id: 'rec-rel' + pid + '-' + prj, fields: {
  '关联人员': { link_record_ids: ['rec-p' + pid] }, '关联项目': { link_record_ids: ['rec-prj' + prj] },
  '权限级别': '编辑', '授权状态': '有效', '工作台授权确认': '已确认', '权限落实状态': '已落实', '成员边界': '团队内',
  '加入日期': '2020-01-01', '权限到期日': '2099-01-01', '审批人': [{ id: 'ou_9' }], ...extra
} });
let people, projects, relations, rows, writes, failRead, recordResponses, weeklyColumns;
function reset() {
  env.WEEKLY_WRITES = mockWeeklyCoordinator(env);
  people = [person(1), person(2), person(9, { '系统职责': ['管理员'] }), person(8, { '系统职责': ['管理员'] })];
  projects = [project(1), project(2), project(3, { '项目阶段': '暂停' })];
  relations = [relation(1, 1), relation(2, 2, { '权限级别': '只读' }), relation(9, 1, { '权限级别': '管理', '审批人': [{ id: 'ou_8' }] })];
  rows = {
    projects: [1, 2, 3].map(i => ({ record_id: 'business' + i, fields: { '项目编号': 'P0' + i, '统一项目编号': 'PRJ-00' + i, '项目名称': '业务项目' + i } })),
    weekly: [], courses: [], tasks: [], links: [], literature: []
  }; writes = []; failRead = false; recordResponses = {}; weeklyColumns = Object.entries(WEEKLY_FIELDS).map(([field_name, types]) => ({ field_name, type: field_name === '证据链接' ? 15 : types[0] }));
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  assert.equal(url.hostname, 'open.feishu.cn', 'Tests must never call another host');
  if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'mock-token' });
  if (url.pathname.endsWith('/tables/weekly/fields')) return Response.json({ code: 0, data: { items: weeklyColumns, has_more: false } });
  if (url.pathname === '/open-apis/bitable/v1/apps/base-weekly') return Response.json({ code: 0, data: { app: { name: '测试旧后台', url: 'https://test.feishu.cn/base/base-weekly' } } });
  if (url.pathname === '/open-apis/bitable/v1/apps/base-weekly/tables') return Response.json({ code: 0, data: { items: [{ table_id: 'weekly', name: '周报旧表' }], has_more: false } });
  const m = url.pathname.match(/\/apps\/([^/]+)\/tables\/([^/]+)\/records(?:\/([^/]+))?$/);
  assert.ok(m, 'Unexpected API: ' + url.pathname);
  const [, base, table, recordId] = m;
  assert.equal(base, 'base-' + table, 'Each table must use its own Base');
  if (options.method === 'GET') {
    assert.equal(url.searchParams.get('user_id_type'), 'open_id');
    if (failRead && table === 'members') return Response.json({ code: 999, msg: 'mock-read-failure' });
    if (Object.hasOwn(recordResponses, table)) return Response.json({ code: 0, data: recordResponses[table] });
    return Response.json({ code: 0, data: { items: ({ members: people, auth_projects: projects, project_members: relations })[table] || rows[table] || [], has_more: false } });
  }
  assert.ok(['POST', 'PUT'].includes(options.method));
  const fields = JSON.parse(options.body).fields;
  writes.push({ table, recordId, fields });
  if (table === 'weekly') {
    if (recordId) Object.assign(rows.weekly.find(r => r.record_id === recordId).fields, fields);
    else rows.weekly.push({ record_id: 'created', fields });
  }
  return Response.json({ code: 0, data: { record: { record_id: recordId || 'created', fields } } });
};
async function token(id, extra = {}) {
  const payload = Buffer.from(JSON.stringify({ purpose: 'session', sub: 'ou_' + id, roles: ['manager', 'teacher'], exp: Math.floor(Date.now() / 1000) + 3600, ...extra })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return payload + '.' + signature;
}
async function call(id, path, method = 'GET', body, config = env) {
  if (path === '/api/reports' && body && !Object.hasOwn(body, 'baseRevision'))
    body = { ...body, baseRevision: await weeklyRevision(rows.weekly.find(r => r.fields['飞书OpenID'] === 'ou_' + id)) };
  return service.fetch(new Request('https://api.example' + path, { method, headers: {
    Authorization: 'Bearer ' + await token(id), 'Content-Type': 'application/json'
  }, ...(body ? { body: JSON.stringify(body) } : {}) }), config);
}
let count = 0;
async function test(name, fn) { reset(); await fn(); count++; console.log('PASS authorization:', name); }
try {
  await test('weekly source locator is restricted to current managers', async () => {
    assert.equal((await call(1, '/api/admin/weekly-source')).status, 403);
    const response = await call(9, '/api/admin/weekly-source');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.tableName, '周报旧表');
    assert.equal(data.tableUrl, 'https://test.feishu.cn/base/base-weekly?table=weekly');
    assert.equal(data.recordsRead, false); assert.equal(writes.length, 0);
    const direct = await (await call(9, '/api/admin/weekly-source?docsOrigin=https%3A%2F%2Flab.feishu.cn')).json();
    assert.equal(direct.tableUrl, 'https://lab.feishu.cn/base/base-weekly?table=weekly');
    const unsafe = await (await call(9, '/api/admin/weekly-source?docsOrigin=https%3A%2F%2Fevil.example')).json();
    assert.equal(unsafe.tableUrl, '');
    assert.equal(JSON.stringify(data).includes('mock-secret'), false);
    people.find(p => p.record_id === 'rec-p9').fields['系统职责'] = [];
    assert.equal((await call(9, '/api/admin/weekly-source')).status, 403);
  });
  await test('weekly report accepts webpage URL and encodes Feishu hyperlink', async () => {
    const r = await call(1, '/api/reports', 'POST', { progress: '完成实验', nextPlan: '继续验证', evidence: ' https://example.com/result?q=1 ' });
    assert.equal(r.status, 200);
    assert.deepEqual(writes[0].fields['证据链接'], { text: 'https://example.com/result?q=1', link: 'https://example.com/result?q=1' });
    assert.equal(writes[0].fields['飞书OpenID'], 'ou_1');
    assert.equal(writes[0].fields['姓名'], '模拟人员1');
    assert.equal('关联项目' in writes[0].fields, false);
  });
  await test('weekly empty evidence submits as null hyperlink', async () => {
    const r = await call(1, '/api/reports', 'POST', { progress: '完成', nextPlan: '计划', evidence: '' });
    assert.equal(r.status, 200); assert.equal(writes[0].fields['证据链接'], null);
  });
  await test('old URL-only column blocks free text without blaming user or dropping content', async () => {
    const r = await call(1, '/api/reports', 'POST', { progress: '完成', nextPlan: '计划', evidence: 'javascript:alert(1)' });
    assert.equal(r.status, 503); assert.equal((await r.json()).code, 'WEEKLY_EVIDENCE_COLUMN_TYPE'); assert.equal(writes.length, 0);
  });
  await test('five-field text report persists, reads back and resubmits the same row', async () => {
    weeklyColumns = weeklyColumns.map(f => f.field_name === '证据链接' ? { field_name: '产出（若有阶段性成果，可以提交文档链接）', type: 1 } : f.field_name === '问题与阻塞' ? { field_name: '当前问题与阻塞', type: 1 } : f);
    const body = { progress: '本周完成', learning: '方法说明', evidence: '代码 https://example.com/code\n飞书文档 https://test.feishu.cn/docx/test', blockers: '需要协助', nextPlan: '下周验证' };
    const result = await call(1, '/api/reports', 'POST', body);
    assert.equal(result.status, 200);
    const saved = await result.json(); assert.equal(saved.readBackVerified, true);
    assert.deepEqual(saved.report.values, body);
    assert.equal(writes[0].fields['产出（若有阶段性成果，可以提交文档链接）'], body.evidence);
    assert.equal(Object.hasOwn(writes[0].fields, '证据链接'), false);
    const updated = await call(1, '/api/reports', 'POST', { ...body, progress: '更新结果' });
    assert.equal(updated.status, 200); assert.equal(rows.weekly.length, 1);
    const page = await (await call(1, '/api/weekly')).json();
    assert.equal(page.student.history[0].values.progress, '更新结果');
    const teacher = await (await call(9, '/api/weekly')).json();
    assert.equal(teacher.teacher.students.find(p => p.id === 'ou_1').currentReport.values.evidence, body.evidence);
    assert.equal((await (await call(2, '/api/weekly')).json()).student.history.length, 0);
  });
  await test('empty Feishu project links preserve personal weekly history, teacher visibility and edits', async () => {
    people.push(person(31));
    const body = { progress: '个人周报', nextPlan: '继续验证' };
    assert.equal((await call(31, '/api/reports', 'POST', body)).status, 200);
    // Exact empty DuplexLink response observed through Feishu's API explorer.
    const liveEmptyLink = [{ table_id: 'tblU8hJpQTFMwDWJ', text_arr: [], type: 'text' }];
    for (const empty of [[], null, '', '  ', { link_record_ids: [] }, { record_ids: [] }, liveEmptyLink]) {
      rows.weekly[0].fields['关联项目'] = empty;
      const own = await (await call(31, '/api/weekly')).json();
      assert.equal(own.student.history.length, 1, 'Empty project link must not hide a saved personal report');
      assert.equal(own.student.report.status, 'submitted');
      const teacher = await (await call(9, '/api/weekly')).json();
      assert.equal(teacher.teacher.students.find(p => p.id === 'ou_31').status, '已提交');
      assert.equal((await (await call(2, '/api/weekly')).json()).student.history.length, 0);
      assert.equal((await call(31, '/api/reports', 'POST', { ...body, progress: '修改个人周报' })).status, 200);
      assert.equal(rows.weekly.length, 1);
      assert.equal((await (await call(31, '/api/dashboard')).json()).student.history.length, 1);
    }
  });
  await test('nonempty or malformed project links still require explicit project authorization', async () => {
    people.push(person(31));
    const body = { progress: '个人周报', nextPlan: '计划' };
    assert.equal((await call(31, '/api/reports', 'POST', body)).status, 200);
    for (const linked of [[{ record_id: 'rec-private' }], { link_record_ids: ['rec-private'] }, { unexpected: 'private' }, {},
      [{ table_id: 'tblProject', text_arr: ['private project'], type: 'text' }],
      [{ table_id: 'tblProject', text_arr: [], type: 'text', record_ids: ['rec-private'] }],
      [{ table_id: 'tblProject', text_arr: [], type: 'unknown' }],
      [{ table_id: 'tblProject', text_arr: null, type: 'text' }],
      [{ table_id: 'tblProject', text_arr: [], type: 'text' }, { record_id: 'rec-private' }]]) {
      rows.weekly[0].fields['关联项目'] = linked;
      assert.equal((await (await call(31, '/api/weekly')).json()).student.history.length, 0);
      assert.equal((await call(31, '/api/reports', 'POST', body)).status, 403);
    }
  });
  await test('dashboard isolates broken literature and never bypasses personnel checks', async () => {
    recordResponses.literature = { items: null, total: 1, has_more: false };
    const partial = await call(1, '/api/dashboard'); assert.equal(partial.status, 200);
    const result = await partial.json(); assert.ok(result.moduleErrors.literature);
    assert.equal(result.literature, null); assert.equal(result.student.report.status, 'pending');
    assert.equal(result.student.home.todos.some(t => t.id === 'literature-target'), false);
    const weekly = await call(1, '/api/weekly'); assert.equal(weekly.status, 200);
    const data = await weekly.json(); assert.equal(data.weeklyOnly, true); assert.equal('literature' in data, false);
    people[0].fields['人员状态'] = '离组'; assert.equal((await call(1, '/api/weekly')).status, 403);
  });
  await test('missing weekly binding cannot masquerade as an empty history', async () => {
    const response = await call(1, '/api/weekly', 'GET', null, { ...env, WEEKLY_TABLE_ID: '' });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'WEEKLY_BINDING_MISSING');
  });
  await test('write without confirmed read-back is not reported as success', async () => {
    recordResponses.weekly = { items: [], has_more: false };
    const response = await call(1, '/api/reports', 'POST', { progress: 'saved', nextPlan: 'next' });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'WEEKLY_READBACK_FAILED');
    assert.equal(writes.length, 1);
  });
  await test('duplicate weekly records block overwrite', async () => {
    const week = (await (await call(1, '/api/weekly')).json()).week.id;
    rows.weekly = ['a', 'b'].map(record_id => ({ record_id, fields: { 飞书OpenID: 'ou_1', 周次: week } }));
    assert.equal((await call(1, '/api/reports', 'POST', { progress: 'test', nextPlan: 'test' })).status, 409);
    assert.equal(writes.length, 0);
  });
  await test('signed old manager role is replaced by current master duties', async () => {
    const r = await call(1, '/api/me'); assert.equal(r.status, 200); const data = await r.json();
    assert.deepEqual(data.profile.roles, ['student']); assert.equal(data.profile.personId, 'P-001');
    assert.equal(JSON.stringify(data).includes('memberRecord'), false);
  });
  for (const status of ['离组', '已归档', '', undefined]) await test('old session denied for personnel status ' + status, async () => {
    people[0].fields['人员状态'] = status;
    for (const path of ['/api/me', '/api/dashboard', '/api/literature', '/api/projects']) assert.equal((await call(1, path)).status, 403);
  });
  await test('new valid member is recognized without old roster provisioning', async () => {
    people.push(person(3)); assert.equal((await call(3, '/api/me')).status, 200);
    assert.deepEqual((await (await call(3, '/api/projects')).json()).projects, []);
  });
  await test('duplicate account denied', async () => { people.push(person(4, { '飞书成员': [{ id: 'ou_1' }] })); assert.equal((await call(1, '/api/me')).status, 403); });
  await test('malformed duplicate identity cannot be ignored', async () => { people.push(person(4, { '飞书成员': [{ id: 'ou_1' }, { id: 'ou_4' }] })); assert.equal((await call(1, '/api/me')).status, 403); });
  await test('duplicate fixed personnel ID denied', async () => { people.push(person(4, { '成员编号': 'P-001' })); assert.equal((await call(1, '/api/me')).status, 403); });
  await test('conflicting personnel ID aliases denied', async () => { people[0].fields['人员编号'] = 'P-099'; assert.equal((await call(1, '/api/me')).status, 403); });
  await test('display name and user_id are never OAuth identities', async () => { people[0].fields['飞书成员'] = [{ id: 'user069701', name: 'ou_1' }]; assert.equal((await call(1, '/api/me')).status, 403); });
  await test('explicit openId conflicting with Feishu member denied', async () => { people[0].fields['飞书OpenID'] = 'ou_other'; assert.equal(identity(people[0]), ''); });
  await test('missing explicit master binding cannot use global fallback', async () => { assert.throws(() => strictBinding({ MEMBERS_TABLE_ID: 'm', FEISHU_BASE_APP_TOKEN: 'old' }, 'MEMBERS_TABLE_ID')); assert.equal((await call(1, '/api/me', 'GET', null, { ...env, MEMBERS_BASE_APP_TOKEN: '', FEISHU_BASE_APP_TOKEN: 'old' })).status, 503); });
  await test('master read failure denies API', async () => { failRead = true; assert.equal((await call(1, '/api/me')).status, 502); });
  await test('project list and dashboard exclude unrelated project', async () => {
    const list = await (await call(1, '/api/projects')).json(); assert.deepEqual(list.projects.map(p => p.code), ['PRJ-001']);
    const dashboard = await (await call(1, '/api/dashboard')).json(); assert.deepEqual(dashboard.student.projects.map(p => p.code), ['PRJ-001']); assert.deepEqual(dashboard.manager.stats, {});
  });
  await test('direct cross-project GET and PATCH denied', async () => { assert.equal((await call(1, '/api/projects/PRJ-002')).status, 403); assert.equal((await call(1, '/api/projects/PRJ-002', 'PATCH', { milestone: 'attack' })).status, 403); assert.equal(writes.length, 0); });
  await test('read-only reads but cannot edit', async () => { assert.equal((await call(2, '/api/projects/PRJ-002')).status, 200); assert.equal((await call(2, '/api/projects/PRJ-002', 'PATCH', { milestone: 'x' })).status, 403); });
  await test('editor edits content but cannot manage project title', async () => { assert.equal((await call(1, '/api/projects/PRJ-001', 'PATCH', { milestone: 'verified' })).status, 200); assert.equal((await call(1, '/api/projects/PRJ-001', 'PATCH', { title: 'rename' })).status, 403); assert.equal(writes[0].recordId, 'business1'); });
  await test('project management includes editing but has no cross-project bypass', async () => { assert.equal((await call(9, '/api/projects/PRJ-001', 'PATCH', { title: '管理修改', blocker: '' })).status, 200); assert.equal((await call(9, '/api/projects/PRJ-002')).status, 403); });
  await test('unknown and authorization fields cannot be patched', async () => { assert.equal((await call(1, '/api/projects/PRJ-001', 'PATCH', { '权限级别': '管理' })).status, 400); assert.equal(writes.length, 0); });
  for (const [field, value] of [['工作台授权确认', ''], ['工作台授权确认', '待确认'], ['权限落实状态', '待撤回'], ['授权状态', '待审批'], ['授权状态', '已撤销'], ['权限到期日', '2020-01-01'], ['加入日期', '2099-01-01'], ['加入日期', ''], ['权限到期日', ''], ['审批人', []], ['成员边界', '团队外']]) {
    await test('invalid relation denies: ' + field + '=' + String(value), async () => { relations[0].fields[field] = value; assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403); });
  }
  await test('deleted relation revokes existing session', async () => { assert.equal((await call(1, '/api/projects/PRJ-001')).status, 200); relations = relations.filter(r => r !== relations[0]); assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403); });
  await test('duplicate relationship is not a privilege union', async () => { relations.push(relation(1, 1, { '权限级别': '管理' })); assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403); });
  await test('duplicate authority PRJ denied', async () => { projects.push({ ...project(1), record_id: 'another' }); assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403); });
  await test('duplicate business PRJ mapping hidden and direct access rejected', async () => { rows.projects.push({ ...rows.projects[0], record_id: 'duplicate' }); assert.deepEqual((await (await call(1, '/api/projects')).json()).projects, []); assert.equal((await call(1, '/api/projects/PRJ-001')).status, 409); });
  await test('legacy P01 never matched without unified mapping', async () => { delete rows.projects[0].fields['统一项目编号']; assert.equal((await call(1, '/api/projects/PRJ-001')).status, 409); });
  await test('conflicting PRJ aliases cannot grant access', async () => { rows.projects[0].fields.ProjectID = 'PRJ-002'; assert.equal((await call(1, '/api/projects/PRJ-001')).status, 409); });
  await test('paused project downgrades to read', async () => { projects[0].fields['项目阶段'] = '暂停'; assert.equal((await call(1, '/api/projects/PRJ-001')).status, 200); assert.equal((await call(1, '/api/projects/PRJ-001', 'PATCH', { milestone: 'x' })).status, 403); });
  await test('conflicting project status denies', async () => { projects[0].fields['状态'] = '已归档'; assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403); });
  await test('external member cannot inherit global administrator duty', async () => { people[0].fields['人员边界'] = '团队外'; people[0].fields['系统职责'] = ['管理员', '课程审核']; const r = await (await call(1, '/api/me')).json(); assert.deepEqual(r.profile.roles, ['student']); });
  await test('same-day Feishu numeric expiry includes Shanghai day', async () => {
    const midnight = Math.floor((Date.now() + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
    relations[0].fields['权限到期日'] = midnight;
    assert.equal(canProject(authority(people, projects, relations, 'ou_1'), 'PRJ-001'), true);
  });
  await test('role removal takes effect on old session', async () => {
    assert.ok((await (await call(9, '/api/me')).json()).profile.roles.includes('manager'));
    people[2].fields['系统职责'] = []; assert.deepEqual((await (await call(9, '/api/me')).json()).profile.roles, ['student']);
  });
  await test('anonymous and tampered signatures rejected', async () => {
    assert.equal((await service.fetch(new Request('https://api.example/api/projects'), env)).status, 401);
    assert.equal((await service.fetch(new Request('https://api.example/api/me', { headers: { Authorization: 'Bearer tampered.signature' } }), env)).status, 401);
  });
  await test('inactive identity denied on every existing write route', async () => {
    people[0].fields['人员状态'] = '离组';
    for (const path of ['/api/reports', '/api/literature', '/api/onboarding', '/api/courses/submit', '/api/courses/confirm', '/api/teacher/review']) assert.equal((await call(1, path, 'POST', {})).status, 403);
    assert.equal(writes.length, 0);
  });
  await test('preflight without credentials performs no network calls', async () => {
    const result = await checkBindings({}, () => { throw new Error('Must not call network'); });
    assert.equal(result.ready, false); assert.equal(result.blocked, 'APP_CREDENTIALS_NOT_AVAILABLE');
  });
  for (const confirmed of [true, false]) await test('preflight separates binding from authorization readiness: ' + confirmed, async () => {
    if (!confirmed) for (const r of relations) r.fields['工作台授权确认'] = '待确认';
    let requests = 0;
    const result = await checkBindings(env, async (input, options) => {
      const url = new URL(input); requests++;
      if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'mock' });
      assert.equal(options.method, 'GET');
      const match = url.pathname.match(/\/apps\/([^/]+)\/tables\/([^/]+)\/(fields|records)$/); assert.ok(match);
      const [, base, table, type] = match; assert.equal(base, 'base-' + table);
      const schema = { members: 'members', auth_projects: 'authorityProjects', project_members: 'projectMembers' }[table];
      const items = type === 'fields' ? (schema ? SCHEMAS[schema].required : ['统一项目编号', '项目名称', '当前里程碑', '最近阻塞']).map(field_name => ({ field_name })) : ({ members: people, auth_projects: projects, project_members: relations, projects: rows.projects })[table];
      return Response.json({ code: 0, data: { items, has_more: false } });
    });
    assert.equal(result.ready, true); assert.equal(result.writesPerformed, false); assert.equal(requests, 9);
    assert.equal(result.bindingReady, true);
    assert.equal(result.authorizationReady, confirmed);
    assert.equal(result.grantedProjectRelationships, confirmed ? 3 : 0);
    assert.equal(result.productionReady, false);
    assert.equal(result.accessByPerson.length, 4);
    assert.equal(JSON.stringify(result.accessByPerson).includes('ou_'), false);
  });
  let matrixIdentity = 100;
  for (const personLevel of ['普通', '受限', '内部', '', '未知']) {
    for (const projectLevel of ['公开', '内部', '机密', '绝密', '', '未知']) {
      await test(`confidentiality ${personLevel}/${projectLevel}`, async () => {
        const login = matrixIdentity++;
        people[0].fields['飞书成员'] = [{ id: 'ou_' + login }];
        people[0].fields['保密等级'] = personLevel;
        projects[0].fields['保密等级'] = projectLevel;
        const allowed = ({ '普通': ['公开'], '受限': ['公开', '内部'], '内部': ['公开', '内部', '机密', '绝密'] })[personLevel]?.includes(projectLevel) || false;
        assert.equal((await call(login, '/api/projects/PRJ-001')).status, allowed ? 200 : 403);
        assert.equal((await call(login, '/api/projects/PRJ-001', 'PATCH', { milestone: 'x' })).status, allowed ? 200 : 403);
        if (!allowed) assert.equal(writes.length, 0);
      });
    }
  }
  await test('native ACL pending is independent of explicitly confirmed portal authorization', async () => {
    relations[0].fields['权限落实状态'] = '待核验';
    assert.equal((await call(1, '/api/projects/PRJ-001')).status, 200);
    delete relations[0].fields['工作台授权确认'];
    assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403);
  });
  for (const mutation of ['student', 'left', 'external', 'duplicate', 'multiple']) await test('invalid approver ' + mutation, async () => {
    if (mutation === 'student') people[2].fields['系统职责'] = [];
    if (mutation === 'left') people[2].fields['人员状态'] = '离组';
    if (mutation === 'external') people[2].fields['人员边界'] = '团队外';
    if (mutation === 'duplicate') people.push(person(7, { '飞书成员': [{ id: 'ou_9' }] }));
    if (mutation === 'multiple') relations[0].fields['审批人'].push({ id: 'ou_8' });
    assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403);
  });
  await test('administrator may confirm own relationship but confirmation is still required', async () => {
    people[0].fields['系统职责'] = ['管理员'];
    relations[0].fields['审批人'] = [{ id: 'ou_1' }];
    assert.equal((await call(1, '/api/projects/PRJ-001')).status, 200);
    relations[0].fields['工作台授权确认'] = '待确认';
    assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403);
  });
  await test('ordinary member cannot confirm own relationship', async () => {
    relations[0].fields['审批人'] = [{ id: 'ou_1' }];
    assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403);
  });
  await test('clearance downgrade revokes old session', async () => {
    assert.equal((await call(1, '/api/projects/PRJ-001')).status, 200);
    people[0].fields['保密等级'] = '普通';
    assert.equal((await call(1, '/api/projects/PRJ-001')).status, 403);
  });
  for (const items of [undefined, null]) await test('explicit empty business table does not break dashboard: ' + items, async () => {
    recordResponses.literature = { total: 0, has_more: false, ...(items === null ? {items:null} : {}) };
    const response = await call(1, '/api/dashboard');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.literature.items, []);
    assert.deepEqual(data.student.projects.map(p => p.code), ['PRJ-001']);
  });
  for (const data of [{}, {total:0}, {total:1,has_more:false}, {total:0,has_more:true}, {total:0,has_more:false,items:{}}, {total:0,has_more:false,page_token:'next'}]) await test('malformed empty page remains blocked: ' + JSON.stringify(data), async () => {
    recordResponses.literature = data;
    const dashboard = await call(1, '/api/dashboard');
    assert.equal(dashboard.status, 200);
    const partial = await dashboard.json();
    assert.equal(partial.literature, null);
    assert.ok(partial.moduleErrors.literature, 'Malformed data must remain unavailable, not become empty records');
    assert.equal((await call(1, '/api/literature')).status, 502, 'Direct module read still reports failure');
  });
  await test('empty authority table cannot grant access', async () => {
    recordResponses.members = {total:0,has_more:false};
    assert.equal((await call(1, '/api/projects')).status, 403);
    assert.equal(writes.length, 0);
  });
  const storage = new Map();
  const fakeStorage = { get length() { return storage.size; }, key(i) { return [...storage.keys()][i]; }, getItem(k) { return storage.get(k) ?? null; }, setItem(k,v) { storage.set(k,v); }, removeItem(k) { storage.delete(k); } };
  const context = vm.createContext({}); vm.runInContext(readFileSync(new URL('../draft-store.js', import.meta.url), 'utf8'), context);
  const drafts = context.ER2DraftStore.create(fakeStorage);
  await test('draft migration removes unknown owners and preserves unrelated storage', () => { storage.set('er2-draft-report', 'old'); storage.set('other-app', 'keep'); drafts.bind('A'); assert.equal(storage.has('er2-draft-report'), false); assert.equal(storage.get('other-app'), 'keep'); });
  await test('same-account draft survives reload', () => { drafts.bind('A'); drafts.set('report', '2026-W37', 'A secret'); const reload = context.ER2DraftStore.create(fakeStorage); reload.bind('A'); assert.equal(reload.get('report', '2026-W37'), 'A secret'); });
  await test('drafts isolated by account, week and lesson', () => { drafts.bind('A'); drafts.set('course-01', '2026-W37', 'A'); assert.equal(drafts.get('course-02', '2026-W37'), null); assert.equal(drafts.get('course-01', '2026-W38'), null); drafts.bind('B'); assert.equal(drafts.get('course-01', '2026-W37'), null); });
  await test('logout removes all scoped drafts and request ids', () => { drafts.bind('A'); drafts.set('request', 'week', 'x'); drafts.clear(); assert.equal([...storage.keys()].some(k => k.startsWith('er2-private:')), false); });
  console.log(`Authorization and draft tests passed: ${count}; all identities and Feishu writes were simulated.`);
} finally { globalThis.fetch = realFetch; }
