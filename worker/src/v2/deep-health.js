import { resolveTableBinding } from './bindings.js';
import { validateSchema } from './schema.js';

const FEISHU_API = 'https://open.feishu.cn/open-apis';

export async function buildDeepHealth(env, fetchImpl = fetch) {
  const result = {
    version: 2,
    mode: 'shadow',
    writesPerformed: false,
    auth: { ok: false },
    locator: { ok: false, type: 'none' },
    appMetadata: { ok: false },
    tables: {}
  };

  try {
    const token = await tenantToken(env, fetchImpl);
    result.auth.ok = true;

    const coreBinding = resolveTableBinding(env, 'MEMBERS_TABLE_ID');
    const resolved = await resolveAppToken(coreBinding, token, fetchImpl);
    if (!resolved.appToken) return { ...result, errorStage: 'locator' };
    result.locator = { ok: true, type: resolved.type };

    const appMeta = await getJson('/bitable/v1/apps/' + encodeURIComponent(resolved.appToken), token, fetchImpl);
    result.appMetadata.ok = Boolean(appMeta);

    const tableList = await getJson('/bitable/v1/apps/' + encodeURIComponent(resolved.appToken) + '/tables?page_size=100', token, fetchImpl);
    const tableIds = new Set((tableList?.items || []).map((item) => item.table_id));

    for (const spec of [
      ['members', 'MEMBERS_TABLE_ID'],
      ['weekly', 'WEEKLY_TABLE_ID']
    ]) {
      const [schemaName, bindingKey] = spec;
      const binding = resolveTableBinding(env, bindingKey);
      const item = {
        configured: Boolean(binding.tableId),
        tablePresent: false,
        fieldsReadable: false,
        recordReadReadable: false,
        schemaOk: false,
        missingRequired: []
      };
      if (!binding.tableId) {
        result.tables[schemaName] = item;
        continue;
      }
      item.tablePresent = tableIds.has(binding.tableId);
      if (!item.tablePresent) {
        result.tables[schemaName] = item;
        continue;
      }

      const fields = await getJson('/bitable/v1/apps/' + encodeURIComponent(resolved.appToken) + '/tables/' + encodeURIComponent(binding.tableId) + '/fields?page_size=100', token, fetchImpl);
      const names = (fields?.items || []).map((field) => field.field_name).filter(Boolean);
      item.fieldsReadable = true;
      const schema = validateSchema(schemaName, names);
      item.schemaOk = schema.ok;
      item.missingRequired = schema.missingRequired;

      await getJson('/bitable/v1/apps/' + encodeURIComponent(resolved.appToken) + '/tables/' + encodeURIComponent(binding.tableId) + '/records?page_size=1', token, fetchImpl);
      item.recordReadReadable = true;
      result.tables[schemaName] = item;
    }

    result.ok = result.auth.ok && result.locator.ok && result.appMetadata.ok &&
      Object.values(result.tables).every((item) => item.tablePresent && item.fieldsReadable && item.recordReadReadable && item.schemaOk);
    return result;
  } catch (error) {
    return { ...result, ok: false, errorStage: error.stage || 'unknown', errorCode: error.code || 'READ_FAILED' };
  }
}

export function summarizeFieldCompatibility(schemaName, fieldNames) {
  const schema = validateSchema(schemaName, fieldNames);
  return { ok: schema.ok, missingRequired: schema.missingRequired, missingRecommended: schema.missingRecommended };
}

async function tenantToken(env, fetchImpl) {
  const response = await fetchImpl(FEISHU_API + '/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET })
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0 || !body.tenant_access_token) throw tagged('auth', body.code || response.status);
  return body.tenant_access_token;
}

async function resolveAppToken(binding, token, fetchImpl) {
  if (binding.appToken) return { appToken: binding.appToken, type: 'app_token' };
  if (!binding.wikiToken) return { appToken: '', type: 'none' };
  const data = await getJson('/wiki/v2/spaces/get_node?token=' + encodeURIComponent(binding.wikiToken), token, fetchImpl);
  const appToken = data?.node?.obj_token || '';
  if (!appToken) throw tagged('locator', 'NO_OBJ_TOKEN');
  return { appToken, type: 'wiki_token' };
}

async function getJson(path, token, fetchImpl) {
  const response = await fetchImpl(FEISHU_API + path, {
    headers: { Authorization: 'Bearer ' + token }
  });
  const body = await response.json();
  if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) throw tagged('read', body.code || response.status);
  return body.data;
}

function tagged(stage, code) {
  const error = new Error(stage + ':' + code);
  error.stage = stage;
  error.code = String(code);
  return error;
}
