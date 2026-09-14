// Weekly-only policy. Never mutate global roles, grants, or feature permissions.
// Callers must obtain the context through a fresh authority() check.
const DAY = 86400000;
const OFFSET = 8 * 3600000;
const STUDENTS = new Set(['RA', '博士', '硕士', '本科生', '联合培养']);
const fail = (status, message) => Object.assign(new Error(message), { status });
export const weeklyPolicyEnabled = env => env.WEEKLY_BACKFILL_ENABLED === 'true';

export function owesWeekly(context) {
  const f = context?.memberRecord?.fields || {};
  if (!context?.sub || f['人员状态'] !== '在组' || f['是否启用'] === false || f['离组时间']) return false;
  if (!['团队内', '团队外'].includes(f['人员边界']) || !STUDENTS.has(f['成员类别'])) return false;
  return f['是否要求周报'] !== false;
}

export function reviewsWeekly(context, env) {
  const id = String(env.WEEKLY_REVIEWER_OPEN_ID || env.PROFESSOR_OPEN_ID || '').trim();
  const f = context?.memberRecord?.fields || {};
  return Boolean(id && context?.sub === id && (!env.WEEKLY_REVIEWER_PERSON_ID || context.personId === env.WEEKLY_REVIEWER_PERSON_ID) && context.roles?.includes('teacher') &&
    f['人员边界'] === '团队内' && f['成员类别'] === 'PI' && f['人员状态'] === '在组' &&
    f['是否启用'] !== false && !f['离组时间']);
}

export function canReadWeekly(context, record, env) {
  // Deliberately does not grant access through administrator/project roles.
  const raw = record?.fields?.['飞书OpenID'];
  const owner = Array.isArray(raw) ? raw.map(v => typeof v === 'string' ? v : v?.text || '').join('') : raw;
  return Boolean(context?.sub && (owner === context.sub || reviewsWeekly(context, env)));
}

export function shanghaiWeek(now = Date.now()) {
  const shifted = new Date(Number(now) + OFFSET);
  if (!Number.isFinite(shifted.getTime())) throw fail(400, '无效日期');
  const monday = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
    ((shifted.getUTCDay() || 7) - 1) * DAY;
  const thursday = new Date(monday + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const number = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return { id: `${year}-W${String(number).padStart(2, '0')}`, number,
    start: new Date(monday).toISOString().slice(0, 10),
    end: new Date(monday + 6 * DAY).toISOString().slice(0, 10),
    startsAt: monday - OFFSET, endsAt: monday - OFFSET + 7 * DAY,
    dueAt: monday - OFFSET + 4 * DAY + 18 * 3600000 };
}

export function weeklyStart(context, env) {
  const configured = context?.memberRecord?.fields?.['周报起始周'];
  let dates = {};
  try { dates = JSON.parse(env.WEEKLY_START_DATES || '{}'); }
  catch (_) { return null; }
  const value = configured || dates?.[context?.personId];
  // An explicit Monday date avoids ambiguous W01/year boundaries.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = Date.parse(value + 'T00:00:00+08:00');
  if (!Number.isFinite(instant)) return null;
  const week = shanghaiWeek(instant);
  return week.start === value ? week : null;
}

export function selectWeeklyTarget(context, env, requestedWeek, now = Date.now()) {
  if (!owesWeekly(context)) throw fail(403, '当前账号不具备周报提交资格');
  const current = shanghaiWeek(now), previous = shanghaiWeek(current.startsAt - 1);
  const target = !requestedWeek || requestedWeek === current.id ? current :
    requestedWeek === previous.id ? previous : null;
  if (!target) throw fail(400, '只能提交本周或补交前一周的周报');
  const start = weeklyStart(context, env);
  if (!start) throw fail(409, '周报起始周尚未确认，请联系管理员');
  if (target.startsAt < start.startsAt) throw fail(400, '不能提交周报起始周之前的记录');
  return { ...target, submissionType: target.id !== current.id ? '历史补交' :
    Number(now) > target.dueAt ? '逾期提交' : '正常提交' };
}
