import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { checkBindings, checkHealth, currentDeployment } from './release-checks.mjs';

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
  for (const path of ['/api/dashboard', '/api/admin/weekly-source']) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (response.status !== 401) throw new Error('Anonymous access must return 401: ' + path);
  }
  console.log(JSON.stringify({ verifiedCommit: h.release?.commit || null, coreReady: true,
    courseConfigured: h.courseConfigured, aiPaused: h.ai.enabled === false }));
}

const baseline = currentDeployment(await cf('/deployments'));
const settings = await cf('/settings');
checkBindings(settings.bindings || []);
const merged = new Map((settings.bindings || []).map(b => [b.name, b]));
for (const [name, text] of Object.entries(config.vars || {})) merged.set(name, { name, type: 'plain_text', text });
checkBindings([...merged.values()]);
await verify('');
if (!apply) { console.log('Read-only preflight passed; no deployment performed.'); process.exit(0); }
if (currentDeployment(await cf('/deployments')).id !== baseline.id) throw new Error('Production changed during preflight; no deployment performed');
const buildPath = new URL('./src/build-info.js', import.meta.url);
const original = readFileSync(buildPath, 'utf8');
let newVersion = '';
try {
  writeFileSync(buildPath, 'export const BUILD_INFO = Object.freeze(' + JSON.stringify({ commit, builtAt: new Date().toISOString() }) + ');\n');
  const deploy = spawnSync('npx', ['--no-install', 'wrangler', 'deploy', '--config', 'wrangler.jsonc', '--keep-vars'],
    { encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
  // Never print runtime bindings or raw CLI logs into the release summary.
  newVersion = deploy.stdout?.match(/Current Version ID:\s*([a-f0-9-]{36})/)?.[1] || '';
  if (deploy.status !== 0 || !newVersion) throw new Error('Wrangler deployment failed or did not return a version ID');
  console.log('Uploaded version: ' + newVersion);
  let passed = false, failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await verify(commit); checkBindings((await cf('/settings')).bindings || []); passed = true; break; }
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
