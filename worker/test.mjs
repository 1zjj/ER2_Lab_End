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
  configured: false
});

const preflight = await service.fetch(new Request('https://api.example/api/dashboard', {
  method: 'OPTIONS',
  headers: { Origin: 'https://1zjj.github.io' }
}), env);
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://1zjj.github.io');

const unauthorized = await service.fetch(new Request('https://api.example/api/dashboard'), env);
assert.equal(unauthorized.status, 401);

console.log('worker smoke tests passed');
