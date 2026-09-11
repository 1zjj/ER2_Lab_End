const AUTH_POLICIES = Object.freeze({
  MEMBERS_TABLE_ID: { freshMs: 12_000, maxMs: 20_000 },
  PROJECT_MEMBERS_TABLE_ID: { freshMs: 12_000, maxMs: 20_000 },
  PROJECTS_TABLE_ID: { freshMs: 30_000, maxMs: 45_000 },
  AUTH_PROJECTS_TABLE_ID: { freshMs: 30_000, maxMs: 45_000 }
});

const memory = new Map();
const refreshes = new Map();

export async function snapshotRecords(env, bindingName, binding, loader) {
  const policy = snapshotPolicy(env, bindingName);
  if (!policy) return loader();
  const key = await snapshotKey(env, bindingName, binding);
  const cached = await readSnapshot(key, policy);
  const now = Date.now();
  if (cached && now - cached.fetchedAt <= policy.freshMs) {
    noteSnapshot(env, bindingName, 'hit', cached.fetchedAt + policy.maxMs);
    return cloneRecords(cached.records);
  }
  if (cached && now - cached.fetchedAt <= policy.maxMs && typeof env.__er2WaitUntil === 'function') {
    const refresh = refreshSnapshot(key, policy, loader).catch(error => {
      console.log('ER2_SNAPSHOT_REFRESH_FAILED', JSON.stringify({ binding: bindingName,
        code: error.upstreamCode || error.code || error.name || 'READ_FAILED' }));
    });
    env.__er2WaitUntil(refresh);
    noteSnapshot(env, bindingName, 'stale', cached.fetchedAt + policy.maxMs);
    return cloneRecords(cached.records);
  }
  const fresh = await refreshSnapshot(key, policy, loader);
  noteSnapshot(env, bindingName, cached ? 'refresh' : 'miss', fresh.fetchedAt + policy.maxMs);
  return cloneRecords(fresh.records);
}

export async function invalidateSnapshot(env, bindingName, binding) {
  if (env.SERVER_SNAPSHOT_CACHE !== 'true' || !AUTH_POLICIES[bindingName]) return;
  const key = await snapshotKey(env, bindingName, binding);
  memory.delete(key.id);
  const cache = globalThis.caches?.default;
  if (cache) await cache.delete(key.request).catch(() => false);
}

function snapshotPolicy(env, bindingName) {
  if (env.SERVER_SNAPSHOT_CACHE !== 'true') return null;
  const base = AUTH_POLICIES[bindingName];
  if (!base) return null;
  const prefix = ['MEMBERS_TABLE_ID', 'PROJECT_MEMBERS_TABLE_ID'].includes(bindingName) ? 'IDENTITY' : 'PROJECT';
  const freshMs = boundedDuration(env['SNAPSHOT_' + prefix + '_FRESH_MS'], base.freshMs, 25, 60_000);
  const maxMs = boundedDuration(env['SNAPSHOT_' + prefix + '_MAX_MS'], base.maxMs, freshMs, 90_000);
  return { freshMs, maxMs };
}

function boundedDuration(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
}

async function snapshotKey(env, bindingName, binding) {
  const source = JSON.stringify([env.FEISHU_APP_ID || '', bindingName, binding.appToken || binding.wikiToken || '', binding.tableId || '']);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const id = [...new Uint8Array(digest)].slice(0, 18).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { id, request: new Request('https://er2-snapshot.invalid/v1/' + id) };
}

async function readSnapshot(key, policy) {
  const local = memory.get(key.id);
  if (validSnapshot(local, policy)) return local;
  if (local) memory.delete(key.id);
  const cache = globalThis.caches?.default;
  if (!cache) return null;
  try {
    const response = await cache.match(key.request);
    if (!response) return null;
    const value = await response.json();
    if (!validSnapshot(value, policy)) {
      await cache.delete(key.request).catch(() => false);
      return null;
    }
    memory.set(key.id, value);
    return value;
  } catch (_) {
    return null;
  }
}

function validSnapshot(value, policy) {
  return Boolean(value && Number.isFinite(value.fetchedAt) && value.fetchedAt <= Date.now() &&
    Date.now() - value.fetchedAt <= policy.maxMs && Array.isArray(value.records));
}

function refreshSnapshot(key, policy, loader) {
  const existing = refreshes.get(key.id);
  if (existing) return existing;
  const current = Promise.resolve().then(loader).then(async records => {
    if (!Array.isArray(records)) throw new Error('Invalid snapshot source');
    const value = { fetchedAt: Date.now(), records: cloneRecords(records) };
    memory.set(key.id, value);
    if (memory.size > 64) {
      for (const [id, item] of memory) if (Date.now() - item.fetchedAt > 90_000) memory.delete(id);
    }
    const cache = globalThis.caches?.default;
    if (cache) {
      const response = new Response(JSON.stringify(value), { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=' + Math.max(1, Math.ceil(policy.maxMs / 1000))
      } });
      await cache.put(key.request, response).catch(() => {});
    }
    return value;
  });
  refreshes.set(key.id, current);
  current.finally(() => {
    if (refreshes.get(key.id) === current) refreshes.delete(key.id);
  }).catch(() => {});
  return current;
}

function noteSnapshot(env, bindingName, state, deadline) {
  env.__er2SnapshotEvents ||= [];
  env.__er2SnapshotEvents.push(bindingName.replace('_TABLE_ID', '').toLowerCase() + ':' + state);
  env.__er2AuthSnapshotDeadline = Math.min(env.__er2AuthSnapshotDeadline || Infinity, deadline);
}

function cloneRecords(records) {
  return structuredClone(records);
}
