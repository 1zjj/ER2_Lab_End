import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = readFileSync(new URL('../app.js',import.meta.url),'utf8');
const extract = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const dom = new JSDOM('<body></body>');
const {document,FormData} = dom.window;
dom.window.HTMLDialogElement.prototype.showModal = function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close = function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
const stored = new Map(), requests = [], reloads = [];
const state = {session:'s',dashboard:{student:{report:{status:'pending'},backfill:{allowed:true,week:{id:'2026-W37',start:'2026-09-07',end:'2026-09-13'},revision:'',values:{progress:'<img src=x onerror=alert(1)>'}}}}};
const context = vm.createContext({document,FormData,state,crypto,
  escapeHtml:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  privateDrafts:{get:(k,s)=>stored.get(k+s),set:(k,s,v)=>stored.set(k+s,v),remove:(k,s)=>stored.delete(k+s)},
  request:async(path,opts)=>{requests.push({path,body:JSON.parse(opts.body)});return {readBackVerified:true,weekId:'2026-W37'};},
  reloadModule:async name=>reloads.push(name), showToast(){} });
vm.runInContext(extract('  async function openBackfillDialog(', '  function openReportDialog('),context);
await context.openBackfillDialog();
const dialog=document.querySelector('dialog'), form=dialog.querySelector('form');
assert.equal(dialog.querySelector('img'),null);
assert.equal(form.elements.progress.value,'<img src=x onerror=alert(1)>');
form.elements.nextPlan.value='上周制定的计划';
form.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
assert.ok([...stored.keys()].every(k=>k.endsWith('backfill:2026-W37')));
form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
await new Promise(resolve=>setImmediate(resolve));
assert.equal(requests.length,1);assert.equal(requests[0].body.weekId,'2026-W37');
assert.equal(state.dashboard.student.report.status,'pending');
assert.deepEqual(reloads,['weekly']);assert.equal(document.querySelector('dialog'),null);
state.dashboard.student.backfill.allowed=false;
await context.openBackfillDialog();assert.equal(document.querySelector('dialog'),null);
console.log('PASS backfill UI: fixed previous week, escaped content, independent drafts, verified response and no current-week overwrite');
