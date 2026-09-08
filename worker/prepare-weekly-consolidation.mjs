// Prepare the already chosen weekly storage. No row deletion, guessed identity,
// workflow edits, messages, or deployment. Full snapshots stay outside checkout.
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { auditWeekly } from './audit-weekly-migration.mjs';
import { WEEKLY_FIELDS, WEEKLY_NAMES, weeklyCompatibility } from './src/weekly-write.js';

const FEEDBACK_FIELDS = ['教师反馈', '反馈请求ID', '审核状态', '反馈教师OpenID', '反馈时间'];
const PERSON_FIELDS = ['提交人/成员', '填报人'];
const ANCHOR_FIELDS = ['周锚点（选择该周任意一天）', '周锚点'];
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };

export function parseSource(label, value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.feishu.cn') || url.username || url.password || url.port ||
      !/^\/wiki\/[A-Za-z0-9]+$/.test(url.pathname) || !/^tbl[A-Za-z0-9]+$/.test(url.searchParams.get('table') || '')) fail('INVALID_SOURCE_URL');
  return { label, wikiToken: url.pathname.split('/')[2], tableId: url.searchParams.get('table') };
}

function meaningful(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.some(meaningful);
  if (typeof value === 'object') return Object.values(value).some(meaningful);
  return typeof value === 'string' ? Boolean(value.trim()) : true;
}

export function nonemptyRecords(snapshot) {
  // Unknown columns also count: never classify unseen content as disposable.
  const computed = new Set(snapshot.fields.filter(f => f.type === 20 || f.type >= 1000).map(f => f.field_name));
  return snapshot.records.filter(r => Object.entries(r.fields || {}).some(([name, value]) => !computed.has(name) && meaningful(value)));
}

export function schemaPlan(fields) {
  if (new Set(fields.map(f => f.field_name)).size !== fields.length) fail('DUPLICATE_FIELD_NAME');
  const operations = [];
  for (const [logical, types] of Object.entries(WEEKLY_FIELDS)) {
    const names = WEEKLY_NAMES[logical] || [logical];
    const existing = names.map(name => fields.find(f => f.field_name === name)).find(Boolean);
    if (!existing) {
      operations.push({ method: 'POST', body: { field_name: names[0], type: types[0] } });
      continue;
    }
    if (!types.includes(existing.type)) fail('INCOMPATIBLE_REQUIRED_FIELD');
    // Five content columns remain text. A pre-existing URL column is not
    // converted: conversion can lose data and break native references.
    if (WEEKLY_NAMES[logical] && existing.type !== 1) fail('CONTENT_COLUMN_REQUIRES_TEXT');
    if (existing.field_name !== names[0]) operations.push({ method: 'PUT', fieldId: existing.field_id,
      beforeName: existing.field_name, body: { field_name: names[0], type: 1 } });
  }
  for (const name of FEEDBACK_FIELDS) {
    const existing = fields.find(f => f.field_name === name);
    if (!existing) operations.push({ method: 'POST', body: { field_name: name, type: 1 } });
    else if (existing.type !== 1) fail('INCOMPATIBLE_FEEDBACK_FIELD');
  }
  for (const name of PERSON_FIELDS) {
    const field = fields.find(f => f.field_name === name);
    if (field && field.type !== 11) fail('INCOMPATIBLE_PERSON_FIELD');
  }
  for (const name of ANCHOR_FIELDS) {
    const field = fields.find(f => f.field_name === name);
    if (field && field.type !== 5) fail('INCOMPATIBLE_ANCHOR_FIELD');
  }
  if (fields.some(f => f.field_name === '周期' && f.type !== 1)) fail('INCOMPATIBLE_TITLE_FIELD');
  const state = fields.find(f => f.field_name === '提交状态');
  if (state?.type === 3 && !state.property?.options?.some(o => o.name === '已提交')) fail('SUBMITTED_OPTION_MISSING');
  return operations;
}

export function cutoverConfig(config, target) {
  if (config.name !== 'er2-lab-api') fail('UNEXPECTED_WORKER');
  return { ...config, keep_vars: true, vars: { ...config.vars,
    WEEKLY_TABLE_ID: target.tableId,
    WEEKLY_BASE_APP_TOKEN: '', // Explicitly clear a stale higher-priority text binding.
    WEEKLY_BASE_WIKI_TOKEN: target.wikiToken
  } };
}

