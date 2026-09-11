import assert from 'node:assert/strict';
import { filteredRecords } from './src/index.js';

const originalFetch = globalThis.fetch;
const env = {
  FILTERED_READS: 'true',
  WEEKLY_BASE_APP_TOKEN: 'app-weekly',
  WEEKLY_TABLE_ID: 'tbl-weekly'
};
const rows = [
  { record_id: 'current', fields: { '周次': '2026-W37', '本周完成与结果': '本周' } },
  { record_id: 'old', fields: { '周次': '2026-W36', '本周完成与结果': '上周' } }
];
let failSearch = false, searchCalls = 0, listCalls = 0;

globalThis.fetch = async (url, options = {}) => {
  assert.ok(String(url).startsWith('https://open.feishu.cn/open-apis/bitable/v1/apps/app-weekly/tables/tbl-weekly/records'));
  if (String(url).includes('/records/search')) {
    searchCalls++;
    if (failSearch) return Response.json({ code: 1254043, msg: 'field not found' }, { status: 400 });
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.filter, { conjunction: 'and', conditions: [
      { field_name: '周次', operator: 'is', value: ['2026-W37'] }
    ] });
    return Response.json({ code: 0, data: { items: [rows[0]], has_more: false } });
  }
  listCalls++;
  assert.equal(options.method, 'GET');
  return Response.json({ code: 0, data: { items: rows, has_more: false } });
};

try {
  const filter = { conjunction: 'and', conditions: [
    { field_name: '周次', operator: 'is', value: ['2026-W37'] }
  ] };
  assert.deepEqual((await filteredRecords(env, 'tenant', 'WEEKLY_TABLE_ID', filter)).map(row => row.record_id), ['current']);
  assert.equal(searchCalls, 1);
  assert.equal(listCalls, 0);

  failSearch = true;
  assert.deepEqual((await filteredRecords(env, 'tenant', 'WEEKLY_TABLE_ID', filter)).map(row => row.record_id), ['current', 'old']);
  assert.equal(searchCalls, 2);
  assert.equal(listCalls, 1);
  console.log('PASS filtered Feishu reads and safe full-read fallback');
} finally {
  globalThis.fetch = originalFetch;
}
