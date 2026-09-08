import { resolveTableBinding } from './v2/bindings.js';

export function courseCapabilities(env) {
  const binding = resolveTableBinding(env, 'COURSES_TABLE_ID', { allowGlobalFallback: false });
  const configured = Boolean(binding.tableId && (binding.appToken || binding.wikiToken) &&
    env.COURSE_REVIEWER_OPEN_ID && env.PROFESSOR_OPEN_ID);
  return { enabled: configured, submissionEnabled: configured, scope: 'configuration_only' };
}
