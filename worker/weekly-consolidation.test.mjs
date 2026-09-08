import assert from 'node:assert/strict';
import { parseSource, nonemptyRecords, schemaPlan, cutoverConfig, prepareWeekly } from './prepare-weekly-consolidation.mjs';
import { WEEKLY_FIELDS, WEEKLY_NAMES, serializeWeekly } from './src/weekly-write.js';
const canonical = Object.entries(WEEKLY_FIELDS).map(([n, types], i) => ({ field_id: 'fld' + i,
  field_name: (WEEKLY_NAMES[n] || [n])[0], type: types[0] }));
const target = canonical.filter(f => !['请求ID', '飞书OpenID', '姓名', '周次', '周起始', '周结束', '提交时间'].includes(f.field_name)).map(f => ({ ...f,
  field_name: { '本周完成与结果': '本周完成了什么', '学习与方法': '关联学习内容／培训进展（可不填）',
    '产出（若有阶段性成果，可以提交文档链接）': '产出与证据（文档、代码、截图或数据链接）', '当前问题与阻塞': '问题与需要协助' }[f.field_name] || f.field_name,
  type: f.field_name === '周序号' ? 20 : f.field_name === '提交状态' ? 3 : f.type,
  ...(f.field_name === '提交状态' ? { property: { options: [{ name: '已提交' }] } } : {}) }));
target.push(...['提交人/成员', '填报人'].map((field_name, i) => ({ field_id: 'fldUser' + i, field_name, type: 11 })),
  ...['周锚点', '周锚点（选择该周任意一天）'].map((field_name, i) => ({ field_id: 'fldDate' + i, field_name, type: 5 })),
  { field_id: 'fldTitle', field_name: '周期', type: 1 });
const sourceNames = ['current_worker', 'target_90_2', 'questionnaire', 'project_details'];
const sources = sourceNames.map((label, i) => parseSource(label, 'https://example.feishu.cn/wiki/wiki' + i + '?table=tbl' + i));
const config = { name: 'er2-lab-api', vars: { WEEKLY_BASE_APP_TOKEN: 'old', UNRELATED: 'keep' }, triggers: { crons: ['0 10 * * 5'] } };
const env = { FEISHU_APP_ID: 'app', FEISHU_APP_SECRET: 'private-test' };
assert.throws(() => parseSource('x', 'http://example.feishu.cn/wiki/abc?table=tbl1'));
assert.throws(() => parseSource('x', 'https://example.feishu.cn.evil.test/wiki/abc?table=tbl1'));
assert.throws(() => schemaPlan([...target, { field_name: '周期', type: 1 }]));
assert.throws(() => schemaPlan(target.map(f => f.field_name === '产出与证据（文档、代码、截图或数据链接）' ? { ...f, type: 15 } : f)));
assert.throws(() => schemaPlan(target.map(f => f.field_name === '提交状态' ? { ...f, property: { options: [] } } : f)));
assert.equal(nonemptyRecords({ fields: [{ field_name: '公式', type: 20 }], records: [
  { fields: { '公式': 7 } }, { fields: { '未知列': '原文' } }, { fields: { '值': 0 } }] }).length, 2);
const next = cutoverConfig(config, sources[1]);
assert.equal(next.vars.UNRELATED, 'keep'); assert.equal(next.vars.WEEKLY_BASE_APP_TOKEN, '');
assert.equal(next.vars.WEEKLY_BASE_WIKI_TOKEN, 'wiki1'); assert.deepEqual(next.triggers, config.triggers);
assert.equal(config.vars.WEEKLY_BASE_APP_TOKEN, 'old');

