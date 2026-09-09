import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const settle = async predicate => { for (let i=0;i<100;i++) { if (predicate()) return; await new Promise(r=>setTimeout(r,2)); } throw Error('UI did not settle'); };
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };
const profile={sub:'fixture',personId:'P-001',name:'合成用户',roles:['student','teacher','manager']};
const week={id:'2026-W37',label:'合成周次',dueLabel:'周五18:00'};
const weekly={profile,week,student:{report:{status:'pending',label:'未提交',revision:'',values:{}},history:[]},teacher:{students:[],stats:{submitted:0,missing:0,blocked:0}}};
const bootstrap={progressive:true,profile,week,student:{...weekly.student,course:{lessons:[]},tasks:[],links:[],projects:[]},teacher:{...weekly.teacher,commonIssues:[],courseReview:{visible:false}},manager:{stats:{members:4,projects:null,courses:1},automations:[]},literature:null,catalog:[],moduleErrors:{},moduleLoading:{weekly:true,projects:true,literature:true,extras:true},capabilities:{courses:{enabled:false}}};
const extras={...bootstrap,moduleErrors:{},catalog:[],student:{...bootstrap.student,tasks:[{title:'合成任务',detail:'保留待办',type:'项目'}]}};
const reading={literature:{items:[],mineCount:0,minimum:3}};
async function setup({deniedStorage=false,missingScript=false}={}) {
 const errors=[],requests=[],responses=new Map(),pending=new Map();
 const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://fixture.test/#session=fixture-token',runScripts:'outside-only',virtualConsole});const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.scrollTo=()=>{};w.confirm=()=>true;w.AbortSignal=AbortSignal;
 if(deniedStorage)Object.defineProperty(w,'sessionStorage',{get(){throw new w.DOMException('denied','SecurityError');}});
 w.ER2_CONFIG={demo:false,apiBase:'https://api.test',feishuWikiUrl:'https://lcnywl4yrecr.feishu.cn/wiki/fixture'};
 for(const name of ['weekly','projects','literature','extras']) pending.set(name,deferred());
 w.fetch=async (url,options={})=>{
  const u=new URL(url,w.location.href),path=u.pathname+u.search;requests.push({path,method:options.method||'GET',body:options.body});
  assert.ok(['fixture.test','api.test'].includes(u.hostname),'No real network calls');
  let data;
  if(responses.has(path))data=await responses.get(path)(options);
  else if(path==='/data/catalog.json')data=[];
  else if(path==='/api/dashboard/start')data=structuredClone(bootstrap);
  else if(path==='/api/finance')data={ready:true,statuses:{draft:'草稿'},access:{canSubmit:true,canConfigure:true,canReview:true}};
  else if(path==='/api/weekly')data=await pending.get('weekly').promise;
  else if(path==='/api/projects')data=await pending.get('projects').promise;
  else if(path==='/api/literature')data=await pending.get('literature').promise;
  else if(path==='/api/dashboard?section=extras')data=await pending.get('extras').promise;
  else throw Error('Unexpected mocked route '+path);
  return data instanceof Response?data:Response.json(data);
 };
 w.eval(w.document.querySelector('script:not([src])').textContent);
 for(const file of ['draft-store','guide-store','learning-center','finance'])if(!(missingScript&&file==='draft-store'))w.eval(readFileSync(new URL('../'+file+'.js',import.meta.url),'utf8'));
 try{w.eval(source);}catch(e){w.dispatchEvent(new w.ErrorEvent('error',{error:e,message:e.message}));}
 return {w,dom,errors,requests,responses,pending};
}
{
 const {w,dom,errors,requests,responses,pending}=await setup({deniedStorage:true});
 try{
  await settle(()=>!w.document.querySelector('#app-root').hidden);
  assert.equal(w.document.querySelector('#account-name').textContent,'合成用户');
  assert.ok(w.document.querySelector('[data-open-learning-center]'),'Learning available while other reads are pending');
  assert.match(w.document.querySelector('.weekly-home-card').textContent,/正在读取/);
  assert.match(w.document.querySelector('.literature-panel').textContent,/正在读取/);
  pending.get('weekly').resolve(weekly);pending.get('literature').resolve(reading);pending.get('extras').resolve(extras);
  await settle(()=>w.document.querySelector('[data-open-report]')&&w.document.querySelector('[data-open-literature]'));
  assert.match(w.document.querySelector('.home-todos').textContent,/合成任务/);
  assert.match(w.document.querySelector('.project-home-card').textContent,/正在读取/,'A slow project read must not block weekly or literature');
  assert.equal(requests.filter(r=>r.path==='/api/finance').length,1,'Module paints do not multiply finance calls');
  const save=deferred(),refresh=deferred();responses.set('/api/reports',()=>save.promise);responses.set('/api/weekly',()=>refresh.promise);
  w.document.querySelector('[data-open-report]').click();const form=w.document.querySelector('#report-form');
  form.elements.progress.value='第一次提交';form.elements.nextPlan.value='原计划';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await settle(()=>requests.some(r=>r.path==='/api/reports'));
  form.elements.progress.value='等待期间继续输入';form.dispatchEvent(new w.Event('input',{bubbles:true}));
  save.resolve({readBackVerified:true,report:{recordId:'saved',weekId:week.id,values:{progress:'第一次提交',nextPlan:'原计划'},revision:'rev-1'}});
  await settle(()=>!w.document.querySelector('#report-submit').disabled);
  assert.equal(form.elements.progress.value,'等待期间继续输入');assert.equal(w.document.querySelector('#report-dialog').open,true);
  assert.match(w.document.querySelector('#toast').textContent,/已保留/);
  pending.get('projects').resolve(Response.json({message:'synthetic failure'},{status:503}));
  await settle(()=>w.document.querySelector('[data-reload-projects]'));
  responses.set('/api/projects',()=>({projects:[{code:'PRJ-001',title:'合成项目',permission:1,url:'https://lcnywl4yrecr.feishu.cn/wiki/fixture'}],activeCount:1}));
  w.document.querySelector('[data-reload-projects]').click();await settle(()=>w.document.querySelector('.project-home-card a'));
  assert.equal(form.elements.progress.value,'等待期间继续输入');
  // Revocation invalidates every pending result and all role buttons.
  const setupRead=deferred();responses.set('/api/finance/setup',()=>setupRead.promise);
  w.document.querySelector('#report-dialog').close();w.document.querySelector('[data-finance="setup"]').click();
  await settle(()=>requests.some(r=>r.path==='/api/finance/setup'));
  w.dispatchEvent(new w.CustomEvent('er2-session-denied',{detail:{status:403}}));
  setupRead.resolve({settings:{privateMarker:'late-private-setting'}});refresh.resolve(weekly);
  await new Promise(r=>setTimeout(r,5));
  assert.equal(w.document.querySelectorAll('dialog[open]').length,0);
  assert.equal(w.document.querySelectorAll('[data-role]').length,0);
  assert.doesNotMatch(w.document.body.textContent,/late-private-setting/);
  assert.equal(errors.length,0,errors.join('\n'));
 }finally{dom.window.close();}
}
{
 const {w,dom}=await setup({missingScript:true});
 assert.equal(w.document.querySelector('#loading-state').hidden,true);
 assert.equal(w.document.querySelector('#error-state').hidden,false);
 assert.match(w.document.querySelector('#error-title').textContent,/组件未完整/);dom.window.close();
}
{
 const {w,dom,responses,pending,requests}=await setup();
 try{
  pending.get('weekly').resolve(weekly);pending.get('projects').resolve({projects:[],activeCount:0});pending.get('literature').resolve(reading);pending.get('extras').resolve(extras);
  await settle(()=>w.document.querySelector('[data-finance="records"]'));
  const read=deferred();responses.set('/api/finance/records?review=false&page=0',()=>read.promise);
  w.document.querySelector('[data-finance="records"]').click();await settle(()=>requests.some(r=>r.path.startsWith('/api/finance/records')));
  assert.equal(w.document.querySelector('.finance-dialog [data-finance="close"]').disabled,false);
  w.document.querySelector('.finance-dialog [data-finance="close"]').click();read.resolve({records:[],more:false});
  await new Promise(r=>setTimeout(r,5));assert.equal(w.document.querySelector('.finance-dialog').open,false,'Cancelled read cannot reopen dialog');
  responses.set('/api/finance/records?review=false&page=0',()=>Response.json({message:'读取失败'},{status:503}));
  w.document.querySelector('[data-finance="records"]').click();await settle(()=>w.document.querySelector('[data-finance="retry-read"]'));
  assert.doesNotMatch(w.document.querySelector('.finance-dialog').textContent,/正在载入/);
  responses.set('/api/finance/records?review=false&page=0',()=>({records:[],more:false}));
  w.document.querySelector('[data-finance="retry-read"]').click();await settle(()=>w.document.querySelector('.finance-dialog').textContent.includes('暂无记录'));
 }finally{dom.window.close();}
}
console.log('PASS stability UI: progressive modules, blocked storage, missing scripts, independent retries, draft preservation, cancelled finance reads, denial and late responses');

