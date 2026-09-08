// Per-operation metadata only. No cross-request member, grant or record cache.
const scopes = new WeakMap();
export const READ_VERSION = 'read-stability-v1';
export function readScope(env, request) {
  const scoped = { ...env };
  scopes.set(scoped, { start: Date.now(), requestId: crypto.randomUUID(),
    route: new URL(request.url).pathname, readOnly: request.method === 'GET', stages: [] });
  return scoped;
}
export function readOptions(env, budgetMs = 16000) {
  const scope = scopes.get(env);
  return scope?.readOnly ? { readDeadline: Math.min(scope.start + 20000, Date.now() + budgetMs) } : {};
}
export async function measureRead(env, binding, operation) {
  const start = Date.now(); let failure;
  try { return await operation(); } catch (error) { failure = error; throw error; }
  finally {
    scopes.get(env)?.stages.push({ stage: binding.replace('_TABLE_ID', ''), ms: Date.now() - start,
      ...(failure ? { failed: true, status: failure.status || 502, ...(failure.upstreamStatus ? { upstreamStatus: failure.upstreamStatus } : {}),
        code: failure.upstreamCode || failure.code || 'READ_FAILED' } : {}) });
  }
}
export function readHeaders(env, response) {
  const scope = scopes.get(env);
  if (!scope) return response;
  const ms = Date.now() - scope.start;
  response.headers.set('Server-Timing', ['total;dur=' + ms, ...scope.stages.map((s, i) =>
    s.stage.toLowerCase() + '_' + i + ';dur=' + s.ms)].join(', '));
  response.headers.set('X-ER2-Read-Version', READ_VERSION);
  // Binding names/timing only; no identities, tokens, URLs or business content.
  if (ms >= 1500 || response.status >= 400 || scope.stages.some(s => s.failed))
    console.log('ER2_READ_TIMING', JSON.stringify({ requestId: response.headers.get('X-Request-ID') || scope.requestId,
      route: scope.route, status: response.status, ms, stages: scope.stages }));
  return response;
}
