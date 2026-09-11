import assert from 'node:assert/strict';
import { snapshotRecords, invalidateSnapshot } from './src/snapshot-cache.js';

const bindingName = 'MEMBERS_TABLE_ID';
const binding = { appToken: 'fixture-app', wikiToken: '', tableId: 'fixture-members' };
const env = {
  SERVER_SNAPSHOT_CACHE: 'true', FEISHU_APP_ID: 'fixture-client',
  SNAPSHOT_IDENTITY_FRESH_MS: '25', SNAPSHOT_IDENTITY_MAX_MS: '100'
};
let reads = 0;
let rows = [{ record_id: 'member-1', fields: { 姓名: '初始值' } }];
const loader = async () => { reads++; return structuredClone(rows); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const first = await snapshotRecords(env, bindingName, binding, loader);
assert.equal(reads, 1); assert.equal(first[0].fields.姓名, '初始值');
assert.deepEqual(env.__er2SnapshotEvents, ['members:miss']);
assert.ok(env.__er2AuthSnapshotDeadline > Date.now() && env.__er2AuthSnapshotDeadline <= Date.now() + 100,
  'The read-context deadline cannot outlive the authorization snapshot');
first[0].fields.姓名 = '不得污染快照';
assert.equal((await snapshotRecords(env, bindingName, binding, loader))[0].fields.姓名, '初始值');
assert.equal(reads, 1, 'A fresh snapshot avoids another source read');
assert.equal(env.__er2SnapshotEvents.at(-1), 'members:hit');

await wait(35);
rows = [{ record_id: 'member-1', fields: { 姓名: '增量刷新' } }];
const background = [];
env.__er2WaitUntil = promise => background.push(promise);
const stale = await snapshotRecords(env, bindingName, binding, loader);
assert.equal(stale[0].fields.姓名, '初始值');
assert.equal(env.__er2SnapshotEvents.at(-1), 'members:stale');
assert.equal(background.length, 1, 'A bounded stale hit schedules one incremental refresh');
await Promise.all(background);
assert.equal((await snapshotRecords(env, bindingName, binding, loader))[0].fields.姓名, '增量刷新');
assert.equal(reads, 2);

await invalidateSnapshot(env, bindingName, binding);
rows = [{ record_id: 'member-1', fields: { 姓名: '写后失效' } }];
assert.equal((await snapshotRecords(env, bindingName, binding, loader))[0].fields.姓名, '写后失效');
assert.equal(reads, 3, 'Explicit invalidation forces a new source read');

const isolated = { ...env, FEISHU_APP_ID: 'expired-fixture', __er2WaitUntil: undefined,
  SNAPSHOT_IDENTITY_FRESH_MS: '25', SNAPSHOT_IDENTITY_MAX_MS: '50' };
await snapshotRecords(isolated, bindingName, binding, loader);
await wait(60);
await assert.rejects(snapshotRecords(isolated, bindingName, binding, async () => { throw Error('source unavailable'); }), /source unavailable/,
  'Expired authorization data is never served when a fresh read fails');

console.log('PASS bounded authorization snapshots, incremental refresh, clone isolation, invalidation and fail-closed expiry');
