import assert from 'node:assert/strict';
import * as mfRuntime from 'miniflare';
const { Miniflare } = mfRuntime;
import { build } from 'esbuild';
import { WEEKLY_FIELDS } from './src/weekly-write.js';

const bundle = await build({ entryPoints: [new URL('./src/runtime.js', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser' });
const bindings = { FEISHU_APP_ID: 'runtime-test', FEISHU_APP_SECRET: 'fixture', SESSION_SECRET: 'runtime-fixture' };
for (const n of ['MEMBERS', 'AUTH_PROJECTS', 'PROJECT_MEMBERS', 'WEEKLY']) {
  bindings[n + '_TABLE_ID'] = n.toLowerCase(); bindings[n + '_BASE_APP_TOKEN'] = 'fixture-base';
}
const records = []; let writes = 0;
const options = { modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', bindings,
  durableObjects: { WEEKLY_WRITES: { className: 'WeeklyWriteCoordinator', useSQLite: true } },
  outboundService: async request => {
    const url = new URL(request.url); assert.equal(url.hostname, 'open.feishu.cn');
    if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'fixture' });
    if (url.pathname.endsWith('/fields')) return Response.json({ code: 0, data: { items: Object.entries(WEEKLY_FIELDS).map(([field_name, types]) => ({ field_name, type: types[0] })), has_more: false } });
    if (request.method === 'POST') { assert.ok(url.pathname.endsWith('/weekly/records')); writes++; records.push({ record_id: 'record-1', fields: (await request.json()).fields }); return Response.json({ code: 0, data: { record: records[0] } }); }
    const items = url.pathname.includes('/members/') ? [{ record_id: 'member-1', fields: { '人员编号': 'P-001', '姓名': 'runtime', '飞书成员': [{ id: 'ou_runtime' }], '人员状态': '在组', '人员边界': '团队内', '成员类别': '博士' } }] : url.pathname.includes('/weekly/') ? records : [];
    return Response.json({ code: 0, data: { items, has_more: false } });
  }
};
const mf = new Miniflare(mfRuntime.convertV4MiniflareOptions ? mfRuntime.convertV4MiniflareOptions(options) : options);
try {
  const namespace = await mf.getDurableObjectNamespace('WEEKLY_WRITES');
  assert.equal((await namespace.get(namespace.idFromName('health')).fetch('https://internal/_weekly-storage-check')).status, 200);
  const payload = Buffer.from(JSON.stringify({ purpose: 'session', sub: 'ou_runtime', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(bindings.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  const options = { method: 'POST', headers: { Authorization: 'Bearer ' + payload + '.' + sig, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'runtime-request', progress: '本周结果', nextPlan: '下周计划', baseRevision: '' }) };
  const responses = await Promise.all([mf.dispatchFetch('https://worker.example/api/reports', options), mf.dispatchFetch('https://worker.example/api/reports', options)]);
  for (const response of responses) { const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.readBackVerified, true); }
  assert.equal(writes, 1); assert.equal(records.length, 1);
  console.log('PASS real workerd + SQLite Durable Object: exported class, binding, storage, queued concurrent save and readback');
} finally { await mf.dispose(); }
