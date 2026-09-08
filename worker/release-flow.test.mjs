import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CORE_BINDING_HASHES, bindingFingerprint } from './release-checks.mjs';

const root = mkdtempSync(join(tmpdir(), 'er2-release-test-'));
try {
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'bin'));
  for (const name of ['release.mjs', 'release-checks.mjs', 'wrangler.jsonc', 'src/build-info.js'])
    copyFileSync(new URL(name, import.meta.url), join(root, name));
  const testHashes = Object.fromEntries(Object.keys(CORE_BINDING_HASHES).map(name => [name, bindingFingerprint(name, 'fixture-' + name)]));
  const checksPath = join(root, 'release-checks.mjs');
  const productionChecks = readFileSync(checksPath, 'utf8');
  writeFileSync(checksPath, productionChecks.replace(JSON.stringify(CORE_BINDING_HASHES, null, 2), JSON.stringify(testHashes, null, 2)));
  const source = readFileSync(join(root, 'src/build-info.js'), 'utf8');
  writeFileSync(join(root, 'bin/git'), '#!/bin/sh\nif [ "$1" = rev-parse ]; then echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; fi\n', { mode: 0o755 });
  writeFileSync(join(root, 'bin/npx'), '#!/bin/sh\nprintf new > "$MOCK_STATE"\necho "Current Version ID: 11111111-1111-1111-1111-111111111111"\n', { mode: 0o755 });
  writeFileSync(join(root, 'mock.mjs'), `
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { CORE_BINDING_HASHES } from './release-checks.mjs';
const bindings = Object.keys(CORE_BINDING_HASHES).map(name => ({ name, type: 'plain_text', text: 'fixture-' + name }));
const initial = '00000000-0000-0000-0000-000000000000', next = '11111111-1111-1111-1111-111111111111';
globalThis.setTimeout = fn => { queueMicrotask(fn); return 0; };
globalThis.fetch = async (url, opts = {}) => {
  const state = readFileSync(process.env.MOCK_STATE, 'utf8');
  appendFileSync(process.env.MOCK_EVENTS, (opts.method || 'GET') + ' ' + new URL(url).pathname + '\\n');
  if (url.endsWith('/settings')) return Response.json({ success: true, result: { bindings: process.env.MOCK_MODE === 'binding' ? [] : bindings } });
  if (url.endsWith('/deployments')) {
    if (opts.method === 'POST') { writeFileSync(process.env.MOCK_STATE, 'restored'); return Response.json({ success: true, result: {} }); }
    const id = state === 'new' ? (process.env.MOCK_MODE === 'external' ? '22222222-2222-2222-2222-222222222222' : next) : initial;
    return Response.json({ success: true, result: { deployments: [{ id, created_on: '2026-09-08T01:00:00Z', versions: [{ version_id: id, percentage: 100 }] }] } });
  }
  if (url.endsWith('/health')) {
    const h = { ok: true, authConfigured: true, dataConfigured: true, deepBaseReadOk: true,
      membersSchemaOk: true, weeklySchemaOk: true, membersRecordReadable: true, weeklyRecordReadable: true, coreReady: true,
      securityPatch: 'p0-20260907-2', weeklyPatch: 'weekly-stability-v3',
      authorization: { enforced: true, mode: 'authoritative-fail-closed', bindings: { MEMBERS_TABLE_ID: true, AUTH_PROJECTS_TABLE_ID: true, PROJECT_MEMBERS_TABLE_ID: true } },
      ai: { enabled: false }, weeklyAutomation: { remindersConfigured: true, digestConfigured: true }, courseConfigured: false,
      release: { commit: state === 'new' ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : null } };
    if (state === 'new' && ['failed', 'external'].includes(process.env.MOCK_MODE)) h.weeklySchemaOk = false;
    return Response.json(h);
  }
  if (url.endsWith('/api/dashboard') || url.endsWith('/api/admin/weekly-source')) return new Response('', { status: 401 });
  throw new Error('Unexpected network request in release simulation');
};
`);
  for (const mode of ['check', 'success', 'failed', 'binding', 'external']) {
    const state = join(root, 'state'), events = join(root, 'events');
    writeFileSync(state, 'initial'); writeFileSync(events, '');
    const result = spawnSync(process.execPath, ['--import', join(root, 'mock.mjs'), join(root, 'release.mjs'), ...(mode === 'check' ? [] : ['--apply'])], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH,
        GITHUB_SHA: 'a'.repeat(40), CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32), CLOUDFLARE_API_TOKEN: 'mock-not-a-real-secret',
        MOCK_MODE: mode, MOCK_STATE: state, MOCK_EVENTS: events }
    });
    assert.equal(result.status, ['check', 'success'].includes(mode) ? 0 : 1, result.stderr);
    assert.equal(readFileSync(join(root, 'src/build-info.js'), 'utf8'), source, 'Build metadata must be restored');
    const network = readFileSync(events, 'utf8');
    assert.equal(network.includes('POST '), mode === 'failed', 'Rollback only the failed release owned by this run');
    assert.doesNotMatch(result.stdout + result.stderr, /mock-not-a-real-secret/);
    if (mode === 'check' || mode === 'binding') assert.equal(readFileSync(state, 'utf8'), 'initial', 'Preflight cannot deploy');
    if (mode === 'failed') assert.equal(readFileSync(state, 'utf8'), 'restored');
    console.log('PASS release flow:', mode);
  }
} finally { rmSync(root, { recursive: true, force: true }); }
