import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A first DO class migration prevents rollback to a pre-migration version.
// Establish a compatible baseline running the already deployed business code,
// with an unused class export, before activating the new save path.
export function prepareWeeklyBootstrap(commit, nextConfig) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Cannot identify current production source; no migration performed');
  try { execFileSync('git', ['cat-file', '-e', commit + '^{commit}'], { stdio: 'pipe' }); }
  catch (_) { execFileSync('git', ['fetch', '--no-tags', 'origin', commit], { stdio: 'pipe', timeout: 60000 }); }
  const root = mkdtempSync(join(tmpdir(), 'er2-weekly-baseline-'));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  try {
    const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const archive = execFileSync('git', ['-C', repository, 'archive', '--format=tar', commit, 'worker'], { maxBuffer: 16 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', root], { input: archive });
    const configPath = join(root, 'worker/wrangler.jsonc');
    const baseline = JSON.parse(readFileSync(configPath, 'utf8'));
    if (baseline.name !== 'er2-lab-api' || baseline.main !== 'src/runtime.js' || baseline.keep_vars !== true || baseline.durable_objects || baseline.migrations)
      throw new Error('Unexpected baseline config; no migration performed');
    baseline.durable_objects = nextConfig.durable_objects;
    baseline.migrations = nextConfig.migrations;
    writeFileSync(configPath, JSON.stringify(baseline, null, 2) + '\n');
    const entry = join(root, 'worker/src/runtime.js');
    if (/WeeklyWriteCoordinator/.test(readFileSync(entry, 'utf8'))) throw new Error('Baseline already includes the new class; review binding before migration');
    appendFileSync(entry, '\nexport class WeeklyWriteCoordinator { async fetch() { return new Response("Inactive compatibility baseline", { status: 503 }); } }\n');
    writeFileSync(join(root, 'worker/src/build-info.js'), 'export const BUILD_INFO = Object.freeze(' + JSON.stringify({ commit, builtAt: new Date().toISOString(), deploymentKind: 'weekly-compatibility-baseline' }) + ');\n');
    return { configPath, config: baseline, cleanup };
  } catch (error) { cleanup(); throw error; }
}
