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
  '飞书成员': [{ id: 'ou_' + id }], '人员状态': '在组', '人员边界': '团队内', '成员类别': '博士', '系统职责': [], ...extra
} });
const project = (id, extra = {}) => ({ record_id: 'rec-prj' + id, fields: {
  '项目编号': 'PRJ-' + String(id).padStart(3, '0'), '项目阶段': '执行中', ...extra
} });
const relation = (pid, prj, extra = {}) => ({ record_id: 'rec-rel' + pid + '-' + prj, fields: {
  '关联人员': { link_record_ids: ['rec-p' + pid] }, '关联项目': { link_record_ids: ['rec-prj' + prj] },
  '权限级别': '编辑', '授权状态': '有效', '权限落实状态': '已落实', '成员边界': '团队内',
  '加入日期': '2020-01-01', '权限到期日': '2099-01-01', '审批人': [{ id: 'ou_9' }], ...extra
} });
let people, projects, relations, rows, writes, failRead;
function reset() {
  people = [person(1), person(2), person(9, { '系统职责': ['管理员'] })];
  projects = [project(1), project(2), project(3, { '项目阶段': '暂停' })];
  relations = [relation(1, 1), relation(2, 2, { '权限级别': '只读' }), relation(9, 1, { '权限级别': '管理' })];
  rows = {
    projects: [1, 2, 3].map(i => ({ record_id: 'business' + i, fields: { '项目编号': 'P0' + i, '统一项目编号': 'PRJ-00' + i, '项目名称': '业务项目' + i } })),
    weekly: [], courses: [], tasks: [], links: [], literature: []
  }; writes = []; failRead = false;
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  assert.equal(url.hostname, 'open.feishu.cn', 'Tests must never call another host');
  if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'mock-token' });
  const m = url.pathname.match(/\/apps\/([^/]+)\/tables\/([^/]+)\/records(?:\/([^/]+))?$/);
  assert.ok(m, 'Unexpected API: ' + url.pathname);
  const [, base, table, recordId] = m;
  assert.equal(base, 'base-' + table, 'Each table must use its own Base');
  if (options.method === 'GET') {
    assert.equal(url.searchParams.get('user_id_type'), 'open_id');
    if (failRead && table === 'members') return Response.json({ code: 999, msg: 'mock-read-failure' });
    return Response.json({ code: 0, data: { items: ({ members: people, auth_projects: projects, project_members: relations })[table] || rows[table] || [], has_more: false } });
  }
  assert.ok(['POST', 'PUT'].includes(options.method));
  const fields = JSON.parse(options.body).fields;
  writes.push({ table, recordId, fields });
  return Response.json({ code: 0, data: { record: { record_id: recordId || 'created', fields } } });
};
async function token(id, extra = {}) {
  const payload = Buffer.from(JSON.stringify({ purpose: 'session', sub: 'ou_' + id, roles: ['manager', 'teacher'], exp: Math.floor(Date.now() / 1000) + 3600, ...extra })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return payload + '.' + signature;
}
async function call(id, path, method = 'GET', body, config = env) {
  return service.fetch(new Request('https://api.example' + path, { method, headers: {
    Authorization: 'Bearer ' + await token(id), 'Content-Type': 'application/json'
  }, ...(body ? { body: JSON.stringify(body) } : {}) }), config);
}
let count = 0;
async function test(name, fn) { reset(); await fn(); count++; console.log('PASS authorization:', name); }
try {
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
  for (const [field, value] of [['权限落实状态', '待核验'], ['权限落实状态', '待撤回'], ['授权状态', '待审批'], ['授权状态', '已撤销'], ['权限到期日', '2020-01-01'], ['加入日期', '2099-01-01'], ['加入日期', ''], ['权限到期日', ''], ['审批人', []], ['成员边界', '团队外']]) {
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
  await test('preflight validates per-Base schemas and mappings without writes', async () => {
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
