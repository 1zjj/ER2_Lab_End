// Authoritative ER2 authorization. No legacy role, name or project-code fallback.
export const AUTH_BINDINGS = ['MEMBERS_TABLE_ID', 'PROJECTS_TABLE_ID', 'AUTH_PROJECTS_TABLE_ID', 'PROJECT_MEMBERS_TABLE_ID'];
export const text = value => Array.isArray(value) ? value.map(text).join('') : String(value && typeof value === 'object' ? value.text ?? value.name ?? value.value ?? '' : value ?? '').trim();
const values = value => (Array.isArray(value) ? value : value ? [value] : []).map(text).filter(Boolean);
export const FEATURE_GRANTS = Object.freeze({
  BASIC_KNOWLEDGE_READ: '基础知识阅读',
  LEARNING_READ: '学习资料阅读',
  LEARNING_SUBMIT: '学习记录提交',
  MEETING_READ: '组会资料阅读',
  MEETING_EDIT: '组会资料编辑',
  LITERATURE_READ: '文献阅读',
  LITERATURE_SUBMIT: '文献提交',
  WEEKLY_SUBMIT: '周报提交'
});

export function memberFeatures(context) {
  const internal = isInternalMember(context);
  const roles = Array.isArray(context?.roles) ? context.roles : [];
  const explicit = new Set(values(context?.memberRecord?.fields?.['功能授权']));
  const granted = key => explicit.has(FEATURE_GRANTS[key]);
  return {
    basicKnowledgeRead: internal || granted('BASIC_KNOWLEDGE_READ'),
    learningRead: internal || granted('LEARNING_READ') || granted('LEARNING_SUBMIT'),
    learningSubmit: internal ? roles.includes('student') : granted('LEARNING_SUBMIT'),
    meetingRead: internal || granted('MEETING_READ') || granted('MEETING_EDIT'),
    meetingEdit: internal || granted('MEETING_EDIT'),
    literatureRead: internal || granted('LITERATURE_READ') || granted('LITERATURE_SUBMIT'),
    literatureSubmit: internal || granted('LITERATURE_SUBMIT'),
    weeklySubmit: internal ? roles.includes('student') : granted('WEEKLY_SUBMIT')
  };
}
// Explicit user-approved matrix; personnel labels are not an ordinal scale.
export function confidentialityAllows(personLevel, projectLevel) {
  const matrix = { '普通': ['公开'], '受限': ['公开', '内部'], '内部': ['公开', '内部', '机密', '绝密'] };
  return Object.hasOwn(matrix, personLevel) && matrix[personLevel].includes(projectLevel);
}
function qualifiedApproval(people, value, now) {
  const linked = refs(value);
  const raw = Array.isArray(value) ? value : [];
  const ids = raw.map(v => String(v?.open_id || v?.id || '')).filter(Boolean);
  const matches = people.filter(p => linked.includes(p.record_id) || ids.includes(identity(p)));
  if (matches.length !== 1 || (linked.length + ids.length) !== 1) return false;
  const p = matches[0], f = p.fields || {}, id = identity(p);
  return Boolean(id &&
    people.filter(other => claimsIdentity(other, id)).length === 1 &&
    /^P-\d{3,}$/.test(personNumber(p)) && people.filter(other => personNumber(other) === personNumber(p)).length === 1 &&
    f['人员状态'] === '在组' && f['人员边界'] === '团队内' && f['成员类别'] !== '临时' && f['是否启用'] !== false && !f['离组时间'] &&
    (f['访问到期日'] == null || f['访问到期日'] === '' || Number.isFinite(date(f['访问到期日'], true)) && now <= date(f['访问到期日'], true)) &&
    values(f['系统职责']).includes('管理员'));
}
export function personNumber(record) {
  const f = record?.fields || {}, a = text(f['人员编号']), b = text(f['成员编号']);
  return a && b && a !== b ? '' : a || b;
}
export function authError(status, message) { return Object.assign(new Error(message), { status }); }
export function isInternalMember(context) {
  const fields = context?.memberRecord?.fields || {};
  return fields['人员边界'] === '团队内' && fields['成员类别'] !== '临时';
}
export const isAdministrator = context => isInternalMember(context) && context.duties?.includes('管理员') === true;
export function strictBinding(env, key) {
  const prefix = key.replace(/_TABLE_ID$/, '');
  const appToken = String(env[prefix + '_BASE_APP_TOKEN'] || '').trim();
  const wikiToken = String(env[prefix + '_BASE_WIKI_TOKEN'] || '').trim();
  const tableId = String(env[key] || '').trim();
  if (!tableId || (!appToken && !wikiToken)) throw authError(503, '权限主表绑定不完整');
  return { tableId, appToken, wikiToken: appToken ? '' : wikiToken };
}
export function identity(record) {
  const f = record.fields || {};
  const explicit = text(f['飞书OpenID']);
  const users = Array.isArray(f['飞书成员']) ? f['飞书成员'] : f['飞书成员'] ? [f['飞书成员']] : [];
  if (users.length !== 1) return '';
  const user = users[0];
  // records are fetched with user_id_type=open_id. Never equate user069701 with an OAuth open_id.
  const memberId = typeof user === 'object' ? String(user.open_id || user.id || '') : '';
  if (!/^ou_[\w-]+$/.test(memberId) || (explicit && explicit !== memberId)) return '';
  return memberId;
}
function claimsIdentity(record, openId) {
  const f = record?.fields || {};
  return text(f['飞书OpenID']) === openId || (Array.isArray(f['飞书成员']) ? f['飞书成员'] : [f['飞书成员']]).some(u => u && (u.open_id === openId || u.id === openId));
}
function refs(value) {
  if (value == null) return [];
  if (value && !Array.isArray(value) && Array.isArray(value.link_record_ids)) return value.link_record_ids.map(String);
  return (Array.isArray(value) ? value : [value]).flatMap(v => typeof v === 'string' ? [v] : v?.record_id ? [String(v.record_id)] : Array.isArray(v?.record_ids) ? v.record_ids.map(String) : []);
}
function date(value, end = false) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return NaN;
    // Feishu date-only fields are Shanghai midnight in milliseconds.
    return end ? Math.floor((value + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000 + 86399999 : value;
  }
  const s = text(value).replaceAll('/', '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + (end ? 'T23:59:59.999+08:00' : 'T00:00:00+08:00'));
  // Ambiguous local timestamps and blanks cannot grant access.
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(s) ? Date.parse(s) : NaN;
}
export function authority(people, projects, relations, openId, now = Date.now()) {
  const matches = people.filter(p => claimsIdentity(p, openId));
  if (matches.length !== 1 || identity(matches[0]) !== openId || !openId) throw authError(403, '账号不存在、重复或身份字段不一致');
  const record = matches[0], f = record.fields || {}, personId = personNumber(record);
  if (!/^P-\d{3,}$/.test(personId) || people.filter(p => personNumber(p) === personId).length !== 1) throw authError(403, '人员编号缺失或重复');
  if (!text(f['姓名']) || f['人员状态'] !== '在组' || !['团队内', '团队外'].includes(f['人员边界']) || f['是否启用'] === false || f['离组时间']) throw authError(403, '人员资料无效或账号已停用');
  const duties = values(f['系统职责']);
  if (!['PI', 'RA', '管理员', '博士', '硕士', '本科生', '联合培养', '企业伙伴', '临时'].includes(f['成员类别'])) throw authError(403, '成员类别无效');
  if (f['访问到期日'] != null && f['访问到期日'] !== '' && (!Number.isFinite(date(f['访问到期日'], true)) || now > date(f['访问到期日'], true))) throw authError(403, '账号访问资格已到期或日期无效');
  const internal = f['人员边界'] === '团队内' && f['成员类别'] !== '临时';
  const roles = internal ? (f['成员类别'] === 'PI' ? ['teacher'] : ['student']) : ['collaborator'];
  if (internal && duties.includes('管理员')) roles.push('manager');
  if (internal && (f['成员类别'] === 'PI' || duties.includes('课程审核'))) roles.push('teacher');
  const projectMap = new Map(), invalid = new Set();
  for (const project of projects) {
    const id = text(project.fields?.['项目编号']);
    if (!/^PRJ-\d{3,}$/.test(id)) continue;
    if (projectMap.has(id) || project.definitionBlocked === true) invalid.add(id);
    projectMap.set(id, project);
  }
  const grants = {}, counts = new Map();
  const invalidDefinitions = new Set(invalid);
  const candidates = relations.filter(r => refs(r.fields?.['关联人员']).includes(record.record_id));
  for (const relation of candidates) {
    const rf = relation.fields || {}, personRefs = refs(rf['关联人员']), projectRefs = refs(rf['关联项目']);
    if (personRefs.length !== 1 || projectRefs.length !== 1) {
      for (const ref of projectRefs) invalid.add(text(projects.find(p => p.record_id === ref)?.fields?.['项目编号']));
      continue;
    }
    const project = projects.find(p => p.record_id === projectRefs[0]);
    const id = text(project?.fields?.['项目编号']);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
    const start = date(rf['加入日期']), end = date(rf['权限到期日'], true);
    const hasApprover = qualifiedApproval(people, rf['审批人'], now);
    const level = ({ '只读': 1, '编辑': 2, '管理': 3 })[text(rf['权限级别'])] || 0;
    if (invalid.has(id) || !level || rf['授权状态'] !== '有效' || rf['工作台授权确认'] !== '已确认' || ['待变更', '待撤回', '已撤回'].includes(rf['权限落实状态']) || !hasApprover || rf['成员边界'] !== f['人员边界'] || !Number.isFinite(start) || !Number.isFinite(end) || end < start || now < start || now > end) continue;
    if (!confidentialityAllows(text(f['保密等级']), text(project?.fields?.['保密等级']))) continue;
    const statuses = ['项目阶段', '项目状态', '状态'].map(k => text(project.fields?.[k])).filter(Boolean);
    const status = new Set(statuses).size === 1 ? statuses[0] : '';
    const archiveRead = ['归档', '已归档', '已结束'].includes(status) && rf['归档查阅例外'] === true;
    if (!['执行中', '进行中', '暂停'].includes(status) && !archiveRead) continue;
    // Paused projects remain readable but cannot be changed.
    grants[id] = { level: status === '暂停' || archiveRead ? 1 : Math.min(level, 2), relationId: relation.record_id, expiresAt: end, projectRecordId: project.record_id };
  }
  // The approved model is one person/one project. Duplicates fail closed, not highest-wins.
  for (const [id, count] of counts) if (count > 1 || invalid.has(id)) delete grants[id];
  const supervisorRefs = refs(f['直属负责人']);
  const supervisor = people.find(p => supervisorRefs.includes(p.record_id));
  const directSupervisors = Array.isArray(f['直属负责人']) ? f['直属负责人'] : [];
  const directId = directSupervisors.length === 1 ? String(directSupervisors[0]?.open_id || directSupervisors[0]?.id || '') : '';
  const projectPolicies = Object.fromEntries([...projectMap].filter(([id]) => !invalidDefinitions.has(id)).map(([id, p]) => {
    const statuses = ['项目阶段', '项目状态', '状态'].map(k => text(p.fields?.[k])).filter(Boolean);
    return [id, { writable: new Set(statuses).size === 1 && ['执行中', '进行中'].includes(statuses[0]) }];
  }));
  const result = { personId, sub: openId, name: text(f['姓名']), roles: [...new Set(roles)], duties: internal ? duties : [], projectPolicies,
    teacherOpenId: supervisor ? identity(supervisor) : /^ou_[\w-]+$/.test(directId) ? directId : '', projectCode: '', track: '', grants, memberRecord: record };
  result.features = memberFeatures(result);
  return result;
}
export function canProject(context, id, action = 'read') {
  const required = { read: 1, edit: 2, manage: 3 }[action];
  if (required && /^PRJ-\d{3,}$/.test(id) && isAdministrator(context) && Object.hasOwn(context.projectPolicies || {}, id))
    return action === 'read' || context.projectPolicies[id].writable;
  return Boolean(required && /^PRJ-\d{3,}$/.test(id) && context?.grants?.[id]?.level >= required && context.grants[id].expiresAt >= Date.now());
}
export function requireProject(context, id, action = 'read') {
  if (!canProject(context, id, action)) throw authError(403, '没有该项目的操作权限');
}
// Empty Feishu association cells may be arrays or link envelopes. Unknown or
// malformed values remain scoped so they cannot bypass project authorization.
function emptyLinkedText(value) {
  // A live empty DuplexLink cell is [{ table_id: 'tbl...', text_arr: [], type: 'text' }].
  // The table id identifies the linked table, not a linked project record.
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    value.type === 'text' && typeof value.table_id === 'string' && /^tbl[A-Za-z0-9]+$/.test(value.table_id) &&
    Array.isArray(value.text_arr) && value.text_arr.length === 0 &&
    Object.keys(value).every(key => ['table_id', 'text_arr', 'type'].includes(key));
}
function emptyProjectValue(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0 || value.every(emptyLinkedText);
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every(key =>
      ['link_record_ids', 'record_ids'].includes(key) &&
      Array.isArray(value[key]) && value[key].length === 0);
  }
  return false;
}
export function hasProjectScope(record) {
  const fields = record?.fields || {};
  return ['统一项目编号', 'ProjectID', '项目编号', '关联项目'].some(key => !emptyProjectValue(fields[key]));
}
export function businessProjectId(record) {
  const f = record?.fields || {};
  const ids = ['统一项目编号', 'ProjectID', '项目编号'].map(k => text(f[k])).filter(v => /^PRJ-\d{3,}$/.test(v));
  return new Set(ids).size === 1 ? ids[0] : '';
}
export function visibleProjects(context, records) {
  return records.filter(r => {
    const id = businessProjectId(r);
    return canProject(context, id) && records.filter(other => businessProjectId(other) === id).length === 1;
  });
}
