import assert from 'node:assert/strict';
import { canonicalProjectData, projectDisplayProjection } from './src/project-master.js';
import { authority, canProject } from './src/authorization.js';

const people = [
  { record_id: 'person1', fields: { '人员编号': 'P-001', '姓名': '管理员', '飞书成员': [{ id: 'ou_admin' }], '人员状态': '在组', '人员边界': '团队内', '成员类别': 'PI', '系统职责': ['管理员'], '保密等级': '内部' } },
  { record_id: 'person2', fields: { '人员编号': 'P-002', '姓名': '成员', '飞书成员': [{ id: 'ou_member' }], '人员状态': '在组', '人员边界': '团队内', '成员类别': '博士', '系统职责': [], '保密等级': '内部' } }
];
const master = [{ record_id: 'master1', fields: { '项目编号': 'P03', '统一项目编号': 'PRJ-001', '项目名称': '正式项目', '项目阶段': '执行中', '保密等级': '内部', '项目负责人': [{ id: 'ou_admin' }], '成员': [{ id: 'ou_admin' }] } }];
const mirrors = [{ record_id: 'mirror1', fields: { '项目编号': 'PRJ-001', '项目名称': '过时名称', '项目阶段': '执行中', '保密等级': '内部' } }];
const relations = [{ record_id: 'relation1', fields: { '关联人员': ['person2'], '关联项目': ['mirror1'], '项目角色': '负责人', '权限级别': '只读', '授权状态': '有效', '工作台授权确认': '已确认', '权限落实状态': '已落实', '成员边界': '团队内', '加入日期': '2020-01-01', '权限到期日': '2099-01-01', '审批人': [{ id: 'ou_admin' }] } }];
const compile = (m = master, a = mirrors, r = relations) => canonicalProjectData(m, a, r);
const access = (c, sub = 'ou_member') => authority(people, c.projects, c.relations, sub);
const change = (records, fields) => records.map(r => ({ ...r, fields: { ...r.fields, ...fields } }));

const flowMaster=structuredClone(master);delete flowMaster[0].fields['项目阶段'];flowMaster[0].fields['项目阶段（自动读取）']=[{text:'执行中',type:'text'}];
assert.equal(compile(flowMaster).projects[0].definitionBlocked,false,'formula projects the existing flow status without another editable status');
let c = compile();
assert.equal(c.projects[0].fields['项目名称'], '正式项目');
assert.equal(c.relations[0].fields['关联项目'].link_record_ids[0], 'master1');
assert.equal(canProject(access(c), 'PRJ-001'), true);
assert.equal(canProject(access(c), 'PRJ-001', 'edit'), false);
assert.equal(c.issues.some(i => i.code === 'MIRROR_TITLE_DRIFT'), true);

// A legacy display owner cannot grant access, and a global admin is not
// automatically projected into the project's business participants.
let display = projectDisplayProjection(people, c.projects, c.relations);
assert.deepEqual(display[0].fields, { '项目负责人': [{ id: 'ou_member' }], '成员': [{ id: 'ou_member' }] });
assert.equal(display[0].ownerLabel, '成员');
assert.equal(projectDisplayProjection(people, c.projects, [])[0].ownerLabel, '待指定');
assert.deepEqual(projectDisplayProjection(people, c.projects, [])[0].fields['成员'], []);

// New canonical projects are visible to admins even before a mirror/relationship
// is created. Old orphan mirrors never make a project visible to anybody.
c = compile(master, [], []);
assert.equal(canProject(access(c, 'ou_admin'), 'PRJ-001'), true);
assert.equal(canProject(access(c), 'PRJ-001'), false);
c = compile([], mirrors, relations);
assert.equal(canProject(access(c, 'ou_admin'), 'PRJ-001'), false);
assert.equal(c.issues[0].code, 'ORPHAN_MIRROR');

for (const [m, a] of [
  [change(master, { '项目阶段': '暂停' }), mirrors],
  [master, change(mirrors, { '保密等级': '公开' })],
  [[...master, { ...master[0], record_id: 'duplicate' }], mirrors],
  [master, [...mirrors, { ...mirrors[0], record_id: 'duplicate' }]],
  [change(master, { '统一项目编号': '' }), mirrors],
  [change(master, { 'ProjectID': 'PRJ-999' }), mirrors],
  [change(master, { 'ProjectID': 'P01' }), mirrors],
  [change(master, { '项目状态': '暂停' }), mirrors],
  [change(master, { '保密等级': '' }), mirrors],
  [change(master, { '是否启用': false }), mirrors]
]) {
  c = compile(m, a);
  for (const sub of ['ou_member', 'ou_admin']) assert.equal(canProject(access(c, sub), 'PRJ-001'), false, JSON.stringify([m, a]));
}
c = compile(change(master, { '项目阶段': '暂停' }), change(mirrors, { '项目阶段': '暂停' }), change(relations, { '权限级别': '编辑' }));
assert.equal(canProject(access(c), 'PRJ-001'), true);
assert.equal(canProject(access(c), 'PRJ-001', 'edit'), false);
c = compile(master, mirrors, change(relations, { '关联项目': ['mirror1', 'unrelated'] }));
assert.equal(canProject(access(c), 'PRJ-001'), false);
c = compile(master, mirrors, [...relations, { ...relations[0], record_id: 'malformed-extra', fields: { ...relations[0].fields, '关联项目': ['mirror1', 'unrelated'] } }]);
assert.equal(canProject(access(c), 'PRJ-001'), false, 'A malformed extra relation must not be erased while translating legacy links');
for (const fields of [{ '权限落实状态': '待核验' }, { '授权状态': '已撤销' }, { '权限到期日': '2020-01-01' }]) {
  c = compile(master, mirrors, change(relations, fields));
  assert.deepEqual(projectDisplayProjection(people, c.projects, c.relations)[0].fields['成员'], []);
}
console.log('PASS canonical master: unique 90.2 definitions, legacy link translation, fail-closed drift, admin new projects, business-only derived ownership and membership');
