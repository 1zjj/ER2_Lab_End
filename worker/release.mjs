import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { checkBindings, checkHealth, currentDeployment } from './release-checks.mjs';
import { prepareWeeklyBootstrap } from './release-weekly-bootstrap.mjs';
import { prepareLearningBootstrap } from './release-learning-bootstrap.mjs';
import { prepareFinanceBootstrap } from './release-finance-bootstrap.mjs';

const origin = 'https://er2-lab-api.zhujunjie418.workers.dev';
const config = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const apply = process.argv.includes('--apply');
if (!token || !/^[a-f0-9]{32}$/.test(account || '') || config.name !== 'er2-lab-api' || config.keep_vars !== true)
  throw new Error('Cloudflare credentials or production configuration missing; no deployment performed');
const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${config.name}`;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.env.GITHUB_SHA && commit !== process.env.GITHUB_SHA) throw new Error('Checkout differs from workflow commit');
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim())
  throw new Error('Release must start from a clean committed checkout');

async function cf(path, body) {
  const response = await fetch(apiRoot + path, { method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || result.success !== true) throw new Error(`Cloudflare request failed: ${path} HTTP ${response.status}; codes ${(result.errors || []).map(e => e.code).join(',')}`);
  return result.result;
}
async function health(expectedCommit = '') {
  const response = await fetch(origin + '/health', { signal: AbortSignal.timeout(40000), cache: 'no-store' });
  if (!response.ok) throw new Error('Health HTTP ' + response.status);
  const h = await response.json(); checkHealth(h, expectedCommit); return h;
}
async function verify(expectedCommit) {
  const h = await health(expectedCommit);
  for (const path of ['/api/dashboard', '/api/admin/weekly-source', '/api/reports/history']) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (response.status !== 401) throw new Error('Anonymous access must return 401: ' + path);
  }
  console.log(JSON.stringify({ verifiedCommit: h.release?.commit || null, coreReady: true,
    courseConfigured: h.courseConfigured, aiPaused: h.ai.enabled === false, weekly: h.capabilities?.weekly || null }));
  return h;
}

let baseline = currentDeployment(await cf('/deployments'));
const settings = await cf('/settings');
checkBindings(settings.bindings || []);
const merged = new Map((settings.bindings || []).map(b => [b.name, b]));
for (const [name, text] of Object.entries(config.vars || {})) merged.set(name, { name, type: 'plain_text', text });
checkBindings([...merged.values()]);
const originalHealth = await verify('');
if (!apply) { console.log('Read-only preflight passed; no deployment performed.'); process.exit(0); }
if (currentDeployment(await cf('/deployments')).id !== baseline.id) throw new Error('Production changed during preflight; no deployment performed');
function deployConfig(configPath) {
  const deploy = spawnSync('npx', ['--no-install', 'wrangler', 'deploy', '--config', configPath, '--keep-vars'],
    { encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
  const version = deploy.stdout?.match(/Current Version ID:\s*([a-f0-9-]{36})/)?.[1] || '';
  if (deploy.status !== 0 || !version) throw new Error('Wrangler deployment failed or did not return a version ID');
  return version;
}
const coordinator = (settings.bindings || []).find(b => b.name === 'WEEKLY_WRITES');
if (coordinator && (coordinator.type !== 'durable_object_namespace' || coordinator.class_name !== 'WeeklyWriteCoordinator'))
  throw new Error('Unexpected weekly coordinator binding; no deployment performed');
if (!coordinator && config.vars.LEARNING_RECORDS_ENABLED === 'true') throw new Error('Working weekly storage is required before adding learning storage');
if (!coordinator) {
  const bridge = prepareWeeklyBootstrap(originalHealth.release?.commit, config);
  try {
    const oldMerged = new Map((settings.bindings || []).map(b => [b.name, b]));
    for (const [name, text] of Object.entries(bridge.config.vars || {})) oldMerged.set(name, { name, type: 'plain_text', text });
    checkBindings([...oldMerged.values()]);
    console.log('Preparing rollback-compatible weekly storage baseline with unchanged production business code.');
    const bridgeVersion = deployConfig(bridge.configPath);
    const deployed = currentDeployment(await cf('/deployments'));
    if (deployed.versions[0].version_id !== bridgeVersion) throw new Error('Production changed during compatibility baseline deployment');
    baseline = deployed;
    await verify(originalHealth.release.commit);
    const bindings = (await cf('/settings')).bindings || [];
    checkBindings(bindings);
    if (!bindings.some(b => b.name === 'WEEKLY_WRITES' && b.type === 'durable_object_namespace' && b.class_name === 'WeeklyWriteCoordinator'))
      throw new Error('Compatibility baseline did not establish the weekly namespace');
    console.log('Compatible rollback baseline verified: ' + bridgeVersion);
  } catch (error) {
    // Do not roll across a DO lifecycle migration or continue with new behavior.
    throw new Error('Weekly compatibility baseline needs review; feature deployment stopped: ' + error.message);
  } finally { bridge.cleanup(); }
}
if (config.vars.LEARNING_RECORDS_ENABLED === 'true') {
  const learning = ((await cf('/settings')).bindings || []).find(b => b.name === 'LEARNING_RECORDS');
  if (learning && (learning.type !== 'durable_object_namespace' || learning.class_name !== 'LearningRecords')) throw new Error('Unexpected learning binding');
  if (!learning) {
    const bridge = prepareLearningBootstrap(originalHealth.release?.commit, config);
    try {
      const oldMerged = new Map((settings.bindings || []).map(b => [b.name, b]));
      for (const [name, text] of Object.entries(bridge.config.vars || {})) oldMerged.set(name, { name, type: 'plain_text', text });
      checkBindings([...oldMerged.values()]);
      if (currentDeployment(await cf('/deployments')).id !== baseline.id) throw new Error('Production changed before learning migration');
      const bridgeVersion = deployConfig(bridge.configPath);
      const deployed = currentDeployment(await cf('/deployments'));
      if (deployed.versions[0].version_id !== bridgeVersion) throw new Error('Production changed during learning migration');
      baseline = deployed;
      await verify(originalHealth.release.commit);
      const bindings = (await cf('/settings')).bindings || [];
      checkBindings(bindings);
      if (!bindings.some(b => b.name === 'LEARNING_RECORDS' && b.type === 'durable_object_namespace' && b.class_name === 'LearningRecords')) throw new Error('Learning namespace missing after migration');
      console.log('Learning rollback-compatible baseline verified: ' + bridgeVersion);
    } finally { bridge.cleanup(); }
  }
}
if (config.vars.FINANCE_ENABLED === 'true') {
  const finance = ((await cf('/settings')).bindings || []).find(b => b.name === 'FINANCE_RECORDS');
  if (finance && (finance.type !== 'durable_object_namespace' || finance.class_name !== 'FinanceRecords')) throw new Error('Unexpected finance binding');
  if (!finance) {
    const bridge = prepareFinanceBootstrap(originalHealth.release?.commit, config);
    try {
      const oldMerged = new Map((settings.bindings || []).map(b => [b.name, b]));
      for (const [name, text] of Object.entries(bridge.config.vars || {})) oldMerged.set(name, { name, type: 'plain_text', text });
      checkBindings([...oldMerged.values()]);
      if (currentDeployment(await cf('/deployments')).id !== baseline.id) throw new Error('Production changed before finance migration');
      const bridgeVersion = deployConfig(bridge.configPath);
      const deployed = currentDeployment(await cf('/deployments'));
      if (deployed.versions[0].version_id !== bridgeVersion) throw new Error('Production changed during finance migration');
      baseline = deployed;
      await verify(originalHealth.release.commit);
      const bindings = (await cf('/settings')).bindings || [];
      checkBindings(bindings);
      if (!bindings.some(b => b.name === 'FINANCE_RECORDS' && b.type === 'durable_object_namespace' && b.class_name === 'FinanceRecords')) throw new Error('Finance namespace missing after migration');
      console.log('Finance rollback-compatible baseline verified: ' + bridgeVersion);
    } finally { bridge.cleanup(); }
  }
}
if (currentDeployment(await cf('/deployments')).id !== baseline.id) throw new Error('Production changed before feature deployment');
const buildPath = new URL('./src/build-info.js', import.meta.url);
const original = readFileSync(buildPath, 'utf8');
let newVersion = '';
try {
  writeFileSync(buildPath, 'export const BUILD_INFO = Object.freeze(' + JSON.stringify({ commit, builtAt: new Date().toISOString() }) + ');\n');
  newVersion = deployConfig('wrangler.jsonc');
  console.log('Uploaded version: ' + newVersion);
  let passed = false, failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const h = await verify(commit);
      if (h.capabilities?.weekly?.coordinatedWrites !== true || h.capabilities?.weekly?.historyPagination !== true || h.capabilities?.weekly?.version !== 'weekly-save-history-v1') throw new Error('Weekly save/history capability check failed');
      if (config.vars.LEARNING_RECORDS_ENABLED === 'true') {
        if (h.capabilities?.learning?.storageReady !== true || h.capabilities.learning.recipientsReady !== true || h.capabilities.learning.version !== 'learning-text-v1') throw new Error('Learning storage or recipient verification failed');
        for (const path of ['/api/learning', '/api/learning/inbox', '/api/learning/record?track=A&lesson=01']) {
          if ((await fetch(origin + path, { signal: AbortSignal.timeout(30000) })).status !== 401) throw new Error('Learning anonymous access must return 401');
        }
      }
      if (config.vars.FINANCE_ENABLED === 'true') {
        if (h.capabilities?.finance?.version !== 'finance-v1' || h.capabilities.finance.configured !== true) throw new Error('Finance capability missing');
        for (const path of ['/api/finance', '/api/finance/setup', '/api/finance/records?review=true', '/api/finance/attachment'])
          if ((await fetch(origin + path, { signal: AbortSignal.timeout(30000) })).status !== 401) throw new Error('Finance anonymous access must return 401');
      }
      checkBindings((await cf('/settings')).bindings || []); passed = true; break; }
    catch (error) { failure = error; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 5000)); }
  }
  if (!passed) throw failure;
  console.log('Release verified. No Feishu business records or messages were created.');
} catch (error) {
  console.error(error.message);
  const current = currentDeployment(await cf('/deployments'));
  if (newVersion && current.versions[0].version_id === newVersion) {
    await cf('/deployments', { strategy: 'percentage', versions: baseline.versions,
      annotations: { 'workers/message': 'Restore previous version after ER2 release verification failed' } });
    const restored = currentDeployment(await cf('/deployments'));
    if (restored.versions[0].version_id !== baseline.versions[0].version_id) throw new Error('Rollback version could not be confirmed');
    await health(); console.error('Previous production version restored and core health verified.');
  } else if (current.id !== baseline.id) {
    console.error('Active version cannot be attributed to this release. No unrelated deployment was overwritten; manual review required.');
  }
  process.exitCode = 1;
} finally { writeFileSync(buildPath, original); }
