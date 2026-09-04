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
  dataConfigured: false
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
  dataConfigured: false
});

const multiBaseHealth = await service.fetch(new Request('https://api.example/health'), {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: '01234567890123456789012345678901',
  MEMBERS_BASE_APP_TOKEN: 'bas_members',
  MEMBERS_TABLE_ID: 'tbl_members',
  WEEKLY_BASE_APP_TOKEN: 'bas_weekly',
  WEEKLY_TABLE_ID: 'tbl_weekly'
});
assert.equal((await multiBaseHealth.json()).configured, true);

const wikiBaseHealth = await service.fetch(new Request('https://api.example/health'), {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: '01234567890123456789012345678901',
  FEISHU_BASE_WIKI_TOKEN: 'wik_test',
  MEMBERS_TABLE_ID: 'tbl_members',
  WEEKLY_TABLE_ID: 'tbl_weekly'
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

console.log('worker smoke tests passed');
