// Narrow opt-in. This does not change global roles, native ACLs or project grants.
// The context must first be verified by the authoritative personnel reader.
export function temporaryWeeklyReader(context, env = {}) {
  const ids = String(env.TEMPORARY_WEEKLY_VOLUNTARY_READING_PERSON_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const f = context?.memberRecord?.fields || {};
  return Boolean(context?.sub && ids.includes(context.personId) && f['人员边界'] === '团队内' &&
    f['成员类别'] === '临时' && f['人员状态'] === '在组' && f['是否启用'] !== false && !f['离组时间']);
}
