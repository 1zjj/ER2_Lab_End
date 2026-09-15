import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const extract=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const dom=new JSDOM('<body></body>'), w=dom.window;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
const state={session:'same-user',dashboard:{profile:{sub:'ou_mock'},student:{report:{status:'pending'},backfill:{allowed:true,week:{id:'2026-W37',start:'2026-09-07',end:'2026-09-13'},revision:'',values:{}}}}};
let status='processing', posts=0,gets=0,finishPost;
const drafts=new Map();
const context=vm.createContext({state,document:w.document,FormData:w.FormData,crypto,encodeURIComponent,escapeHtml:String,
  privateDrafts:{get:(k,s)=>drafts.get(k+s),set:(k,s,v)=>drafts.set(k+s,v),remove:(k,s)=>drafts.delete(k+s)},
  request:async(path)=>{
    if(path==='/api/reports'){posts++;return new Promise((resolve,reject)=>{finishPost=()=>reject(Object.assign(Error('timeout'),{status:504,code:'REQUEST_TIMEOUT'}));});}
    assert.ok(path.startsWith('/api/reports/status?'));gets++;
    return {status,weekId:'2026-W37',readBackVerified:status==='saved',message:'原请求仍在处理'};
  },showToast(){},reloadModule:async()=>{}});
vm.runInContext(extract('  async function openBackfillDialog(', '  function openReportDialog('),context);
await context.openBackfillDialog();
// Background refresh replaces the object but not the authenticated owner.
state.dashboard=structuredClone(state.dashboard);
let form=w.document.querySelector('form');form.elements.progress.value='模拟正文';form.elements.nextPlan.value='模拟计划';
form.dispatchEvent(new w.Event('submit',{cancelable:true}));
assert.equal(posts,1,'Same-account background replacement no longer silently blocks submit');
assert.equal(form.querySelector('[type=submit]').disabled,true);
assert.match(form.querySelector('[type=submit]').textContent,/正在处理/);
assert.equal(form.querySelector('[role=status]').hidden,false);
finishPost();await new Promise(r=>setImmediate(r));
assert.equal(gets,1);assert.equal(posts,1,'Timeout performs GET, never a second POST');
assert.equal(form.querySelector('[data-check-result]').hidden,false);
assert.equal(form.querySelector('[type=submit]').disabled,true);
assert.ok(drafts.size>0);
// Reopening an uncertain submission must query before writing again.
form.querySelector('[data-cancel]').click();await context.openBackfillDialog();form=w.document.querySelector('form');
assert.equal(form.querySelector('[type=submit]').disabled,true);
status='saved';form.querySelector('[data-check-result]').click();await new Promise(r=>setImmediate(r));
assert.equal(gets,2);assert.equal(posts,1);assert.equal(w.document.querySelector('dialog'),null);
assert.equal(state.dashboard.student.report.status,'pending');assert.equal(drafts.size,0);
dom.window.close();
console.log('PASS recovery UI: visible progress, stale-object repair, timeout GET-only, retained draft, reopen guard and confirmed save');
