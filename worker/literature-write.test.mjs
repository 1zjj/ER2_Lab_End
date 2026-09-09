import assert from 'node:assert/strict';
import service from './src/runtime.js';
import { LITERATURE_FIELDS, serializeLiterature, literatureText } from './src/literature-write.js';
const schema = Object.entries(LITERATURE_FIELDS).map(([field_name, types]) => ({ field_name,
  type: field_name.endsWith('链接') ? 15 : ['阅读日期', '提交时间'].includes(field_name) ? 5 : types[0] }));
const env = { SESSION_SECRET: 'literature-fixture', FEISHU_APP_ID: 'fixture', FEISHU_APP_SECRET: 'fixture', FRONTEND_URL: 'https://fixture.test' };
for (const name of ['MEMBERS', 'AUTH_PROJECTS', 'PROJECT_MEMBERS', 'LITERATURE']) {
  env[name + '_TABLE_ID'] = name.toLowerCase(); env[name + '_BASE_APP_TOKEN'] = 'fixture-' + name.toLowerCase();
}
const person = { record_id: 'person-1', fields: { '人员编号': 'P-001', '姓名': '合成学生', '飞书成员': [{ id: 'ou_1' }],
  '人员状态': '在组', '人员边界': '团队内', '成员类别': '博士', '保密等级': '内部' } };
