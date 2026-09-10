import { identity, text } from './authorization.js';

const MEMBER_CATEGORIES = new Set(['PI', 'RA', '管理员', '博士', '硕士', '本科生', '联合培养', '企业伙伴', '临时']);
const category = value => MEMBER_CATEGORIES.has(text(value)) ? text(value) : '成员';

// Display identity and functional permissions are independent. Never infer a
// member category from student/teacher/manager grants or a person's name.
export function literatureMemberCategory(person) {
  return category(person?.fields?.['成员类别']);
}

export function literatureIdentityLookup(people) {
  const labels = new Map();
  for (const person of people) {
    const openId = identity(person);
    if (!openId) continue;
    labels.set(openId, labels.has(openId) ? '成员' : literatureMemberCategory(person));
  }
  return labels;
}

export function literatureByline(record, labels) {
  const openId = text(record.fields?.['提交人OpenID']);
  // Resolve existing records against the already-read personnel snapshot. A
  // stored category remains useful for departed/deleted members; old combined
  // permission labels are never presented as an academic identity.
  return labels.get(openId) || category(record.fields?.['提交人角色']);
}
