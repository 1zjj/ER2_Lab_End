import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareWeeklyBootstrap } from './release-weekly-bootstrap.mjs';
const original = process.cwd(), root = mkdtempSync(join(tmpdir(), 'er2-bootstrap-test-'));
const next = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
try {
  mkdirSync(join(root, 'worker/src'), { recursive: true });
  const config = { name: 'er2-lab-api', main: 'src/runtime.js', keep_vars: true, vars: { OLD_VAR: 'preserve' } };
  const runtime = 'export default { fetch() { return new Response("existing business behavior"); } };\n';
  writeFileSync(join(root, 'worker/wrangler.jsonc'), JSON.stringify(config));
  writeFileSync(join(root, 'worker/src/runtime.js'), runtime);
  writeFileSync(join(root, 'worker/src/build-info.js'), 'export const BUILD_INFO = {};');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: root });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  process.chdir(join(root, 'worker'));
  const bridge = prepareWeeklyBootstrap(sha, next);
  try {
    assert.deepEqual(bridge.config.vars, config.vars);
    assert.deepEqual(bridge.config.durable_objects, next.durable_objects);
    assert.deepEqual(bridge.config.migrations, next.migrations);
    const text = readFileSync(join(bridge.configPath, '../src/runtime.js'), 'utf8');
    assert.ok(text.startsWith(runtime)); assert.ok(text.includes('export class WeeklyWriteCoordinator'));
    assert.equal((text.match(/existing business behavior/g) || []).length, 1);
    assert.ok(readFileSync(join(bridge.configPath, '../src/build-info.js'), 'utf8').includes(sha));
  } finally { bridge.cleanup(); }
  assert.throws(() => prepareWeeklyBootstrap('invalid', next));
  console.log('PASS migration baseline: checked deployed source, original code and variables retained, compatible unused class added');
} finally { process.chdir(original); rmSync(root, { recursive: true, force: true }); }
