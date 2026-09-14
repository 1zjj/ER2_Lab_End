import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app = readFileSync(new URL('../app.js',import.meta.url),'utf8');
const form = app.slice(app.indexOf('  async function openBackfillDialog('),app.indexOf('  function openReportDialog('));
const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.match(form,/dialog.className = 'modal'/);
for (const name of ['modal-head','kicker','form-body','form-error','modal-actions','button button-secondary','button button-primary','icon-button']) {
  assert.ok(form.includes('class="'+name+'"'), name);
  assert.ok(html.includes('class="'+name+'"'), 'Shared weekly style '+name);
}
assert.match(form,/rows="/);
assert.match(form,/placeholder="/);
assert.match(form,/querySelectorAll\('\[data-cancel\]'\)/);
assert.match(form,/error.hidden = false/);
console.log('PASS backfill uses current-week modal layout, inputs, actions and both close controls');
