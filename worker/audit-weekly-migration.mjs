// Read-only migration inventory. Never writes Feishu records, fields, workflows or messages.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveTableBinding } from './src/v2/bindings.js';

export const WEEKLY_WRITE_FIELDS = [
  '请求ID', '飞书OpenID', '姓名', '周次', '周序号', '周起始', '周结束',
  '本周完成与结果', '学习与方法', '证据链接', '问题与阻塞', '下周计划', '提交状态', '提交时间'
];
const text = value => typeof value === 'string' ? value : Array.isArray(value)
  ? value.map(v => v?.text || '').join('') : '';

export async function auditWeekly(env, sources, fetchImpl = fetch, snapshot = () => {}) {
  const result = { writesPerformed: false, scope: 'weekly_migration_inventory', sources: [], readyToMigrate: false };
  const api = 'https://open.feishu.cn/open-apis';
  let token = '';
  async function request(path, body) {
    const response = await fetchImpl(api + path, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.code !== 0) throw new Error('API_' + (data?.code ?? response.status));
    return data;
  }
  async function list(path) {
    const items = [], seen = new Set(); let page = '';
    do {
      const data = (await request(path + (path.includes('?') ? '&' : '?') + 'page_size=100' +
        (page ? '&page_token=' + encodeURIComponent(page) : ''))).data;
      const empty = !page && !items.length && data?.total === 0 && data?.has_more === false &&
        data?.items == null && !data?.page_token;
      if (!Array.isArray(data?.items) && !empty) throw new Error('INVALID_PAGE');
      items.push(...(data.items || []));
      if (data.has_more === false) return items;
      if (data.has_more !== true || !data.page_token || seen.has(data.page_token)) throw new Error('INCOMPLETE_PAGINATION');
      page = data.page_token; seen.add(page);
    } while (page);
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) return { ...result, blocked: 'MISSING_APP_CREDENTIALS' };
  try {
    token = (await request('/auth/v3/tenant_access_token/internal', {
      app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET
    })).tenant_access_token;
    if (!token) throw new Error('AUTH_FAILED');
  } catch (error) { return { ...result, blocked: error.message }; }
  for (const source of sources) {
    const entry = { label: source.label, readable: false };
    result.sources.push(entry);
    try {
      if (!source.tableId || (!source.appToken && !source.wikiToken)) throw new Error('BINDING_LOCATOR_MISSING');
      const app = source.appToken || (await request('/wiki/v2/spaces/get_node?token=' +
        encodeURIComponent(source.wikiToken))).data?.node?.obj_token;
      if (!app) throw new Error('INVALID_BASE_LOCATOR');
      const prefix = '/bitable/v1/apps/' + encodeURIComponent(app) + '/tables/' + encodeURIComponent(source.tableId);
      const fields = await list(prefix + '/fields');
      const records = await list(prefix + '/records?user_id_type=open_id');
      // Full original data stays only in the user's private local snapshot; stdout is a summary.
      await snapshot(source.label, { capturedAt: new Date().toISOString(), source, fields, records });
      entry.readable = true;
      entry.records = records.length;
      entry.fields = fields.map(f => ({ name: f.field_name, type: f.type, uiType: f.ui_type || '' }));
      const names = new Set(fields.map(f => f.field_name));
      entry.missingCurrentWriteFields = WEEKLY_WRITE_FIELDS.filter(name => !names.has(name));
      entry.computedWriteFields = fields.filter(f => WEEKLY_WRITE_FIELDS.includes(f.field_name) &&
        [19, 20, 1001, 1002, 1003, 1004, 1005].includes(f.type)).map(f => f.field_name);
      entry.recordsWithoutStableIdentity = records.filter(r => !/^ou_/.test(text(r.fields?.['飞书OpenID']))).length;
      entry.recordsWithoutWeekKey = records.filter(r => !/^\d{4}-W\d{2}$/.test(text(r.fields?.['周次']))).length;
      const keys = records.map(r => text(r.fields?.['飞书OpenID']) + '|' + text(r.fields?.['周次']));
      entry.duplicateIdentityWeekKeys = new Set(keys.filter((k, i) => !k.startsWith('|') &&
        !k.endsWith('|') && keys.indexOf(k) !== i)).size;
    } catch (error) {
      entry.error = /^(API_\d+|INVALID_PAGE|INCOMPLETE_PAGINATION|BINDING_LOCATOR_MISSING|INVALID_BASE_LOCATOR)$/.test(error.message)
        ? error.message : 'READ_OR_SNAPSHOT_FAILED';
    }
  }
  result.allSourcesReadable = result.sources.every(s => s.readable);
  result.workflowReferencesVerified = false;
  result.deletionAllowed = false;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [configPath, targetUrl, formUrl] = process.argv.slice(2);
    if (!configPath || !targetUrl || !formUrl) throw new Error('USAGE');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const env = { ...(config.vars || {}), ...process.env };
    const fromUrl = (label, value) => {
      const url = new URL(value);
      if (!url.hostname.endsWith('.feishu.cn') || !url.pathname.startsWith('/wiki/') || !url.searchParams.get('table')) throw new Error('USAGE');
      return { label, wikiToken: url.pathname.split('/')[2], tableId: url.searchParams.get('table') };
    };
    const sources = [
      { label: 'current_worker', ...resolveTableBinding(env, 'WEEKLY_TABLE_ID') },
      fromUrl('target_90_2', targetUrl), fromUrl('questionnaire', formUrl)
    ];
    const folder = resolve('weekly-snapshot-' + new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(folder, { mode: 0o700 });
    const report = await auditWeekly(env, sources, fetch, (label, data) => {
      writeFileSync(resolve(folder, label + '.json'), JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    });
    writeFileSync(resolve(folder, 'summary.json'), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ ...report, localSnapshotFolder: folder }, null, 2));
    process.exitCode = report.allSourcesReadable ? 0 : 1;
  } catch (_) {
    console.error('核对未完成：请检查本地配置文件，以及包含 table 参数的两张飞书数据表链接。');
    process.exitCode = 1;
  }
}
