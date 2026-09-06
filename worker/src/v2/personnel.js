import { capabilitiesFromMemberFields } from './capabilities.js';

export const PERSON_ID_PATTERN = /^P-\d{3}$/;
export const MEMBER_BOUNDARIES = Object.freeze(['团队内', '团队外']);
export const MEMBER_CATEGORIES = Object.freeze(['PI', 'RA', '博士', '硕士', '本科生', '联合培养', '企业伙伴', '临时']);
export const MEMBER_STATUSES = Object.freeze(['在组', '离组', '已归档']);
export const CONFIDENTIALITY_LEVELS = Object.freeze(['普通', '内部', '受限']);
export const TRAINING_STATUSES = Object.freeze(['未开始', '进行中', '已完成', '豁免']);
export const SYSTEM_DUTIES = Object.freeze(['管理员', '财务', '课程审核', '预算审批', '教授周报接收', '知识编辑']);

export function normalizePersonRecord(record = {}) {
  const fields = record.fields || record;
  return {
    personId: text(fields['人员编号']),
    name: text(fields['姓名']),
    feishuMember: fields['飞书成员'] || null,
    openId: extractOpenId(fields['飞书OpenID']) || extractOpenId(fields['飞书成员']),
    boundary: text(fields['人员边界']),
    category: text(fields['成员类别']),
    status: text(fields['人员状态']),
    joinedAt: fields['入组时间'] || null,
    leftAt: fields['离组时间'] || null,
    confidentiality: text(fields['保密等级']),
    trainingStatus: text(fields['培训状态']),
    supervisor: fields['直属负责人'] || null,
    externalAdvisor: fields['联合培养/外部导师'] || null,
    projects: fields['关联项目'] || [],
    systemDuties: arrayValue(fields['系统职责']),
    capabilities: capabilitiesFromMemberFields(fields),
    remarks: text(fields['备注'])
  };
}

export function validatePersonRecord(record = {}) {
  const p = normalizePersonRecord(record);
  const errors = [];
  if (!PERSON_ID_PATTERN.test(p.personId)) errors.push('INVALID_PERSON_ID');
  if (!p.name) errors.push('MISSING_NAME');
  if (!p.feishuMember && !p.openId) errors.push('MISSING_FEISHU_IDENTITY');
  if (!MEMBER_BOUNDARIES.includes(p.boundary)) errors.push('INVALID_BOUNDARY');
  if (!MEMBER_CATEGORIES.includes(p.category)) errors.push('INVALID_CATEGORY');
  if (!MEMBER_STATUSES.includes(p.status)) errors.push('INVALID_STATUS');
  if (!CONFIDENTIALITY_LEVELS.includes(p.confidentiality)) errors.push('INVALID_CONFIDENTIALITY');
  if (!TRAINING_STATUSES.includes(p.trainingStatus)) errors.push('INVALID_TRAINING_STATUS');
  for (const duty of p.systemDuties) if (!SYSTEM_DUTIES.includes(duty)) errors.push('INVALID_SYSTEM_DUTY:' + duty);
  if (p.status !== '在组' && !p.leftAt) errors.push('MISSING_LEFT_AT');
  if (p.status === '在组' && p.leftAt) errors.push('ACTIVE_MEMBER_HAS_LEFT_AT');
  return { ok: errors.length === 0, errors, person: p };
}

export function nextPersonId(existingIds = []) {
  const used = new Set(existingIds.filter((id) => PERSON_ID_PATTERN.test(String(id || '').trim())));
  for (let n = 1; n <= 999; n += 1) {
    const id = `P-${String(n).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
  throw new Error('PERSON_ID_EXHAUSTED');
}

export function isActiveMember(record = {}) {
  return normalizePersonRecord(record).status === '在组';
}

export function mayUseWorkbench(record = {}, groupMembershipConfirmed = true) {
  const person = normalizePersonRecord(record);
  return groupMembershipConfirmed && person.status === '在组' && Boolean(person.openId || person.feishuMember);
}

function extractOpenId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  const candidates = Array.isArray(value) ? value : [value];
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const id = item.open_id || item.openId || item.id || item.user_id || item.userId;
    if (id) return String(id).trim();
  }
  return '';
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('').trim();
  if (value && typeof value === 'object') return String(value.text || value.name || value.value || '').trim();
  return String(value || '').trim();
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item.trim() : String(item?.name || item?.text || item?.value || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
  return value ? [String(value).trim()] : [];
}