// A feedback response belongs to the submitted report, even after switching students.
{
 const response=deferred(),students=['a','b'].map(id=>({id,currentReport:{recordId:'report-'+id,feedback:''}}));
 let closed=0;
 const context=vm.createContext({DEMO_MODE:false,state:{session:'fixture',activeStudentId:'a',dashboard:{teacher:{students}}},
  elements:{feedbackForm:{reportValidity:()=>true},feedbackSubmit:{},feedbackComment:{value:'甲的建议'},feedbackError:{},studentDetailDialog:{}},
  FormData:class{entries(){return Object.entries({recordId:'report-a',comment:'甲的建议'});}},
  draftKeys:{feedbackRequest:'feedback'},draftScope:()=>week.id,privateDrafts:{get:()=>'',set(){},remove(){}},pendingRequestId:()=>'feedback-fixture',
  request:()=>response.promise,closeDialog:()=>closed++,renderActiveView(){},showToast(){}});
 const start=source.indexOf('  async function submitTeacherFeedback('),end=source.indexOf('  function ',start+15);
 vm.runInContext(source.slice(start,end),context);
 const save=context.submitTeacherFeedback({preventDefault(){}});
 context.state.activeStudentId='b';context.elements.feedbackComment.value='乙的新建议';
 response.resolve({ok:true});await save;
 assert.equal(students[0].currentReport.feedback,'甲的建议');assert.equal(students[1].currentReport.feedback,'');assert.equal(closed,0);
}
console.log('PASS teacher feedback remains attached to its submitted student/report');