function fixture({ realRows = false, backupFails = false, mutationFails = false, concurrent = false } = {}) {
  const fields = structuredClone(target), mutations = [], backups = []; let configSaved = false, reads = 0;
  const mock = async (url, options) => {
    if (url.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'mock-token' });
    if (url.includes('/wiki/v2/spaces/get_node')) return Response.json({ code: 0, data: { node: { obj_type: 'bitable', obj_token: 'mockBase' } } });
    if (options.method !== 'GET') {
      assert.match(url, /\/tables\/tbl1\/fields(?:\/fld\w+)?$/);
      assert.ok(['POST', 'PUT'].includes(options.method));
      mutations.push(url);
      if (mutationFails) return Response.json({ code: 99991672 }, { status: 403 });
      const body = JSON.parse(options.body);
      if (options.method === 'POST') fields.push({ ...body, field_id: 'fldNew' + fields.length });
      else Object.assign(fields.find(f => url.endsWith('/' + f.field_id)), body);
      return Response.json({ code: 0, data: { field: body } });
    }
    if (url.includes('/fields?')) return Response.json({ code: 0, data: { items: url.includes('/tbl1/') ? fields : canonical, has_more: false } });
    if (url.includes('/records?')) {
      reads++;
      const records = url.includes('/tbl0/') ? (realRows || (concurrent && reads > 4) ? [{ fields: { '本周完成与结果': '历史原文' } }] : [{ fields: {} }]) : [];
      return Response.json({ code: 0, data: { items: records, has_more: false } });
    }
    assert.fail('Unexpected request');
  };
  return { mock, mutations, backups, saved: () => configSaved,
    options: { env, config, sources, apply: true,
      snapshot: async (label, data) => { if (backupFails) throw new Error('disk full'); backups.push(label); },
      saveConfig: async () => { configSaved = true; } } };
}
let f = fixture();
let report = await prepareWeekly(f.options, f.mock);
assert.equal(report.readyToDeploy, true); assert.equal(report.recordsWritten, 0); assert.equal(report.recordsDeleted, 0);
assert.equal(f.saved(), true); assert.ok(f.backups.includes('current_worker')); assert.ok(f.backups.includes('target_90_2-after'));
assert.equal(f.mutations.length, 16);
const rerun = await prepareWeekly(f.options, f.mock);
assert.equal(rerun.readyToDeploy, true); assert.equal(rerun.operations.length, 0); assert.equal(f.mutations.length, 16);
f = fixture({ realRows: true }); report = await prepareWeekly(f.options, f.mock);
assert.equal(report.blocked, 'EXISTING_CONTENT_REQUIRES_MIGRATION'); assert.equal(f.mutations.length, 0); assert.equal(f.saved(), false);
f = fixture({ backupFails: true }); await assert.rejects(prepareWeekly(f.options, f.mock), /SOURCE_OR_BACKUP_FAILED/); assert.equal(f.mutations.length, 0);
f = fixture({ mutationFails: true }); await assert.rejects(prepareWeekly(f.options, f.mock), /API_99991672/); assert.equal(f.saved(), false);
f = fixture({ concurrent: true }); await assert.rejects(prepareWeekly(f.options, f.mock), /CONCURRENT_CONTENT_FOUND/); assert.equal(f.saved(), false);
f = fixture(); report = await prepareWeekly({ ...f.options, apply: false }, f.mock); assert.equal(f.mutations.length, 0); assert.equal(f.saved(), false);

const enriched = [...canonical, ...target.filter(f => ['提交人/成员', '填报人', '周锚点', '周锚点（选择该周任意一天）', '周期'].includes(f.field_name))];
const payload = serializeWeekly(enriched, { '飞书OpenID': 'ou_serverIdentity', '姓名': '测试用户', '周次': '2026-W37', '周起始': '2026-09-07' });
assert.deepEqual(payload['提交人/成员'], [{ id: 'ou_serverIdentity' }]); assert.deepEqual(payload['填报人'], payload['提交人/成员']);
assert.equal(payload['周锚点'], Date.parse('2026-09-07T00:00:00+08:00'));
assert.equal(payload['周锚点（选择该周任意一天）'], payload['周锚点']); assert.equal(payload['周期'], '2026-W37 · 测试用户');
assert.throws(() => serializeWeekly(enriched, { '飞书OpenID': 'not-an-open-id' }));
assert.throws(() => serializeWeekly(enriched.map(f => f.field_name === '提交人/成员' ? { ...f, type: 1003 } : f), { '飞书OpenID': 'ou_serverIdentity' }));
console.log('PASS consolidation: backup gates, empty-source guard, target-only schema, concurrent-content guard, configuration preservation and server-owned identity/week');
