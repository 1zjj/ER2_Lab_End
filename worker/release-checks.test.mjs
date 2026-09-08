import assert from 'node:assert/strict';
import { checkBindings, checkHealth, currentDeployment, CORE_BINDING_HASHES, bindingFingerprint } from './release-checks.mjs';
const bindings = Object.keys(CORE_BINDING_HASHES).map(name => ({ name, type: 'plain_text', text: 'fixture-' + name }));
const fingerprints = Object.fromEntries(bindings.map(b => [b.name, bindingFingerprint(b.name, b.text)]));
checkBindings(bindings, fingerprints);
assert.throws(() => checkBindings(bindings), /Production bindings/, 'Test identifiers cannot pass the production contract');
for (const key of Object.keys(fingerprints).filter(k => k.endsWith('_TABLE_ID'))) {
  assert.throws(() => checkBindings(bindings.filter(b => b.name !== key), fingerprints), /Production bindings/);
  assert.throws(() => checkBindings([...bindings, { name: key.replace(/_TABLE_ID$/, '_BASE_APP_TOKEN'), type: 'secret_text' }], fingerprints), /Production bindings/);
}
assert.throws(() => checkBindings(bindings.map(b => b.name === 'WEEKLY_TABLE_ID' ? { ...b, text: 'old-weekly-table' } : b), fingerprints), /WEEKLY_TABLE_ID/);
const healthy = { ok: true, authConfigured: true, dataConfigured: true, deepBaseReadOk: true,
  membersSchemaOk: true, weeklySchemaOk: true, membersRecordReadable: true, weeklyRecordReadable: true,
  securityPatch: 'p0-20260907-2', weeklyPatch: 'weekly-stability-v3', coreReady: true,
  authorization: { enforced: true, mode: 'authoritative-fail-closed', bindings: { MEMBERS_TABLE_ID: true, AUTH_PROJECTS_TABLE_ID: true, PROJECT_MEMBERS_TABLE_ID: true } },
  ai: { enabled: false }, weeklyAutomation: { remindersConfigured: true, digestConfigured: true },
  configured: false, courseConfigured: false, release: { commit: 'abc' } };
checkHealth(healthy, 'abc');
for (const field of ['ok', 'authConfigured', 'weeklySchemaOk', 'deepBaseReadOk', 'coreReady'])
  assert.throws(() => checkHealth({ ...healthy, [field]: false }, 'abc'), /Core health/);
assert.throws(() => checkHealth({ ...healthy, securityPatch: 'p0-20260907-1' }, 'abc'), /securityPatch/);
assert.throws(() => checkHealth(healthy, 'wrong'), /release.commit/);
const deployment = { id: 'current', created_on: '2026-09-08T01:00:00Z', versions: [{ version_id: '9747fff0-2984-4d26-92cd-9661adca87e2', percentage: 100 }] };
assert.equal(currentDeployment({ deployments: [deployment] }).id, 'current');
assert.throws(() => currentDeployment({ deployments: [] }), /No rollback/);
assert.throws(() => currentDeployment({ deployments: [{ ...deployment, versions: [{ ...deployment.versions[0], percentage: 50 }] }] }), /100/);
console.log('PASS release checks: wrong tables, hidden app-token precedence, core regressions, old commits and split deployments block release');
