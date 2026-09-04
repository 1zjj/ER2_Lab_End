import assert from 'node:assert/strict';
import service from './src/index.js';

const env = {
  FRONTEND_URL: 'https://1zjj.github.io/ER2_Lab_End/'
};

const health = await service.fetch(new Request('https://api.example/health'), env);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), {
  ok: true,
  service: 'er2-lab-api',
  configured: false,
  authConfigured: false,
  dataConfigured: false,
  literatureConfigured: false
});

const authOnlyHealth = await service.fetch(new Request('https://api.example/health'), {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: '01234567890123456789012345678901'
});
assert.deepEqual(await authOnlyHealth.json(), {
  ok: true,
  service: 'er2-lab-api',
  configured: false,
  authConfigured: true,
  dataConfigured: false,
  literatureConfigured: false
});

const multiBaseHealth = await service.fetch(new Request('https://api.example/health'), {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: '01234567890123456789012345678901',
  MEMBERS_BASE_APP_TOKEN: 'bas_members',
  MEMBERS_TABLE_ID: 'tbl_members',
  WEEKLY_BASE_APP_TOKEN: 'bas_weekly',
  WEEKLY_TABLE_ID: 'tbl_weekly',
  LITERATURE_BASE_APP_TOKEN: 'bas_literature',
  LITERATURE_TABLE_ID: 'tbl_literature'
});
assert.equal((await multiBaseHealth.json()).configured, true);

const wikiBaseHealth = await service.fetch(new Request('https://api.example/health'), {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: '01234567890123456789012345678901',
  FEISHU_BASE_WIKI_TOKEN: 'wik_test',
  MEMBERS_TABLE_ID: 'tbl_members',
  WEEKLY_TABLE_ID: 'tbl_weekly',
  LITERATURE_TABLE_ID: 'tbl_literature'
});
assert.equal((await wikiBaseHealth.json()).configured, true);

const preflight = await service.fetch(new Request('https://api.example/api/dashboard', {
  method: 'OPTIONS',
  headers: { Origin: 'https://1zjj.github.io' }
}), env);
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://1zjj.github.io');

const unauthorized = await service.fetch(new Request('https://api.example/api/dashboard'), env);
assert.equal(unauthorized.status, 401);

const invalidCallback = await service.fetch(new Request('https://api.example/auth/callback'), env);
assert.equal(invalidCallback.status, 400);
const invalidCallbackBody = await invalidCallback.json();
assert.equal(invalidCallbackBody.message, '飞书授权参数不完整');
assert.ok(invalidCallbackBody.requestId);

const secret = '01234567890123456789012345678901';
const encoded = Buffer.from(JSON.stringify({
  purpose: 'session',
  sub: 'ou_teacher',
  name: '测试教师',
  roles: ['teacher'],
  exp: Math.floor(Date.now() / 1000) + 3600
})).toString('base64url');
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded))).toString('base64url');
const session = encoded + '.' + signature;
const originalFetch = globalThis.fetch;
let postedLiterature = null;
let memberEnabled = true;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/auth/v3/tenant_access_token/internal')) {
    return Response.json({ code: 0, tenant_access_token: 'tenant-token' });
  }
  if (String(url).includes('/records') && options.method === 'POST') {
    postedLiterature = JSON.parse(options.body).fields;
    return Response.json({ code: 0, data: { record: { record_id: 'rec_new', fields: postedLiterature } } });
  }
  if (String(url).includes('/tables/tbl_members/records')) {
    return Response.json({ code: 0, data: { items: [{ record_id: 'rec_member', fields: {
      '姓名': '测试教师', '飞书OpenID': 'ou_teacher', '角色': ['教师'], '是否启用': memberEnabled
    } }] } });
  }
  if (String(url).includes('/records')) return Response.json({ code: 0, data: { items: [] } });
  throw new Error('unexpected fetch ' + url);
};
const literatureEnv = {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: secret,
  MEMBERS_BASE_APP_TOKEN: 'bas_members',
  MEMBERS_TABLE_ID: 'tbl_members',
  LITERATURE_BASE_APP_TOKEN: 'bas_literature',
  LITERATURE_TABLE_ID: 'tbl_literature'
};
const literatureGet = await service.fetch(new Request('https://api.example/api/literature', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv);
assert.equal(literatureGet.status, 200);
assert.equal((await literatureGet.json()).literature.minimum, 3);

const literaturePost = await service.fetch(new Request('https://api.example/api/literature', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: '测试论文',
    contribution: '验证共同提交与查看',
    noteUrl: 'https://example.com/note',
    paperUrl: 'https://example.com/paper'
  })
}), literatureEnv);
assert.equal(literaturePost.status, 201);
assert.equal(postedLiterature['提交人姓名'], '测试教师');
assert.equal(postedLiterature['提交人角色'], '教师');
assert.equal(postedLiterature['论文标题'], '测试论文');
memberEnabled = false;
const disabledPost = await service.fetch(new Request('https://api.example/api/literature', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '停用后提交', contribution: '不应写入', noteUrl: 'https://example.com/disabled' })
}), literatureEnv);
assert.equal(disabledPost.status, 403);
assert.equal((await disabledPost.json()).message, '你的ER² Lab账号已被停用');
globalThis.fetch = originalFetch;

console.log('worker smoke tests passed');
