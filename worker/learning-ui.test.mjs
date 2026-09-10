import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { LEARNING_CATALOG } from './src/learning-catalog.js';
const errors=[];
const console=new VirtualConsole(); console.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM('<!doctype html><form id="weekly"><textarea name="learning">周报原文保持不变</textarea></form>', {url:'https://fixture.invalid/',runScripts:'outside-only',virtualConsole:console});
const w=dom.window,d=w.document;
w.Response=Response;w.AbortSignal=AbortSignal;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
for(const file of ['draft-store.js','learning-center.js']) w.eval(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
let profile={sub:'ou_student',name:'学生甲',personId:'P-003'}, fail=false, slowResolve;
const records=[],events=[],writes=[];
w.fetch=async(url,opts={})=>{
  const path=new URL(url).pathname;
  assert.ok(path.startsWith('/api/learning'),'learning UI cannot call weekly, people or project write routes');
  if(path==='/api/learning')return Response.json({catalog:LEARNING_CATALOG,records,access:{canSubmit:profile.sub!=='ou_professor',canReview:profile.sub==='ou_junjie',canViewAll:profile.sub==='ou_professor'}});
  if(path==='/api/learning/inbox')return Response.json({records,next:'',notificationIssues:[]});
  if(path==='/api/learning/record'){
    if(slowResolve===true) return new Promise(resolve=>{slowResolve=resolve;});
    return Response.json({record:records[0]||null,events,next:0});
  }
  const body=JSON.parse(opts.body);writes.push({path,body});
  if(fail){fail=false;return Response.json({message:'模拟暂时失败'},{status:503});}
  if(path.endsWith('/submit')){records.push({subject:profile.sub,personId:profile.personId,name:profile.name,trackId:body.trackId,lessonId:body.lessonId,count:1,lastKind:'submit'});events.push({seq:1,kind:'submit',author:profile.name,createdAt:new Date().toISOString(),...body});}
  else events.push({seq:events.length+1,kind:path.endsWith('/reply')?'reply':'append',author:profile.name,createdAt:new Date().toISOString(),text:body.text});
  return Response.json({saved:true,records,event:events.at(-1)});
};
const drafts=w.ER2DraftStore.create(w.sessionStorage);drafts.bind(profile.sub);drafts.set('report','2026-W37','保留周报草稿');
const ui=w.ER2LearningCenter.create({apiBase:'https://fixture.invalid',getSession:()=> 'fixture-only',getProfile:()=> profile,drafts,onUnauthorized:()=>ui.reset()});
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timed out: '+d.body.textContent);};
const choose=async()=>{d.querySelector('[data-learning-lesson="A:01"]').click();await wait(()=>d.querySelector('.learning-form'));};
try {
  await ui.open(); assert.equal(d.querySelectorAll('dialog').length,1);assert.equal(d.querySelectorAll('[data-learning-lesson]').length,10);
  assert.equal(d.querySelectorAll('input[type=file]').length,0);await choose();
  assert.equal(d.querySelector('textarea[name=gains]').required,true);assert.equal(d.querySelector('textarea[name=questions]').required,false);assert.equal(d.querySelector('textarea[name=suggestions]').required,false);
  const form=d.querySelector('.learning-form');form.elements.gains.value='<script>不可执行的学生文字</script> 学习收获';form.dispatchEvent(new w.Event('input',{bubbles:true}));
  fail=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>d.querySelector('.learning-form-status').textContent.includes('模拟暂时失败'));
  assert.equal(form.elements.gains.readOnly,true);assert.match(drafts.get('learning','learning-v1:ou_student:A:01:submit'),/pending/);
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>d.querySelector('.learning-history article'));
  assert.equal(writes[0].body.requestId,writes[1].body.requestId,'retry must preserve idempotency key and original body');
  assert.deepEqual(writes[0].body,writes[1].body);assert.equal(d.querySelectorAll('.learning-history script').length,0);
  assert.ok(d.querySelector('.learning-history').textContent.includes('<script>'));
  assert.equal(d.querySelectorAll('textarea[name=gains]').length,0,'saved original is not silently editable');
  assert.equal(d.querySelector('#weekly textarea').value,'周报原文保持不变');assert.equal(drafts.get('report','2026-W37'),'保留周报草稿');
  d.querySelector('[data-learning-close]').click();await ui.open();await choose();assert.ok(d.querySelector('.learning-history').textContent.includes('学习收获'));
  d.querySelector('.learning-form textarea').value='学生追加问题';d.querySelector('.learning-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>d.querySelectorAll('.learning-history article').length===2);
  slowResolve=true;d.querySelector('[data-learning-lesson="A:01"]').click();await wait(()=>typeof slowResolve==='function');
  ui.reset();profile={sub:'ou_other',name:'学生乙'};drafts.bind(profile.sub);slowResolve(Response.json({record:records[0],events,next:0}));await new Promise(r=>setTimeout(r,20));
  assert.equal(d.querySelector('dialog').open,false);assert.equal(d.querySelector('dialog').textContent,'','old account response must not reappear');
  slowResolve=null;profile={sub:'ou_junjie',personId:'P-002',name:'朱俊杰'};drafts.bind(profile.sub);await ui.open(true);
  d.querySelector('[data-inbox-index="0"]').click();await wait(()=>d.querySelector('.learning-form'));
  d.querySelector('.learning-form textarea').value='朱俊杰的回复';d.querySelector('.learning-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>d.querySelectorAll('.learning-history article').length===3);
  assert.equal(writes.at(-1).path,'/api/learning/reply');assert.equal(writes.at(-1).body.subject,'ou_student');
  ui.reset();profile={sub:'ou_professor',personId:'P-001',name:'教授'};drafts.bind(profile.sub);await ui.open(true);
  d.querySelector('[data-inbox-index="0"]').click();await wait(()=>d.querySelector('.learning-history'));assert.equal(d.querySelector('.learning-form'),null,'Professor can read but cannot reply without review duty');
  assert.deepEqual(errors,[]);
  globalThis.console.log('PASS learning modal: ten linked lessons, one required field, text escaping, loss/retry, append-only history, reopen, account switch and reviewer reply; weekly form/draft unchanged');
} finally {dom.window.close();}
