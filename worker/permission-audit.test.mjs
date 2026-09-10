import assert from 'node:assert/strict';
import { inspectNativePermissions, routePermissionAudit } from './src/permission-audit.js';
const env = { MEMBERS_BASE_WIKI_TOKEN: 'ER2Anchor' };
let fail = '', calls = [];
const call = async path => {
  calls.push(path);
  if (path.includes(fail) && fail) throw Object.assign(Error('denied'), { upstreamStatus: 403, upstreamCode: 1063002 });
  if (path.includes('get_node')) { const token = new URL('https://x' + path).searchParams.get('token'); return { node: { space_id: token === 'JoeyNode' ? 'joey' : 'er2', node_token: token, obj_type: 'docx', obj_token: 'document' } }; }
  if (path.includes('/nodes?')) return { items: [{ node_token: 'Child', title: '内部文档' }], has_more: true, page_token: 'next' };
  if (path.includes('/members?')) return { items: [{ member_type: 'openid', member_id: 'ou_admin', perm: 'full_access' }] };
  if (path.includes('/public?')) return { permission_public: { link_share_entity: 'closed', external_access: false } };
  throw Error('Unexpected path');
};
const report = await inspectNativePermissions(env, 'ER2Node', '', { call, token: 'fixture' });
assert.equal(report.readComplete, true); assert.equal(report.accessCertified, false);
assert.equal(report.hasMore, true); assert.equal(report.next, 'next');
assert.equal(report.container.length, 1); assert.equal(report.singlePage.length, 1);
assert.ok(calls.some(p => p.includes('perm_type=single_page')));
assert.ok(calls.every(p => !p.includes('/Joey')));
calls = [];
await assert.rejects(inspectNativePermissions(env, 'JoeyNode', '', { call, token: 'fixture' }), e => e.status === 403);
assert.equal(calls.length, 2, 'cross-space requests stop before listing or permissions');
fail = 'perm_type=container';
const partial = await inspectNativePermissions(env, 'ER2Node', '', { call, token: 'fixture' });
assert.equal(partial.readComplete, false); assert.equal(partial.container, null);
assert.deepEqual(partial.issues, [{ scope: 'container', status: 403, code: 1063002 }]);
assert.equal((await routePermissionAudit(new Request('https://x/api/admin/permissions/audit'), {})).status, 401);
await assert.rejects(inspectNativePermissions(env, '../other', '', { call, token: 'fixture' }), e => e.status === 400);
console.log('PASS native audit: ER2 boundary, current and child permissions, pagination, explicit partial failures, no certification from API success and anonymous rejection');
fail = '';
const leafCall = async path => path.includes('get_node') ? { node: { ...(await call(path)).node, has_child: false } }
  : path.includes('/nodes?') ? { has_more: false } : call(path);
const leaf = await inspectNativePermissions(env, 'Leaf', '', { call: leafCall, token: 'fixture' });
assert.equal(leaf.readComplete, true); assert.deepEqual(leaf.children, []); assert.equal(leaf.accessCertified, false);
for (const badPage of [{}, { has_more: true }, { has_more: false, items: {} }]) {
  const bad = await inspectNativePermissions(env, 'Leaf', '', { call: path => path.includes('/nodes?') ? badPage : leafCall(path), token: 'fixture' });
  assert.equal(bad.readComplete, false);
}
const nonLeaf = await inspectNativePermissions(env, 'Parent', '', { call: path => path.includes('get_node') ? call(path) : leafCall(path), token: 'fixture' });
assert.equal(nonLeaf.readComplete, false, 'a missing list does not establish an empty parent');
console.log('PASS explicit empty leaf pagination; missing, malformed or non-final results still block');
