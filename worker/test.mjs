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
let postedMember = null;
let memberEnabled = true;
let weeklyItems = [];
let oauthUser = { open_id: 'ou_unknown', name: '陌生用户' };
const literatureItems = [
  { record_id: 'rec_recent', fields: { '论文标题': '近7天论文', '提交人OpenID': 'ou_teacher', '提交人姓名': '测试教师', '周次': 'recent', '阅读日期': Date.now() - 2 * 86400000, '提交时间': new Date(Date.now() - 2 * 86400000).toISOString() } },
  { record_id: 'rec_old', fields: { '论文标题': '历史论文', '提交人OpenID': 'ou_teacher', '提交人姓名': '测试教师', '周次': 'old', '提交时间': new Date(Date.now() - 10 * 86400000).toISOString() } }
];
globalThis.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/auth/v3/tenant_access_token/internal')) {
    return Response.json({ code: 0, tenant_access_token: 'tenant-token' });
  }
  if (String(url).endsWith('/authen/v2/oauth/token')) {
    return Response.json({ code: 0, access_token: 'user-token' });
  }
  if (String(url).endsWith('/authen/v1/user_info')) {
    return Response.json({ code: 0, data: oauthUser });
  }
  if (String(url).includes('/tables/tbl_members/records') && options.method === 'POST') {
    postedMember = JSON.parse(options.body).fields;
    return Response.json({ code: 0, data: { record: { record_id: 'rec_new_member', fields: postedMember } } });
  }
  if (String(url).includes('/tables/tbl_literature/records') && options.method === 'POST') {
    postedLiterature = JSON.parse(options.body).fields;
    return Response.json({ code: 0, data: { record: { record_id: 'rec_new', fields: postedLiterature } } });
  }
  if (String(url).includes('/tables/tbl_members/records')) {
    return Response.json({ code: 0, data: { items: [{ record_id: 'rec_member', fields: {
      '姓名': '测试教师', '飞书OpenID': 'ou_teacher', '角色': ['教师'], '是否启用': memberEnabled
    } }] } });
  }
  if (String(url).includes('/tables/tbl_literature/records')) {
    return Response.json({ code: 0, data: { items: literatureItems } });
  }
  if (String(url).includes('/tables/tbl_weekly/records')) {
    return Response.json({ code: 0, data: { items: weeklyItems } });
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
  WEEKLY_BASE_APP_TOKEN: 'bas_weekly',
  WEEKLY_TABLE_ID: 'tbl_weekly',
  LITERATURE_BASE_APP_TOKEN: 'bas_literature',
  LITERATURE_TABLE_ID: 'tbl_literature'
};
const oauthStatePayload = Buffer.from(JSON.stringify({
  purpose: 'oauth',
  returnTo: env.FRONTEND_URL,
  exp: Math.floor(Date.now() / 1000) + 600
})).toString('base64url');
const oauthStateSignature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(oauthStatePayload))).toString('base64url');
const oauthState = oauthStatePayload + '.' + oauthStateSignature;
const pilotEnv = {
  ...literatureEnv,
  FEISHU_REDIRECT_URI: 'https://api.example/auth/callback',
  PILOT_AUTO_PROVISION: 'true',
  PILOT_ALLOWED_NAMES: '朱俊杰,郑斯哲',
  BOOTSTRAP_FIRST_USER: 'true',
  BOOTSTRAP_ADMIN_NAME: '朱俊杰'
};
const blockedPilot = await service.fetch(new Request('https://api.example/auth/callback?code=test&state=' + encodeURIComponent(oauthState)), pilotEnv);
assert.equal(blockedPilot.status, 403);
assert.equal(postedMember, null);
oauthUser = { open_id: 'ou_zheng', name: '郑斯哲' };
const allowedPilot = await service.fetch(new Request('https://api.example/auth/callback?code=test&state=' + encodeURIComponent(oauthState)), pilotEnv);
assert.equal(allowedPilot.status, 302);
assert.deepEqual(postedMember['角色'], ['学生']);
assert.equal(postedMember['飞书OpenID'], 'ou_zheng');

const literatureGet = await service.fetch(new Request('https://api.example/api/literature', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv);
assert.equal(literatureGet.status, 200);
const literatureGetBody = await literatureGet.json();
assert.equal(literatureGetBody.literature.minimum, 3);
assert.deepEqual(literatureGetBody.literature.items.map((item) => item.title), ['近7天论文']);
assert.match(literatureGetBody.literature.items[0].date, /^\d{4}-\d{2}-\d{2}$/);

const initialDashboard = await service.fetch(new Request('https://api.example/api/dashboard', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv);
const initialDashboardBody = await initialDashboard.json();
weeklyItems = [{ record_id: 'rec_report', fields: {
  '飞书OpenID': 'ou_teacher',
  '周次': initialDashboardBody.week.id,
  '本周完成与结果': '完成测试',
  '学习与方法': '回归测试',
  '证据链接': 'https://example.com/evidence',
  '问题与阻塞': '暂无',
  '下周计划': '继续验证'
} }];
const submittedDashboard = await service.fetch(new Request('https://api.example/api/dashboard', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv);
assert.equal(submittedDashboard.status, 200);
const submittedDashboardBody = await submittedDashboard.json();
assert.equal(submittedDashboardBody.student.report.status, 'submitted');
assert.deepEqual(submittedDashboardBody.student.report.values, {
  progress: '完成测试',
  learning: '回归测试',
  evidence: 'https://example.com/evidence',
  blockers: '暂无',
  nextPlan: '继续验证'
});

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
const disabledGet = await service.fetch(new Request('https://api.example/api/literature', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv);
assert.equal(disabledGet.status, 403);
assert.equal((await disabledGet.json()).message, '你的ER² Lab账号已被停用');
globalThis.fetch = originalFetch;

console.log('worker smoke tests passed');
