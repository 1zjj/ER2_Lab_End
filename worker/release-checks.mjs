import { createHash } from 'node:crypto';

// Fingerprints pin reviewed bindings without publishing internal table locators.
export const CORE_BINDING_HASHES = Object.freeze({
  "MEMBERS_TABLE_ID": "eb86c98f53b6506747cfb55a37cbe5f794de1e3652569ebdd3de8fef0c8612eb",
  "MEMBERS_BASE_WIKI_TOKEN": "db70dcb6291d3fe5ce5aefb2394afceba86a08050e717f307021af0bb185ba87",
  "AUTH_PROJECTS_TABLE_ID": "aefedabc75ce239cf698737ffbd2d9f8eaf268611a6a5850a511ee5f0905dedf",
  "AUTH_PROJECTS_BASE_WIKI_TOKEN": "52ff53a0ac339dffe8d536ca8bb31f697dbaeacab533a0a38e4a955f1cb5fa8b",
  "PROJECT_MEMBERS_TABLE_ID": "0f995c78bdfe5d8c83df9646ff293356da316c98215b66751af1679bd349c719",
  "PROJECT_MEMBERS_BASE_WIKI_TOKEN": "e6548c2a367d2e91092897842661283bf336dbf3d8f2c39d996a9d5e995ffea4",
  "PROJECTS_TABLE_ID": "967bc32de49e6a8cdbcccf5cb16f7226f786644a74ffded054e69060752858e3",
  "PROJECTS_BASE_WIKI_TOKEN": "ef003306b2e182c1c207ea14018280b02b4576ff099427b997cfbe29a3d08f47",
  "WEEKLY_TABLE_ID": "8fe64cec2c25d753c10a934a9c46c8a3b6510a45888bd9786fb1183ce535439b",
  "WEEKLY_BASE_WIKI_TOKEN": "b341403304a4be2ad5e99ff2f5f29de5a3a37920530703f3b350791c0cc764c5",
  "AUTOMATION_LOGS_TABLE_ID": "47e3606925fc7e384b238ff0ea9386c3ce40a5fedea326fc154137130c2bf59c",
  "AUTOMATION_LOGS_BASE_WIKI_TOKEN": "77672dea72194bb8d7eba8e23ea08d0e73e88cd1c30b14293add3b3120a0be5b"
});
export function bindingFingerprint(name, value) {
  return createHash('sha256').update(name + '\0' + value).digest('hex');
}
export function checkBindings(bindings, expectedHashes = CORE_BINDING_HASHES) {
  const byName = new Map(bindings.map(binding => [binding.name, binding]));
  const errors = [];
  for (const [key, expected] of Object.entries(expectedHashes)) {
    const actual = byName.get(key);
    if (actual?.type !== 'plain_text' || typeof actual.text !== 'string' ||
        bindingFingerprint(key, actual.text) !== expected) errors.push(key);
  }
  for (const key of Object.keys(expectedHashes).filter(key => key.endsWith('_TABLE_ID'))) {
    const appKey = key.replace(/_TABLE_ID$/, '_BASE_APP_TOKEN');
    const app = byName.get(appKey);
    if (app && (app.type !== 'plain_text' || app.text)) errors.push(appKey);
  }
  if (errors.length) throw new Error('Production bindings differ from the reviewed contract: ' + errors.join(', '));
}

export function checkHealth(h, expectedCommit = '') {
  const flags = ['ok', 'authConfigured', 'dataConfigured', 'deepBaseReadOk', 'membersSchemaOk', 'weeklySchemaOk',
    'membersRecordReadable', 'weeklyRecordReadable'];
  const errors = flags.filter(key => h[key] !== true);
  if (h.securityPatch !== 'p0-20260907-2') errors.push('securityPatch');
  if (h.weeklyPatch !== 'weekly-stability-v3') errors.push('weeklyPatch');
  if (h.authorization?.enforced !== true || h.authorization?.mode !== 'authoritative-fail-closed') errors.push('authorization');
  for (const prefix of ['MEMBERS', 'AUTH_PROJECTS', 'PROJECT_MEMBERS'])
    if (h.authorization?.bindings?.[prefix + '_TABLE_ID'] !== true) errors.push(prefix);
  if (h.ai?.enabled !== false) errors.push('aiPaused');
  if (h.weeklyAutomation?.remindersConfigured !== true || h.weeklyAutomation?.digestConfigured !== true) errors.push('weeklyAutomation');
  if (expectedCommit && h.release?.commit !== expectedCommit) errors.push('release.commit');
  if (expectedCommit && h.coreReady !== true) errors.push('coreReady');
  // Optional course configuration stays visible; it cannot excuse a core failure.
  if (errors.length) throw new Error('Core health failed: ' + errors.join(', '));
}

export function currentDeployment(result) {
  const deployments = result?.deployments;
  if (!Array.isArray(deployments) || !deployments.length) throw new Error('No rollback deployment');
  const current = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  const versions = current.versions;
  if (!Number.isFinite(Date.parse(current.created_on)) || !Array.isArray(versions) || versions.length !== 1 ||
      versions[0].percentage !== 100 || !/^[a-f0-9-]{36}$/.test(versions[0].version_id))
    throw new Error('Expected one active version at 100%; release requires explicit review of split deployments');
  return current;
}
