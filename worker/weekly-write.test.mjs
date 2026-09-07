import assert from 'node:assert/strict';
import { WEEKLY_FIELDS, evidenceUrl, serializeWeekly, weeklyCompatibility } from './src/weekly-write.js';
import { auditWeekly } from './audit-weekly-migration.mjs';
const fields = Object.entries(WEEKLY_FIELDS).map(([field_name, types]) => ({ field_name, type: types[0] }));
assert.equal(evidenceUrl(' http://example.com/path '), 'http://example.com/path');
assert.equal(evidenceUrl('https://example.com/中文'), 'https://example.com/%E4%B8%AD%E6%96%87');
for (const value of ['javascript:alert(1)', 'file:///tmp/a', 'https://a:b@example.com', 'not a link', {}, ['https://example.com']]) assert.throws(() => evidenceUrl(value));
assert.equal(weeklyCompatibility(fields).ok, true);
assert.equal(weeklyCompatibility(fields.filter(f => f.field_name !== '请求ID')).ok, false);
const typed = fields.map(f => ({ ...f, type: ['提交时间', '周起始', '周结束'].includes(f.field_name) ? 5 : f.field_name === '证据链接' ? 15 : f.field_name === '周序号' ? 20 : f.type }));
const out = serializeWeekly(typed, { '证据链接': 'https://example.com', '周序号': 37, '周起始': '2026-09-07', '提交时间': '2026-09-07T06:00:00Z' });
assert.deepEqual(out['证据链接'], { text: 'https://example.com/', link: 'https://example.com/' });
assert.equal(out['周起始'], Date.parse('2026-09-07T00:00:00+08:00'));
assert.equal(out['提交时间'], Date.parse('2026-09-07T06:00:00Z'));
assert.equal(Object.hasOwn(out, '周序号'), false);
assert.equal(serializeWeekly(typed, { '证据链接': '' })['证据链接'], null);
assert.throws(() => serializeWeekly(fields.filter(f => f.field_name !== '请求ID'), { '证据链接': '' }));

let snapshots = 0;
const mock = async (url, options) => {
  if (url.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'test-token' });
  assert.equal(options.method, 'GET', 'Inventory must never write remote data');
  if (url.includes('/fields?')) return Response.json({ code: 0, data: { items: fields, has_more: false } });
  return Response.json({ code: 0, data: { total: 0, has_more: false } });
};
const result = await auditWeekly({ FEISHU_APP_ID: 'test', FEISHU_APP_SECRET: 'test' }, [
  { label: 'test', tableId: 't', appToken: 'b' }
], mock, () => { snapshots++; });
assert.equal(result.allSourcesReadable, true); assert.equal(result.sources[0].records, 0);
assert.equal(result.readyToMigrate, false); assert.equal(result.deletionAllowed, false); assert.equal(snapshots, 1);
console.log('PASS weekly field serialization, URL validation and read-only inventory');
