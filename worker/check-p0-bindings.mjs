// Read-only candidate-binding preflight. Never writes records, roles, workflow state or messages.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authority, identity, strictBinding, businessProjectId } from './src/authorization.js';
import { validateSchema } from './src/v2/schema.js';

export async function checkBindings(env, fetchImpl = fetch) {
  const result = { writesPerformed: false, credentialsPresent: Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET), tables: {}, ready: false };
  if (!result.credentialsPresent) return { ...result, blocked: 'APP_CREDENTIALS_NOT_AVAILABLE' };
  const api = 'https://open.feishu.cn/open-apis';
  let token = '';
  async function request(path, body) {
    const response = await fetchImpl(api + path, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok || data.code !== 0) throw new Error('READ_FAILED');
    return data;
  }
  async function list(path, collection) {
    const all = [], seen = new Set(); let page = '';
    do {
      const data = (await request(path + (path.includes('?') ? '&' : '?') + 'page_size=100' + (page ? '&page_token=' + encodeURIComponent(page) : ''))).data;
      if (!Array.isArray(data?.[collection])) throw new Error('INVALID_LIST_RESPONSE');
      all.push(...data[collection]);
      if (!data.has_more) return all;
      page = data.page_token;
      if (!page || seen.has(page)) throw new Error('INCOMPLETE_PAGINATION');
      seen.add(page);
    } while (page);
  }
  try {
    const auth = await request('/auth/v3/tenant_access_token/internal', { app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET });
    token = auth.tenant_access_token;
    if (!token) throw new Error('AUTH_FAILED');
    const datasets = {};
    for (const [key, schema] of [['MEMBERS', 'members'], ['AUTH_PROJECTS', 'authorityProjects'], ['PROJECT_MEMBERS', 'projectMembers'], ['PROJECTS', null]]) {
      const binding = strictBinding(env, key + '_TABLE_ID');
      const base = binding.appToken || (await request('/wiki/v2/spaces/get_node?token=' + encodeURIComponent(binding.wikiToken))).data?.node?.obj_token;
      if (!base) throw new Error('INVALID_BASE_LOCATOR');
      const prefix = '/bitable/v1/apps/' + encodeURIComponent(base) + '/tables/' + encodeURIComponent(binding.tableId);
      const fields = await list(prefix + '/fields', 'items');
      const names = fields.map(f => f.field_name);
      const records = await list(prefix + '/records?user_id_type=open_id', 'items');
      const missing = schema ? validateSchema(schema, names).missingRequired : ['项目名称', '当前里程碑', '最近阻塞'].filter(n => !names.includes(n));
      if (!schema && !names.some(n => ['统一项目编号', 'ProjectID'].includes(n))) missing.push('统一项目编号');
      result.tables[key] = { readable: true, records: records.length, missingRequired: missing };
      datasets[key] = records;
    }
    let usable = 0, denied = 0, activeDenied = 0, grants = 0;
    for (const person of datasets.MEMBERS) {
      try { const ctx = authority(datasets.MEMBERS, datasets.AUTH_PROJECTS, datasets.PROJECT_MEMBERS, identity(person)); usable++; grants += Object.keys(ctx.grants).length; }
      catch (_) { denied++; if (person.fields?.['人员状态'] === '在组') activeDenied++; }
    }
    const ids = datasets.PROJECTS.map(businessProjectId);
    const authorityIds = new Set(datasets.AUTH_PROJECTS.map(p => p.fields?.['项目编号']));
    const invalidMappings = ids.filter(id => !id || !authorityIds.has(id) || ids.filter(other => other === id).length !== 1).length;
    result.personnel = { usable, denied, activeDenied };
    result.projectMappings = { invalid: invalidMappings };
    result.grantedProjectRelationships = grants;
    result.ready = usable > 0 && activeDenied === 0 && invalidMappings === 0 && Object.values(result.tables).every(t => t.missingRequired.length === 0);
    result.nativeAclVerified = false;
    return result;
  } catch (_) { return { ...result, ready: false, blocked: 'BINDING_OR_READ_CHECK_FAILED' }; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const candidate = JSON.parse(readFileSync(new URL('./p0-bindings.candidate.json', import.meta.url), 'utf8'));
  const filled = Object.fromEntries(Object.entries(candidate).filter(([, value]) => String(value || '').trim()));
  const env = { ...process.env, ...filled };
  // Candidate wiki locators must not be overridden by retained legacy app-token locators.
  for (const key of Object.keys(filled).filter(k => k.endsWith('_BASE_WIKI_TOKEN'))) delete env[key.replace('_BASE_WIKI_TOKEN', '_BASE_APP_TOKEN')];
  const result = await checkBindings(env);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
}
