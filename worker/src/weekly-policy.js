import { authority, identity } from './authorization.js';
import { weeklyText } from './weekly-write.js';
import { resolveTableBinding } from './v2/bindings.js';

export function weeklyAutomationConfiguration(env) {
  const bound = key => {
    const b = resolveTableBinding(env, key, { allowGlobalFallback: !['MEMBERS_TABLE_ID', 'AUTH_PROJECTS_TABLE_ID', 'PROJECT_MEMBERS_TABLE_ID'].includes(key) });
    return Boolean(b.tableId && (b.appToken || b.wikiToken));
  };
  const missingBindings = ['MEMBERS_TABLE_ID', 'AUTH_PROJECTS_TABLE_ID', 'PROJECT_MEMBERS_TABLE_ID', 'WEEKLY_TABLE_ID', 'AUTOMATION_LOGS_TABLE_ID'].filter(key => !bound(key));
  const configured = !missingBindings.length && Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET);
  return { remindersConfigured: configured, digestConfigured: configured && Boolean(env.PROFESSOR_OPEN_ID),
    missingBindings, scope: 'configuration_only' };
}

// All weekly consumers use the same current personnel policy. A student who
// also reviews courses or manages the workbench still owes a weekly report.
export function weeklyRoster(people) {
  return people.flatMap(record => {
    try {
      const member = authority(people, [], [], identity(record));
      return member.roles.includes('student') ? [{ ...member, openId: member.sub }] : [];
    } catch (_) { return []; }
  });
}

export function isWeeklySubmitted(record) {
  return ['已提交', 'submitted'].includes(weeklyText(record?.fields?.['提交状态']).trim().toLowerCase());
}

export function hasWeeklyIssue(value) {
  const normalized = weeklyText(value).trim().replace(/[。.!！\s]+$/u, '').toLowerCase();
  return Boolean(normalized) && !['无', '暂无', '没有', '无问题', '无阻塞', '暂无问题', '暂无阻塞', 'none', 'n/a'].includes(normalized);
}
