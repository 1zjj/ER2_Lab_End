import { resolveTableBinding } from './v2/bindings.js';

export function courseCapabilities(env) {
  if (env.LEARNING_RECORDS_ENABLED === 'true') return { enabled: false, submissionEnabled: false, scope: 'replaced_by_learning_text_v1' };
  const binding = resolveTableBinding(env, 'COURSES_TABLE_ID', { allowGlobalFallback: false });
  const configured = Boolean(binding.tableId && (binding.appToken || binding.wikiToken) &&
    env.COURSE_REVIEWER_OPEN_ID && env.PROFESSOR_OPEN_ID);
  return { enabled: configured, submissionEnabled: configured, scope: 'configuration_only' };
}
