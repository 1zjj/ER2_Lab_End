// Validate the existing weekly sources and a dedicated delivery log before
// preparing local deployment configuration. Never send messages or edit roles.
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { authority, identity } from './src/authorization.js';
import { resolveTableBinding } from './src/v2/bindings.js';
import { weeklyCompatibility, weeklyText } from './src/weekly-write.js';
import { weeklyAutomationConfiguration } from './src/weekly-policy.js';
import { recordPage } from './src/feishu-record-page.js';
import { parseSource } from './prepare-weekly-consolidation.mjs';

export const LOG_FIELDS = ['运行键', '任务名称', '执行时间', '执行结果', '执行说明'];
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };

export function professorRecipient(people, configured = '') {
  const eligible = people.flatMap(record => {
    try {
      const member = authority(people, [], [], identity(record));
      return member.duties.includes('教授周报接收') ? [member] : [];
    } catch (_) { return []; }
  });
  if (configured) {
    const match = eligible.filter(member => member.sub === configured);
    if (match.length !== 1) fail('CONFIGURED_PROFESSOR_NOT_AUTHORIZED');
    return match[0];
  }
  if (eligible.length !== 1) fail(eligible.length ? 'PROFESSOR_RECIPIENT_AMBIGUOUS' : 'PROFESSOR_RECIPIENT_MISSING');
  return eligible[0];
}

