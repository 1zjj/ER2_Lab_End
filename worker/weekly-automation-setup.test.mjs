import assert from 'node:assert/strict';
import { LOG_FIELDS, prepareAutomation } from './prepare-weekly-automation.mjs';
import { WEEKLY_FIELDS } from './src/weekly-write.js';

const person = (n, duties = ['教授周报接收']) => ({ record_id: 'person-' + n, fields: {
  '成员编号': 'P-' + String(n).padStart(3, '0'), '姓名': '测试人员' + n,
  '飞书成员': [{ id: 'ou_test_' + n }], '成员类别': 'PI', '系统职责': duties,
  '人员状态': '在组', '人员边界': '团队内'
} });
function fixture() {
  const config = { name: 'er2-lab-api', vars: { FEISHU_APP_ID: 'mock-app', AI_ENABLED: 'false', UNRELATED: 'preserved' },
    triggers: { crons: ['0 3 * * 5', '0 10 * * 5'] } };
  for (const key of ['MEMBERS', 'AUTH_PROJECTS', 'PROJECT_MEMBERS', 'WEEKLY']) {
    config.vars[key + '_TABLE_ID'] = 'tbl' + key;
    config.vars[key + '_BASE_APP_TOKEN'] = 'mock-base';
  }
  const f = { config, people: [person(1)], logFields: LOG_FIELDS.map(field_name => ({ field_name, type: 1 })),
    rows: [], writes: [], saved: null, failWrite: false, corrupt: false, revoke: false, backupFail: false,
    input: null, fetch: null };
  f.input = { config, secret: 'mock-secret', logSource: { tableId: 'tblLOGS', wikiToken: 'mockWiki' }, apply: true,
    snapshot: async () => { if (f.backupFail) throw new Error('mock backup failure'); },
    saveConfig: async next => { f.saved = next; } };
  f.fetch = async (input, options = {}) => {
    const url = new URL(input), body = options.body ? JSON.parse(options.body) : null;
    assert.equal(url.hostname, 'open.feishu.cn');
    assert.ok(!url.pathname.includes('/im/'), 'Preflight must never send messages');
    if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'mock-token' });
    if (url.pathname.endsWith('/spaces/get_node')) return Response.json({ code: 0, data: { node: { obj_type: 'bitable', obj_token: 'mock-base' } } });
    const match = url.pathname.match(/\/apps\/([^/]+)\/tables\/([^/]+)\/(records|fields)$/);
    assert.ok(match, 'Unexpected API path');
    const [, base, table, kind] = match; assert.equal(base, 'mock-base');
    if (body) {
      assert.equal(table, 'tblLOGS'); assert.equal(kind, 'records');
      if (f.failWrite) return Response.json({ code: 99991672 }, { status: 403 });
      f.writes.push(body.fields);
      const record = { record_id: 'recProbe', fields: { ...body.fields } };
      if (f.corrupt) record.fields['执行说明'] = 'wrong';
      f.rows.push(record);
      if (f.revoke) f.people[0].fields['系统职责'] = [];
      return Response.json({ code: 0, data: { record } });
    }
    let items = [];
    if (kind === 'fields') items = table === 'tblLOGS' ? f.logFields : Object.entries(WEEKLY_FIELDS).map(([field_name, types]) => ({ field_name, type: types[0] }));
    else if (table === 'tblMEMBERS') items = f.people;
    else if (table === 'tblLOGS') items = f.rows;
    return Response.json({ code: 0, data: { items, has_more: false } });
  };
  return f;
}
let count = 0;
async function test(name, fn) { await fn(fixture()); console.log('PASS automation setup:', name); count++; }
await test('plan checks sources without writing logs or configuration', async f => {
  f.input.apply = false;
  const result = await prepareAutomation(f.input, f.fetch);
  assert.equal(result.professorPersonId, 'P-001'); assert.equal(result.readyToDeploy, false);
  assert.equal(f.saved, null); assert.equal(f.writes.length, 0);
});
await test('apply verifies one log receipt and preserves canonical bindings and settings', async f => {
  const before = structuredClone(f.config);
  const result = await prepareAutomation(f.input, f.fetch);
  assert.equal(result.readyToDeploy, true); assert.equal(result.logWriteReadbackVerified, true); assert.equal(result.messagesSent, 0);
  assert.equal(f.writes.length, 1); assert.match(f.writes[0]['运行键'], /^configuration-check-/);
  assert.equal(f.saved.vars.PROFESSOR_OPEN_ID, 'ou_test_1'); assert.equal(f.saved.vars.AUTOMATION_LOGS_TABLE_ID, 'tblLOGS');
  for (const [key, value] of Object.entries(before.vars)) assert.equal(f.saved.vars[key], value);
  assert.deepEqual(f.saved.triggers, before.triggers); assert.deepEqual(f.config, before);
  assert.equal(JSON.stringify(result).includes('ou_test_1'), false); assert.equal(JSON.stringify(f.saved).includes('mock-secret'), false);
});
await test('wrong field type blocks before log writes', async f => {
  f.logFields[2].type = 5;
  await assert.rejects(() => prepareAutomation(f.input, f.fetch), { safeCode: 'LOG_SCHEMA_MISMATCH' });
  assert.equal(f.saved, null); assert.equal(f.writes.length, 0);
});
await test('unwritable log blocks deployment', async f => {
  f.failWrite = true;
  await assert.rejects(() => prepareAutomation(f.input, f.fetch), { safeCode: 'API_99991672' }); assert.equal(f.saved, null);
});
await test('readback mismatch blocks deployment', async f => {
  f.corrupt = true;
  await assert.rejects(() => prepareAutomation(f.input, f.fetch), { safeCode: 'LOG_READBACK_FAILED' }); assert.equal(f.saved, null);
});
await test('multiple eligible recipients require explicit selection', async f => {
  f.people.push(person(2));
  await assert.rejects(() => prepareAutomation(f.input, f.fetch), { safeCode: 'PROFESSOR_RECIPIENT_AMBIGUOUS' }); assert.equal(f.writes.length, 0);
});
await test('configured recipient is validated without choosing a replacement', async f => {
  f.config.vars.PROFESSOR_OPEN_ID = 'ou_unknown';
  await assert.rejects(() => prepareAutomation(f.input, f.fetch), { safeCode: 'CONFIGURED_PROFESSOR_NOT_AUTHORIZED' }); assert.equal(f.writes.length, 0);
});
await test('revoked recipient cannot reach local configuration update', async f => {
  f.revoke = true;
  await assert.rejects(() => prepareAutomation(f.input, f.fetch), { safeCode: 'CONFIGURED_PROFESSOR_NOT_AUTHORIZED' }); assert.equal(f.saved, null);
});
await test('weekly content table cannot be reused as logs', async f => {
  f.input.logSource.tableId = 'tblWEEKLY';
  await assert.rejects(() => prepareAutomation(f.input, f.fetch), { safeCode: 'LOG_TABLE_MUST_BE_SEPARATE' }); assert.equal(f.writes.length, 0);
});
await test('failed backup prevents the log probe and configuration changes', async f => {
  f.backupFail = true;
  await assert.rejects(() => prepareAutomation(f.input, f.fetch)); assert.equal(f.writes.length, 0); assert.equal(f.saved, null);
});
console.log(count + ' weekly automation setup tests passed. No live network requests.');
