export const TABLE_BINDINGS = Object.freeze([
  'MEMBERS_TABLE_ID',
  'AUTH_PROJECTS_TABLE_ID',
  'WEEKLY_TABLE_ID',
  'PROJECTS_TABLE_ID',
  'PROJECT_MEMBERS_TABLE_ID',
  'COURSES_TABLE_ID',
  'TRAINING_CATALOG_TABLE_ID',
  'TASKS_TABLE_ID',
  'LINKS_TABLE_ID',
  'LITERATURE_TABLE_ID',
  'KNOWLEDGE_INDEX_TABLE_ID',
  'AUTOMATION_LOGS_TABLE_ID'
]);

export function resolveTableBinding(env, tableBinding, options = {}) {
  const key = String(tableBinding || '').trim();
  const appTokenKey = key.replace(/_TABLE_ID$/, '_BASE_APP_TOKEN');
  const wikiTokenKey = key.replace(/_TABLE_ID$/, '_BASE_WIKI_TOKEN');
  const allowGlobalFallback = options.allowGlobalFallback ?? env.LEGACY_GLOBAL_BASE_FALLBACK !== 'false';

  const directAppToken = clean(env[appTokenKey]);
  const directWikiToken = clean(env[wikiTokenKey]);
  const globalAppToken = allowGlobalFallback ? clean(env.FEISHU_BASE_APP_TOKEN) : '';
  const globalWikiToken = allowGlobalFallback ? clean(env.FEISHU_BASE_WIKI_TOKEN) : '';
  const tableId = clean(env[key]);

  if (directAppToken) return { tableBinding: key, tableId, appToken: directAppToken, wikiToken: '', source: appTokenKey, legacy: false };
  if (directWikiToken) return { tableBinding: key, tableId, appToken: '', wikiToken: directWikiToken, source: wikiTokenKey, legacy: false };
  if (globalAppToken) return { tableBinding: key, tableId, appToken: globalAppToken, wikiToken: '', source: 'FEISHU_BASE_APP_TOKEN', legacy: true };
  if (globalWikiToken) return { tableBinding: key, tableId, appToken: '', wikiToken: globalWikiToken, source: 'FEISHU_BASE_WIKI_TOKEN', legacy: true };
  return { tableBinding: key, tableId, appToken: '', wikiToken: '', source: '', legacy: false };
}

export function bindingConfigured(binding) {
  return Boolean(binding?.tableId && (binding?.appToken || binding?.wikiToken));
}

export function summarizeBinding(binding) {
  return {
    tableBinding: binding.tableBinding,
    configured: bindingConfigured(binding),
    hasTableId: Boolean(binding.tableId),
    locator: binding.appToken ? 'app_token' : (binding.wikiToken ? 'wiki_token' : 'none'),
    source: binding.source || '',
    legacyFallback: Boolean(binding.legacy)
  };
}

export function summarizeAllBindings(env, keys = TABLE_BINDINGS) {
  return Object.fromEntries(keys.map((key) => {
    const binding = resolveTableBinding(env, key);
    return [key, summarizeBinding(binding)];
  }));
}

export function bindingFingerprint(value) {
  const text = clean(value);
  if (!text) return '';
  if (text.length <= 8) return 'configured';
  return text.slice(0, 3) + '…' + text.slice(-3);
}

function clean(value) {
  return String(value || '').trim();
}
