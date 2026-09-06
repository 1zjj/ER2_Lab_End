export const CAPABILITIES = Object.freeze({
  INTERNAL_MEMBER: 'internal_member',
  EXTERNAL_MEMBER: 'external_member',
  PI: 'pi',
  RA: 'ra',
  PHD: 'phd',
  MASTER: 'master',
  UNDERGRAD: 'undergrad',
  JOINT_TRAINING: 'joint_training',
  ENTERPRISE_PARTNER: 'enterprise_partner',
  TEMPORARY: 'temporary',
  ADMIN: 'admin',
  FINANCE: 'finance',
  BUDGET_APPROVER: 'budget_approver',
  COURSE_REVIEWER: 'course_reviewer',
  PROFESSOR_DIGEST_RECIPIENT: 'professor_digest_recipient',
  KNOWLEDGE_EDITOR: 'knowledge_editor'
});

export const DUTY_MAP = Object.freeze({
  '管理员': CAPABILITIES.ADMIN,
  '财务': CAPABILITIES.FINANCE,
  '课程审核': CAPABILITIES.COURSE_REVIEWER,
  '预算审批': CAPABILITIES.BUDGET_APPROVER,
  '教授周报接收': CAPABILITIES.PROFESSOR_DIGEST_RECIPIENT,
  '知识编辑': CAPABILITIES.KNOWLEDGE_EDITOR
});

export const CATEGORY_MAP = Object.freeze({
  'PI': CAPABILITIES.PI,
  'RA': CAPABILITIES.RA,
  '博士': CAPABILITIES.PHD,
  '硕士': CAPABILITIES.MASTER,
  '本科生': CAPABILITIES.UNDERGRAD,
  '联合培养': CAPABILITIES.JOINT_TRAINING,
  '企业伙伴': CAPABILITIES.ENTERPRISE_PARTNER,
  '临时': CAPABILITIES.TEMPORARY
});

export function normalizeCapabilities(rawCapabilities, rawRoles = []) {
  const explicit = arrayValue(rawCapabilities).map(normalize).filter(Boolean);
  const inherited = arrayValue(rawRoles).map((value) => DUTY_MAP[String(value || '').trim()] || normalize(value)).filter(Boolean);
  return [...new Set([...explicit, ...inherited])];
}

export function capabilitiesFromMemberFields(fields = {}) {
  const boundary = String(fields['人员边界'] || '').trim();
  const category = String(fields['成员类别'] || '').trim();
  const duties = arrayValue(fields['系统职责']);
  const out = [];
  if (boundary === '团队内') out.push(CAPABILITIES.INTERNAL_MEMBER);
  if (boundary === '团队外') out.push(CAPABILITIES.EXTERNAL_MEMBER);
  if (CATEGORY_MAP[category]) out.push(CATEGORY_MAP[category]);
  for (const duty of duties) if (DUTY_MAP[duty]) out.push(DUTY_MAP[duty]);
  return [...new Set(out)];
}

export function hasCapability(member, capability) {
  return normalizeCapabilities(member?.capabilities, member?.roles).includes(capability);
}

// Sensitive duties are explicit. ADMIN never implies finance, budget approval or course review.
export function canReviewCourses(member) {
  return hasCapability(member, CAPABILITIES.COURSE_REVIEWER);
}

export function canApproveBudgets(member) {
  return hasCapability(member, CAPABILITIES.BUDGET_APPROVER);
}

export function canHandleFinance(member) {
  return hasCapability(member, CAPABILITIES.FINANCE);
}

export function canEditKnowledge(member) {
  return hasCapability(member, CAPABILITIES.KNOWLEDGE_EDITOR);
}

export function isAdmin(member) {
  return hasCapability(member, CAPABILITIES.ADMIN);
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' ? [item] : [item?.name || item?.text || '']).filter(Boolean);
  if (typeof value === 'string') return value.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
  return value ? [String(value)] : [];
}
