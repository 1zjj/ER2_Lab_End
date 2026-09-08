import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Preserve the working weekly coordinator and existing business code as a
// rollback target compatible with the additional finance-only namespace.
export function prepareFinanceBootstrap(commit, next) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw Error('Cannot identify deployed source');
  try { execFileSync('git', ['cat-file', '-e', commit + '^{commit}'], { stdio: 'pipe' }); }
  catch (_) { execFileSync('git', ['fetch', '--no-tags', 'origin', commit], { stdio: 'pipe', timeout: 60000 }); }
  const root = mkdtempSync(join(tmpdir(), 'er2-finance-baseline-'));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  try {
    const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const archive = execFileSync('git', ['-C', repository, 'archive', '--format=tar', commit, 'worker'], { maxBuffer: 16 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', root], { input: archive });
    const configPath = join(root, 'worker/wrangler.jsonc');
    const baseline = JSON.parse(readFileSync(configPath, 'utf8'));
    const bindings = baseline.durable_objects?.bindings || [];
    if (baseline.name !== 'er2-lab-api' || baseline.main !== 'src/runtime.js' || baseline.keep_vars !== true ||
        !bindings.some(b => b.name === 'WEEKLY_WRITES' && b.class_name === 'WeeklyWriteCoordinator') || bindings.some(b => b.name === 'FINANCE_RECORDS'))
      throw Error('Unexpected baseline storage config; no finance migration performed');
    for (const binding of bindings) if (!next.durable_objects.bindings.some(b => JSON.stringify(b) === JSON.stringify(binding)))
      throw Error('Existing storage binding would change');
    if (JSON.stringify(next.migrations.slice(0, baseline.migrations.length)) !== JSON.stringify(baseline.migrations))
      throw Error('Existing storage migration history would change');
    baseline.durable_objects = next.durable_objects; baseline.migrations = next.migrations;
    baseline.vars = { ...baseline.vars, FINANCE_ENABLED: 'false' };
    writeFileSync(configPath, JSON.stringify(baseline, null, 2) + '\n');
    const entry = join(root, 'worker/src/runtime.js');
    if (/FinanceRecords/.test(readFileSync(entry, 'utf8'))) throw Error('Baseline already includes finance storage; inspect deployed binding');
    appendFileSync(entry, '\nexport class FinanceRecords { async fetch() { return new Response("Inactive finance baseline", { status: 503 }); } async alarm() {} }\n');
    writeFileSync(join(root, 'worker/src/build-info.js'), 'export const BUILD_INFO = Object.freeze(' + JSON.stringify({ commit, builtAt: new Date().toISOString(), deploymentKind: 'finance-compatibility-baseline' }) + ');\n');
    return { configPath, config: baseline, cleanup };
  } catch (error) { cleanup(); throw error; }
}