const rows = []; let writes = 0, mode = '', liveSchema = schema;
const originalFetch = globalThis.fetch, originalNow = Date.now;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input); assert.equal(url.hostname, 'open.feishu.cn');
  if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'fixture' });
  if (url.pathname.endsWith('/apps/fixture-literature')) return Response.json({ code: 0, data: { app: { name: '合成文献库', url: 'https://fixture.feishu.cn/base/fixture-literature' } } });
  if (url.pathname.endsWith('/apps/fixture-literature/tables')) return Response.json({ code: 0, data: { items: [{ table_id: 'literature', name: '合成文献表' }], has_more: false } });
  const match = url.pathname.match(/\/tables\/([^/]+)\/(records|fields)(?:\/([^/]+))?$/);
  assert.ok(match, url.pathname); const [, table, kind, id] = match;
  if (kind === 'fields') return Response.json({ code: 0, data: { items: liveSchema, has_more: false } });
  if (options.method === 'GET') {
    if (id) {
      const record = structuredClone(rows.find(row => row.record_id === id));
      if (mode === 'readback-mismatch') record.fields['一句话贡献'] = 'incorrect';
      // Feishu can return a friendly hyperlink label different from its destination.
      for (const key of ['阅读笔记链接', '论文链接']) if (record?.fields[key]) record.fields[key].text = '打开文档';
      return Response.json({ code: 0, data: { record } });
    }
    return Response.json({ code: 0, data: { items: table === 'members' ? [person] : table === 'literature' ? rows : [], has_more: false } });
  }
  assert.equal(table, 'literature'); assert.equal(options.method, 'POST');
  writes++;
  const fields = JSON.parse(options.body).fields;
  assert.equal(typeof fields['阅读日期'], 'number'); assert.equal(typeof fields['提交时间'], 'number');
  if (Object.hasOwn(fields, '阅读笔记链接')) assert.deepEqual(fields['阅读笔记链接'], { text: literatureText(fields['阅读笔记链接']), link: literatureText(fields['阅读笔记链接']) });
  assert.equal(Object.hasOwn(fields, '论文附件链接'), false, 'Optional blank hyperlink must be omitted');
  if (mode === 'rejected') return Response.json({ code: 1254061, msg: 'synthetic field rejection' });
  const record = { record_id: 'reading-' + writes, fields }; rows.push(record);
  if (mode === 'missing-id') return Response.json({ code: 0, data: {} });
  return Response.json({ code: 0, data: { record } });
};
const encoded = Buffer.from(JSON.stringify({ purpose: 'session', sub: 'ou_1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded))).toString('base64url');
const base = { requestId: 'literature-fixture-1', title: '合成论文', contribution: '合成贡献', noteUrl: 'https://example.com/note', type: '精读' };
const call = (body, path = '/api/literature') => service.fetch(new Request('https://fixture.test' + path, {
  method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + encoded + '.' + sig, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}) }), env);
try {
  let response = await call(base); assert.equal(response.status, 201);
  let result = await response.json(); assert.equal(result.readBackVerified, true); assert.equal(result.literature.mineCount, 1);
  assert.equal(result.literature.items[0].noteUrl, base.noteUrl); assert.equal(writes, 1);
  response = await call(base); assert.equal(response.status, 200); assert.equal((await response.json()).deduplicated, true); assert.equal(writes, 1);
  response = await call({ ...base, contribution: '修改后不同正文' }); assert.equal(response.status, 409); assert.equal(writes, 1);
  for (const corrupt of [schema.filter(f => f.field_name !== '请求ID'), schema.map(f => f.field_name === '阅读笔记链接' ? { ...f, type: 17 } : f)]) {
    liveSchema = corrupt; response = await call({ ...base, title: '其他论文', requestId: 'invalid-schema' });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'LITERATURE_SCHEMA_MISMATCH'); assert.equal(writes, 1);
  }
  liveSchema = schema;
  for (mode of ['missing-id', 'readback-mismatch']) {
    const draft = { ...base, title: mode, requestId: mode };
    response = await call(draft); assert.equal(response.status, 502); assert.equal((await response.json()).code, 'LITERATURE_READBACK_FAILED');
    const before = writes; mode = ''; response = await call(draft);
    assert.equal(response.status, 200); assert.equal((await response.json()).readBackVerified, true); assert.equal(writes, before, 'Retry reconciles already saved record');
  }
  mode = 'rejected'; response = await call({ ...base, title: 'rejected', requestId: 'rejected' });
  assert.equal(response.status, 502); assert.equal((await response.json()).code, 'LITERATURE_WRITE_FAILED');
  assert.equal((await call(null, '/api/admin/literature-source')).status, 403);
  person.fields['系统职责'] = ['管理员'];
  const source = await (await call(null, '/api/admin/literature-source')).json();
  assert.equal(source.schema.ok, true); assert.equal(source.recordsRead, false); assert.equal(source.tableId, 'literature'); assert.equal(source.tableName, '合成文献表');
  // Run the next scenario in a new rate-limit window without delaying the test.
  Date.now = () => originalNow() + 61_000;
  mode = '';
  for (const [index, noteUrl] of ['', '   ', undefined].entries()) {
    const draft = { ...base, title: '可选笔记-' + index, requestId: 'optional-' + index, noteUrl };
    response = await call(draft); assert.equal(response.status, 201);
    result = await response.json(); assert.equal(result.readBackVerified, true);
    assert.equal(result.literature.items.find(item => item.id === result.recordId).noteUrl, '');
    assert.equal(Object.hasOwn(rows.at(-1).fields, '阅读笔记链接'), false, 'Blank optional URL is omitted from Feishu write');
    const before = writes; response = await call(draft);
    assert.equal(response.status, 200); assert.equal((await response.json()).deduplicated, true); assert.equal(writes, before);
    response = await call({ ...draft, noteUrl: base.noteUrl }); assert.equal(response.status, 409); assert.equal(writes, before);
  }
  const beforeInvalid = writes;
  response = await call({ ...base, noteUrl: '', requestId: base.requestId }); assert.equal(response.status, 409, 'Existing request with a note cannot be reconciled as a blank note');
  for (const noteUrl of ['http://example.com/note', 'javascript:alert(1)', 'not-a-url']) {
    response = await call({ ...base, requestId: 'invalid-url', noteUrl }); assert.equal(response.status, 400);
  }
  assert.equal(writes, beforeInvalid, 'Invalid URLs and conflicting requests never write');
  person.fields['人员状态'] = '离组'; const before = writes; assert.equal((await call(base)).status, 403); assert.equal(writes, before);
  const legacy = schema.map(f => ({ ...f, type: ['阅读日期', '提交时间', '阅读笔记链接'].includes(f.field_name) ? 1 : f.type }));
  assert.equal(serializeLiterature(legacy, { '阅读日期': '2026-09-09', '阅读笔记链接': base.noteUrl })['阅读日期'], '2026-09-09');
  console.log('PASS literature save: actual field types, URL targets, confirmed readback, retry reconciliation, conflicts, schema failure, missing confirmation, upstream rejection and access denial');
} finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
