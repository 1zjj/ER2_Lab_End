import assert from 'node:assert/strict';
import { shouldRestartOAuth } from './src/runtime.js';

assert.equal(shouldRestartOAuth(401, { message: '登录状态已过期' }), true);
assert.equal(shouldRestartOAuth(401, { message: '登录状态无效' }), false);
assert.equal(shouldRestartOAuth(403, { message: '登录状态已过期' }), false);
assert.equal(shouldRestartOAuth(401, null), false);

console.log('OAuth retry tests passed');
