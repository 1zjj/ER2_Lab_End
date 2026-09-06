export const CAPABILITIES = Object.freeze({
  STUDENT: 'student',
  TEACHER: 'teacher',
  MANAGER: 'manager',
  ADMIN: 'admin',
  FINANCE: 'finance',
  BUDGET_APPROVER: 'budget_approver',
  COURSE_REVIEWER: 'course_reviewer',
  KNOWLEDGE_EDITOR: 'knowledge_editor'
});

const ROLE_DEFAULTS = Object.freeze({
  student: [CAPABILITIES.STUDENT],
  teacher: [CAPABILITIES.TEACHER],
  manager: [CAPABILITIES.MANAGER]
});

export function normalizeCapabilities(rawCapabilities, rawRoles = []) {
  const explicit = arrayValue(rawCapabilities).map(normalize).filter(Boolean);
  const inherited = arrayValue(rawRoles).flatMap((role) => ROLE_DEFAULTS[normalizeRole(role)] || []);
  return [...new Set([...explicit, ...inherited])];
}

export function hasCapability(member, capability) {
  return normalizeCapabilities(member?.capabilities, member?.roles).includes(capability);
}

export function canReviewCourses(member) {
  return hasCapability(member, CAPABILITIES.COURSE_REVIEWER) || hasCapability(member, CAPABILITIES.ADMIN);
}

export function canApproveBudgets(member) {
  return hasCapability(member, CAPABILITIES.BUDGET_APPROVER) || hasCapability(member, CAPABILITIES.ADMIN);
}

export function canHandleFinance(member) {
  return hasCapability(member, CAPABILITIES.FINANCE) || hasCapability(member, CAPABILITIES.ADMIN);
}

export function canEditKnowledge(member) {
  return hasCapability(member, CAPABILITIES.KNOWLEDGE_EDITOR) || hasCapability(member, CAPABILITIES.ADMIN);
}

function normalizeRole(value) {
  const text = normalize(value);
  if (text.includes('管理')) return 'manager';
  if (text.includes('教师') || text.includes('教授')) return 'teacher';
  if (text.includes('学生')) return 'student';
  return text;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' ? [item] : [item?.name || item?.text || '']).filter(Boolean);
  if (typeof value === 'string') return value.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
  return value ? [String(value)] : [];
}