export async function prepareWeekly({ env, config, sources, apply = false, snapshot, saveConfig }, fetchImpl = fetch) {
  if (sources.length !== 4 || new Set(sources.map(s => s.label)).size !== 4 ||
      !['current_worker', 'target_90_2', 'questionnaire', 'project_details'].every(label => sources.some(s => s.label === label)) ||
      new Set(sources.map(s => s.wikiToken + '/' + s.tableId)).size !== 4) fail('FOUR_DISTINCT_SOURCES_REQUIRED');
  const captured = new Map();
  const audit = await auditWeekly(env, sources, fetchImpl, async (label, data) => {
    await snapshot(label, data); // A failed backup prevents every mutation.
    captured.set(label, data);
  });
  if (!audit.allSourcesReadable || captured.size !== 4) fail('SOURCE_OR_BACKUP_FAILED');
  const questionnaireFields = captured.get('questionnaire').fields;
  if (Object.values(WEEKLY_NAMES).some(names => questionnaireFields.filter(f => f.field_name === names[0] && f.type === 1).length !== 1))
    fail('LATEST_QUESTIONNAIRE_SCHEMA_CHANGED');
  const counts = sources.map(s => ({ label: s.label, records: captured.get(s.label).records.length,
    nonemptyRecords: nonemptyRecords(captured.get(s.label)).length }));
  // This bootstrap path is appropriate only while all four sources are empty
  // or contain blank placeholders. Any real content needs an explicit row map.
  if (counts.some(c => c.nonemptyRecords)) return { applied: false, readyToDeploy: false,
    blocked: 'EXISTING_CONTENT_REQUIRES_MIGRATION', sources: counts };
  const target = sources.find(s => s.label === 'target_90_2');
  const operations = schemaPlan(captured.get(target.label).fields);
  const nextConfig = cutoverConfig(config, target);
  const plan = { applied: false, readyToDeploy: false, sources: counts,
    operations: operations.map(o => ({ action: o.method === 'PUT' ? 'rename' : 'create',
      from: o.beforeName || '', name: o.body.field_name, type: o.body.type })), recordsWritten: 0, recordsDeleted: 0 };
  await snapshot('plan', plan);
  if (!apply) return plan;

  const api = 'https://open.feishu.cn/open-apis';
  let token = '';
  async function request(path, method = 'GET', body) {
    const response = await fetchImpl(api + path, { method, signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.code !== 0) fail('API_' + (Number.isInteger(data?.code) ? data.code : response.status));
    return data;
  }
  token = (await request('/auth/v3/tenant_access_token/internal', 'POST', { app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET })).tenant_access_token;
  if (!token) fail('AUTH_FAILED');
  const node = (await request('/wiki/v2/spaces/get_node?token=' + encodeURIComponent(target.wikiToken))).data?.node;
  if (node?.obj_type !== 'bitable' || !node?.obj_token) fail('TARGET_NOT_BITABLE');
  const prefix = '/bitable/v1/apps/' + encodeURIComponent(node.obj_token) + '/tables/' + encodeURIComponent(target.tableId) + '/fields';
  for (const operation of operations) {
    if (operation.method === 'PUT' && !operation.fieldId) fail('FIELD_ID_MISSING');
    await request(prefix + (operation.fieldId ? '/' + encodeURIComponent(operation.fieldId) : ''), operation.method, operation.body);
  }
  // Read all four sources again. A concurrent submission must stop cutover.
  const verified = new Map();
  const after = await auditWeekly(env, sources, fetchImpl, async (label, data) => {
    await snapshot(label + '-after', data); verified.set(label, data);
  });
  if (!after.allSourcesReadable || verified.size !== 4) fail('POST_CHECK_READ_FAILED');
  if ([...verified.values()].some(s => nonemptyRecords(s).length)) fail('CONCURRENT_CONTENT_FOUND');
  const finalFields = verified.get(target.label).fields;
  if (!weeklyCompatibility(finalFields).ok || schemaPlan(finalFields).length) fail('POST_CHECK_SCHEMA_FAILED');
  // Only a verified table can become the proposed Worker binding. Never send
  // secrets to stdout or rewrite unrelated runtime settings.
  await saveConfig(nextConfig);
  return { ...plan, applied: true, readyToDeploy: true, schemaVerified: true,
    nativeAclVerified: false, duplicateEntrypointsRetired: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let folder = '';
  try {
    const [configPath, oldUrl, targetUrl, questionnaireUrl, detailUrl, mode] = process.argv.slice(2);
    if (!configPath || !oldUrl || !targetUrl || !questionnaireUrl || !detailUrl || !['--apply', '--plan'].includes(mode)) fail('USAGE');
    const file = resolve(configPath);
    const config = JSON.parse(readFileSync(file, 'utf8'));
    folder = resolve(homedir(), 'ER2-private-backups', 'weekly-consolidation-' + new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(folder, { mode: 0o700, recursive: true });
    const snapshot = async (label, data) => writeFileSync(resolve(folder, label + '.json'), JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    await snapshot('worker-config-before', config);
    const sources = [parseSource('current_worker', oldUrl), parseSource('target_90_2', targetUrl),
      parseSource('questionnaire', questionnaireUrl), parseSource('project_details', detailUrl)];
    const result = await prepareWeekly({ config, env: { ...config.vars, FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET }, sources,
      apply: mode === '--apply', snapshot, saveConfig: async next => {
        const temp = resolve(dirname(file), '.' + basename(file) + '.' + randomUUID() + '.tmp');
        writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        renameSync(temp, file);
      } });
    await snapshot('result', result);
    console.log(JSON.stringify({ ...result, localSnapshotFolder: folder }, null, 2));
    process.exitCode = mode === '--apply' && !result.readyToDeploy ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ readyToDeploy: false, blocked: error.safeCode || 'PREPARATION_FAILED', localSnapshotFolder: folder,
      message: '未进入部署。原记录保留；请提供此摘要，备份文件和密钥请留在本机。' }, null, 2));
    process.exitCode = 1;
  }
}
