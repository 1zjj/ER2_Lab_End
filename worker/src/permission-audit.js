import { authority, strictBinding, isAdministrator, authError } from './authorization.js';
import { requireSession, getTenantToken, listRecords, feishuRequest, json } from './index.js';

const enc = encodeURIComponent;
export async function permissionAuditContext(request, env) {
  const session = await requireSession(request, env);
  strictBinding(env, 'MEMBERS_TABLE_ID');
  const token = await getTenantToken(env);
  const people = await listRecords(env, token, 'MEMBERS_TABLE_ID');
  const actor = authority(people, [], [], session.sub);
  if (!isAdministrator(actor)) throw authError(403, '仅当前有效管理员可核验原生权限');
  return { token, actor };
}

// Audit calls cannot write or cross from ER2 into another knowledge space.
export async function inspectNativePermissions(env, nodeToken = '', pageToken = '', injected = {}) {
  const anchor = env.MEMBERS_BASE_WIKI_TOKEN;
  if (!/^[A-Za-z0-9]+$/.test(anchor || '') || nodeToken && !/^[A-Za-z0-9]+$/.test(nodeToken) || pageToken.length > 2048)
    throw authError(400, '知识库节点或分页标识无效');
  const token = injected.token || await getTenantToken(env);
  const call = injected.call || (async path => {
    const r = await feishuRequest(path, { bearer: token });
    if (r.code !== 0 || !r.data) throw authError(502, '原生权限读回不完整');
    return r.data;
  });
  const root = (await call('/wiki/v2/spaces/get_node?token=' + enc(anchor))).node;
  if (!root?.space_id) throw authError(503, '无法确认 ER2 知识空间');
  let node;
  if (nodeToken) {
    node = (await call('/wiki/v2/spaces/get_node?token=' + enc(nodeToken))).node;
    if (!node?.node_token || node.space_id !== root.space_id) throw authError(403, '只能核验 ER2 内的节点');
  }
  const issues = [];
  const optional = async (name, path) => {
    try { return await call(path); }
    catch (e) { issues.push({ scope: name, status: e.upstreamStatus || e.status || 503, code: e.upstreamCode || e.code || 'READ_FAILED' }); return null; }
  };
  const childrenPath = '/wiki/v2/spaces/' + enc(root.space_id) + '/nodes?page_size=50' +
    (nodeToken ? '&parent_node_token=' + enc(nodeToken) : '') + (pageToken ? '&page_token=' + enc(pageToken) : '');
  const [children, container, singlePage, sharing] = await Promise.all([
    optional('children', childrenPath),
    node ? optional('container', '/drive/v1/permissions/' + enc(nodeToken) + '/members?type=wiki&perm_type=container&fields=name,type,external_label') : null,
    node ? optional('single_page', '/drive/v1/permissions/' + enc(nodeToken) + '/members?type=wiki&perm_type=single_page&fields=name,type,external_label') : null,
    node ? optional('sharing', '/drive/v2/permissions/' + enc(nodeToken) + '/public?type=wiki') : null
  ]);
  if (children && (!Array.isArray(children.items) || typeof children.has_more !== 'boolean' || children.has_more && !children.page_token))
    issues.push({ scope: 'children', code: 'PAGINATION_INCOMPLETE' });
  for (const [name, result] of [['container', container], ['single_page', singlePage]])
    if (node && result && !Array.isArray(result.items)) issues.push({ scope: name, code: 'MEMBERS_INCOMPLETE' });
  const publicPermission = sharing?.permission_public;
  if (node && sharing && !publicPermission) issues.push({ scope: 'sharing', code: 'SHARING_INCOMPLETE' });
  return { checkedAt: new Date().toISOString(), spaceId: root.space_id, node: node || null,
    children: children?.items || [], hasMore: children?.has_more === true, next: children?.page_token || '',
    container: container?.items ?? null, singlePage: singlePage?.items ?? null, sharing: publicPermission ?? null,
    issues, readComplete: issues.length === 0, accessCertified: false,
    remaining: ['文档内附件与引用对象另行核验', '需用目标真实账号验证实际有效权限'] };
}

export async function routePermissionAudit(request, env) {
  try {
    const { token } = await permissionAuditContext(request, env);
    if (request.method !== 'GET') throw authError(405, '此核验入口仅支持读取');
    const url = new URL(request.url);
    return json(request, env, await inspectNativePermissions(env, url.searchParams.get('node') || '', url.searchParams.get('cursor') || '', { token }));
  } catch (e) {
    return json(request, env, { message: e.status < 500 ? e.message : '原生权限核验未完成，请检查应用的数据权限', code: e.upstreamCode || e.code || 'PERMISSION_AUDIT_FAILED' }, e.status || 503);
  }
}
