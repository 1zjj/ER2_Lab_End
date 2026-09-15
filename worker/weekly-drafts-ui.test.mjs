import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {readFileSync} from 'node:fs';
const dom=new JSDOM('<body></body>',{url:'https://fixture.test',runScripts:'outside-only'}),w=dom.window;
w.indexedDB=indexedDB;w.IDBKeyRange=IDBKeyRange;w.structuredClone=structuredClone;w.AbortController=AbortController;w.URL.createObjectURL=()=> 'blob:mock';w.URL.revokeObjectURL=()=>{};w.confirm=()=>true;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){if(!this.open)return;this.open=false;this.dispatchEvent(new w.Event('close'));};
const originalTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>originalTimeout(fn,ms===2000?15:ms);
let draft={weekId:'2026-W38',revision:0,values:{},notes:[],images:[],scratch:'',savedAt:null},puts=0,conflict=false;
w.fetch=async(input,init={})=>{const url=new URL(input);assert.equal(url.hostname,'worker.test');
  if(url.pathname==='/api/weekly-drafts')return Response.json({currentWeek:{id:'2026-W38'},weeks:[]});
  assert.equal(url.pathname,'/api/weekly-drafts/week');
  if(init.method==='PUT'){puts++;const b=JSON.parse(init.body);if(conflict)return Response.json({code:'DRAFT_CONFLICT',message:'另一设备已修改',latest:draft},{status:409});assert.equal(b.baseRevision,draft.revision);draft={...b,revision:draft.revision+1,savedAt:new Date().toISOString()};return Response.json({draft,saved:true,currentWeek:{id:'2026-W38'}});}
  return Response.json({draft,editable:true,currentWeek:{id:'2026-W38'}});
};
w.eval(readFileSync(new URL('../weekly-drafts-ui.js',import.meta.url),'utf8'));
let profile={sub:'ou_owner'};const ui=w.ER2WeeklyDrafts.create({apiBase:'https://worker.test',getSession:()=> 'synthetic',getProfile:()=>profile});
const settle=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('UI did not settle');};
try{
  await ui.open();assert.equal(puts,0,'Opening a week does not create an empty cloud draft');
  const scratch=w.document.querySelector('[data-note]');scratch.value='尚未点添加的临时问题';scratch.dispatchEvent(new w.Event('input',{bubbles:true}));
  await settle(()=>draft.scratch==='尚未点添加的临时问题');await settle(()=>w.document.querySelector('[data-draft-status]').textContent.includes('云端已保存'));
  assert.equal((await ui.localGet('ou_owner:2026-W38')).scratch,scratch.value);
  conflict=true;draft={...draft,revision:draft.revision+1,values:{progress:'另一设备的内容'}};
  const progress=w.document.querySelector('[data-value=progress]');progress.value='本机不能丢';progress.dispatchEvent(new w.Event('input',{bubbles:true}));
  await settle(()=>!w.document.querySelector('[data-conflict]').hidden);
  assert.equal(progress.value,'本机不能丢');
  w.document.querySelector('[data-conflict]').click();await settle(()=>w.document.querySelector('[data-value=progress]')?.value==='另一设备的内容');
  const database=await new Promise(resolve=>{const r=indexedDB.open('er2-weekly-private-drafts',1);r.onsuccess=()=>resolve(r.result);});
  const keys=await new Promise(resolve=>{const r=database.transaction('drafts').objectStore('drafts').getAllKeys();r.onsuccess=()=>resolve(r.result);});
  const backup=keys.find(k=>k.includes(':conflict:'));assert.ok(backup);assert.equal((await ui.localGet(backup)).values.progress,'本机不能丢');
  ui.reset();profile={sub:'ou_other'};assert.equal(w.document.querySelector('dialog'),null);
  console.log('PASS cloud draft UI: empty open, scratch autosave, IndexedDB backup, conflict copy/reload, no overwrite and account reset');
}finally{ui.reset();dom.window.close();}