export async function prepareAutomation({ config, secret, logSource, apply = false, snapshot, saveConfig }, fetchImpl = fetch) {
  if (config.name !== 'er2-lab-api') fail('UNEXPECTED_WORKER');
  if (!secret || !config.vars?.FEISHU_APP_ID) fail('CREDENTIALS_MISSING');
  const env = { ...config.vars, FEISHU_APP_SECRET: secret };
  const proposedEnv = { ...env, AUTOMATION_LOGS_TABLE_ID: logSource.tableId,
    AUTOMATION_LOGS_BASE_WIKI_TOKEN: logSource.wikiToken, AUTOMATION_LOGS_BASE_APP_TOKEN: '' };
  if (weeklyAutomationConfiguration(proposedEnv).missingBindings.length) fail('AUTHORITATIVE_OR_WEEKLY_BINDING_MISSING');
  let token = '';
  async function request(path, body) {
    const response = await fetchImpl('https://open.feishu.cn/open-apis' + path, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.code !== 0) fail('API_' + (Number.isInteger(data?.code) ? data.code : response.status));
    return data;
  }
  token = (await request('/auth/v3/tenant_access_token/internal', { app_id: env.FEISHU_APP_ID, app_secret: secret })).tenant_access_token;
  if (!token) fail('AUTH_FAILED');
  const resolved = new Map();
  async function tablePath(key) {
    const binding = resolveTableBinding(proposedEnv, key, { allowGlobalFallback: false });
    if (!binding.tableId || (!binding.appToken && !binding.wikiToken)) fail('EXPLICIT_BINDING_REQUIRED');
    let app = binding.appToken;
    if (!app) {
      if (!resolved.has(binding.wikiToken)) {
        const node = (await request('/wiki/v2/spaces/get_node?token=' + encodeURIComponent(binding.wikiToken))).data?.node;
        if (node?.obj_type !== 'bitable' || !node.obj_token) fail('SOURCE_NOT_BITABLE');
        resolved.set(binding.wikiToken, node.obj_token);
      }
      app = resolved.get(binding.wikiToken);
    }
    return '/bitable/v1/apps/' + encodeURIComponent(app) + '/tables/' + encodeURIComponent(binding.tableId);
  }
  async function list(path) {
    const items = [], pages = new Set(); let page = '';
    do {
      const result = await request(path + '?user_id_type=open_id&page_size=100' + (page ? '&page_token=' + encodeURIComponent(page) : ''));
      const parsed = recordPage(result, page, items.length);
      items.push(...parsed.items); page = parsed.next;
      if (page && pages.has(page)) fail('PAGINATION_REPEATED');
      if (page) pages.add(page);
    } while (page);
    return items;
  }
  const [members, projects, relations, weekly, logs] = await Promise.all(
    ['MEMBERS_TABLE_ID', 'AUTH_PROJECTS_TABLE_ID', 'PROJECT_MEMBERS_TABLE_ID', 'WEEKLY_TABLE_ID', 'AUTOMATION_LOGS_TABLE_ID'].map(tablePath));
  if ([members, projects, relations, weekly].includes(logs)) fail('LOG_TABLE_MUST_BE_SEPARATE');
  const [logFields, weeklyFields, people, logRows] = await Promise.all([
    list(logs + '/fields'), list(weekly + '/fields'), list(members + '/records'), list(logs + '/records'),
    list(projects + '/records'), list(relations + '/records'), list(weekly + '/records')
  ]);
  if (LOG_FIELDS.some(name => logFields.filter(field => field.field_name === name && field.type === 1).length !== 1)) fail('LOG_SCHEMA_MISMATCH');
  if (!weeklyCompatibility(weeklyFields).ok) fail('WEEKLY_SCHEMA_MISMATCH');
  const recipient = professorRecipient(people, env.PROFESSOR_OPEN_ID);
  const nextConfig = { ...config, keep_vars: true, vars: { ...config.vars,
    AUTOMATION_LOGS_TABLE_ID: logSource.tableId, AUTOMATION_LOGS_BASE_APP_TOKEN: '',
    AUTOMATION_LOGS_BASE_WIKI_TOKEN: logSource.wikiToken, PROFESSOR_OPEN_ID: recipient.sub } };
  // Private deployment config and table metadata stay outside the checkout.
  await snapshot('automation-config-before', config);
  await snapshot('automation-log-schema', logFields);
  const summary = { applied: false, readyToDeploy: false, messagesSent: 0,
    weeklySchemaOk: true, logSchemaOk: true, logRecordsRead: logRows.length,
    professorPersonId: recipient.personId, professorDutyVerified: true, deliveryVerified: false };
  if (!apply) return summary;
  const probe = { '运行键': 'configuration-check-' + randomUUID(), '任务名称': '周报自动化配置检查',
    '执行时间': new Date().toISOString(), '执行结果': '成功', '执行说明': '验证日志读写；未发送消息' };
  await snapshot('automation-probe-plan', probe);
  const created = (await request(logs + '/records?user_id_type=open_id', { fields: probe })).data?.record;
  if (!created?.record_id) fail('LOG_WRITE_UNCONFIRMED');
  const readback = (await list(logs + '/records')).filter(row => row.record_id === created.record_id);
  if (readback.length !== 1 || LOG_FIELDS.some(name => weeklyText(readback[0].fields?.[name]) !== probe[name])) fail('LOG_READBACK_FAILED');
  // Recheck the designated person immediately before preparing deployment.
  professorRecipient(await list(members + '/records'), recipient.sub);
  await saveConfig(nextConfig);
  return { ...summary, applied: true, readyToDeploy: true, logWriteReadbackVerified: true, logProbeRecordsWritten: 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let folder = '';
  try {
    const [configPath, logUrl, mode] = process.argv.slice(2);
    if (!configPath || !logUrl || !['--plan', '--apply'].includes(mode)) fail('USAGE');
    const file = resolve(configPath), config = JSON.parse(readFileSync(file, 'utf8'));
    const logSource = parseSource('automation_logs', logUrl);
    folder = resolve(homedir(), 'ER2-private-backups', 'weekly-automation-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID());
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const snapshot = async (label, data) => writeFileSync(resolve(folder, label + '.json'), JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    const result = await prepareAutomation({ config, secret: process.env.FEISHU_APP_SECRET, logSource,
      apply: mode === '--apply', snapshot, saveConfig: async next => {
        const temp = resolve(dirname(file), '.' + basename(file) + '.' + randomUUID() + '.tmp');
        writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        renameSync(temp, file);
      } });
    await snapshot('automation-result', result);
    console.log(JSON.stringify({ ...result, localSnapshotFolder: folder }, null, 2));
    process.exitCode = mode === '--apply' && !result.readyToDeploy ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ readyToDeploy: false, blocked: error.safeCode || 'PREPARATION_FAILED',
      localSnapshotFolder: folder, message: '未进入部署；未发送消息。请提供此摘要，密钥和备份留在本机。' }, null, 2));
    process.exitCode = 1;
  }
}
