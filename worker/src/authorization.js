// Authoritative ER2 authorization. No legacy role, name or project-code fallback.
export const AUTH_BINDINGS = ['MEMBERS_TABLE_ID', 'AUTH_PROJECTS_TABLE_ID', 'PROJECT_MEMBERS_TABLE_ID'];
export const text = value => Array.isArray(value) ? value.map(text).join('') : String(value && typeof value === 'object' ? value.text ?? value.name ?? value.value ?? '' : value ?? '').trim();
const values = value => (Array.isArray(value) ? value : value ? [value] : []).map(text).filter(Boolean);
export function personNumber(record) {
  const f = record?.fields || {}, a = text(f['人员编号']), b = text(f['成员编号']);
  return a && b && a !== b ? '' : a || b;
}
export function authError(status, message) { return Object.assign(new Error(message), { status }); }
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
  if (!/^P-\d{3}$/.test(personId) || people.filter(p => personNumber(p) === personId).length !== 1) throw authError(403, '人员编号缺失或重复');
  if (!text(f['姓名']) || f['人员状态'] !== '在组' || !['团队内', '团队外'].includes(f['人员边界']) || f['是否启用'] === false || f['离组时间']) throw authError(403, '人员资料无效或账号已停用');
  const duties = values(f['系统职责']);
  if (!['PI', 'RA', '管理员', '博士', '硕士', '本科生', '联合培养', '企业伙伴', '临时'].includes(f['成员类别'])) throw authError(403, '成员类别无效');
  const roles = f['成员类别'] === 'PI' && f['人员边界'] === '团队内' ? ['teacher'] : ['student'];
  if (f['人员边界'] === '团队内' && duties.includes('管理员')) roles.push('manager');
  if (f['人员边界'] === '团队内' && (f['成员类别'] === 'PI' || duties.includes('课程审核'))) roles.push('teacher');
  const projectMap = new Map(), invalid = new Set();
  for (const project of projects) {
    const id = text(project.fields?.['项目编号']);
    if (!/^PRJ-\d{3}$/.test(id)) continue;
    if (projectMap.has(id)) invalid.add(id);
    projectMap.set(id, project);
  }
  const grants = {}, counts = new Map();
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
    const approvers = refs(rf['审批人']);
    const hasApprover = approvers.some(ref => people.some(p => p.record_id === ref && identity(p))) ||
      (Array.isArray(rf['审批人']) && rf['审批人'].some(v => /^ou_[\w-]+$/.test(String(v?.open_id || v?.id || ''))));
    const level = ({ '只读': 1, '编辑': 2, '管理': 3 })[text(rf['权限级别'])] || 0;
    if (invalid.has(id) || !level || rf['授权状态'] !== '有效' || rf['权限落实状态'] !== '已落实' || !hasApprover || rf['成员边界'] !== f['人员边界'] || !Number.isFinite(start) || !Number.isFinite(end) || end < start || now < start || now > end) continue;
    const statuses = ['项目阶段', '项目状态', '状态'].map(k => text(project.fields?.[k])).filter(Boolean);
    const status = new Set(statuses).size === 1 ? statuses[0] : '';
    if (!['执行中', '进行中', '暂停'].includes(status)) continue;
    // Paused projects remain readable but cannot be changed.
    grants[id] = { level: status === '暂停' ? 1 : level, relationId: relation.record_id, expiresAt: end, projectRecordId: project.record_id };
  }
  // The approved model is one person/one project. Duplicates fail closed, not highest-wins.
  for (const [id, count] of counts) if (count > 1 || invalid.has(id)) delete grants[id];
  const supervisorRefs = refs(f['直属负责人']);
  const supervisor = people.find(p => supervisorRefs.includes(p.record_id));
  const directSupervisors = Array.isArray(f['直属负责人']) ? f['直属负责人'] : [];
  const directId = directSupervisors.length === 1 ? String(directSupervisors[0]?.open_id || directSupervisors[0]?.id || '') : '';
  return { personId, sub: openId, name: text(f['姓名']), roles: [...new Set(roles)], duties: f['人员边界'] === '团队内' ? duties : [],
    teacherOpenId: supervisor ? identity(supervisor) : /^ou_[\w-]+$/.test(directId) ? directId : '', projectCode: '', track: '', grants, memberRecord: record };
}
export function canProject(context, id, action = 'read') {
  const required = { read: 1, edit: 2, manage: 3 }[action];
  return Boolean(required && /^PRJ-\d{3}$/.test(id) && context?.grants?.[id]?.level >= required && context.grants[id].expiresAt >= Date.now());
}
export function requireProject(context, id, action = 'read') {
  if (!canProject(context, id, action)) throw authError(403, '没有该项目的操作权限');
}
export function businessProjectId(record) {
  const f = record?.fields || {};
  const ids = ['统一项目编号', 'ProjectID', '项目编号'].map(k => text(f[k])).filter(v => /^PRJ-\d{3}$/.test(v));
  return new Set(ids).size === 1 ? ids[0] : '';
}
export function visibleProjects(context, records) {
  return records.filter(r => {
    const id = businessProjectId(r);
    return canProject(context, id) && records.filter(other => businessProjectId(other) === id).length === 1;
  });
}
