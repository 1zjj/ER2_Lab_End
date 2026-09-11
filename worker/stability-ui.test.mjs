import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildStudentHome} from './src/v2/student-home.js';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const settle = async predicate => { for (let i=0;i<1000;i++) { if (predicate()) return; await new Promise(r=>setTimeout(r,2)); } throw Error('UI did not settle'); };
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };
const profile={sub:'fixture',personId:'P-001',name:'合成用户',roles:['student','teacher','manager']};
const week={id:'2026-W37',label:'合成周次',dueLabel:'周五18:00'};
const weekly={profile,week,student:{report:{status:'pending',label:'未提交',revision:'',values:{}},history:[]},teacher:{students:[],stats:{submitted:0,missing:0,blocked:0}}};
const bootstrap={progressive:true,profile,week,student:{...weekly.student,course:{lessons:[]},tasks:[],links:[],projects:[]},teacher:{...weekly.teacher,commonIssues:[],courseReview:{visible:false}},manager:{stats:{members:4,projects:null,courses:1},automations:[]},literature:null,catalog:[],moduleErrors:{},moduleLoading:{literature:true},moduleDeferred:{extras:true},capabilities:{courses:{enabled:false}}};
const extras={...bootstrap,moduleErrors:{},catalog:[],student:{...bootstrap.student,tasks:[{title:'合成任务',detail:'保留待办',type:'项目'}]}};
const reading={literature:{items:[],mineCount:0,minimum:3}};
const consolidated={...structuredClone(extras),progressive:false,moduleLoading:{},literature:reading.literature};
consolidated.student.home=buildStudentHome(consolidated);
const core=structuredClone(consolidated);
core.progressive=true;core.moduleLoading={literature:true};core.moduleDeferred={extras:true};core.literature=null;core.student.tasks=[];core.student.links=[];
core.student.home=buildStudentHome(core);
async function setup({deniedStorage=false,missingScript=false,collaborator=false}={}) {
 const errors=[],requests=[],responses=new Map(),pending=new Map();
 const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://fixture.test/#session=fixture-token',runScripts:'outside-only',virtualConsole});const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.scrollTo=()=>{};w.confirm=()=>true;w.AbortSignal=AbortSignal;
 if(deniedStorage)Object.defineProperty(w,'sessionStorage',{get(){throw new w.DOMException('denied','SecurityError');}});
 w.eval(readFileSync(new URL('../config.js',import.meta.url),'utf8'));
 w.ER2_CONFIG={demo:false,apiBase:'https://api.test',feishuWikiUrl:'https://lcnywl4yrecr.feishu.cn/wiki/fixture'};
 for(const name of ['weekly','projects','literature','extras']) pending.set(name,deferred());
 w.fetch=async (url,options={})=>{
  const u=new URL(url,w.location.href),path=u.pathname+u.search;requests.push({path,method:options.method||'GET',body:options.body});
  assert.ok(['fixture.test','api.test'].includes(u.hostname),'No real network calls');
  let data;
  if(responses.has(path))data=await responses.get(path)(options);
  else if(path==='/data/catalog.json')data=[];
  else if(path==='/api/bootstrap')data=collaborator==='deep'?{collaborator:true,progressive:true,profile:{sub:'external-deep',personId:'P-902',name:'深度合作教授',roles:['collaborator']},student:{projects:[]},literature:null,catalog:[],moduleErrors:{},moduleLoading:{literature:true},capabilities:{internal:false,features:{learningRead:true,learningSubmit:false,literatureRead:true,literatureSubmit:false}}}:collaborator?{collaborator:true,profile:{sub:'external-fixture',personId:'P-901',name:'合成协作者',roles:['collaborator']},student:{projects:[]},catalog:[],moduleErrors:{}}:structuredClone(core);
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
  pending.get('literature').resolve(reading);pending.get('extras').resolve(extras);
  const complete=structuredClone(consolidated);
  const clientHome=JSON.parse(JSON.stringify(w.ER2BuildStudentHome(complete)));delete clientHome.moduleLoading;
  assert.deepEqual(clientHome,buildStudentHome(complete),'Loaded home summary stays equivalent to the original server model');
  assert.equal(w.document.querySelector('#account-name').textContent,'合成用户');
  assert.ok(w.document.querySelector('[data-open-learning-center]'),'Learning is available after the consolidated read');
  await settle(()=>w.document.querySelector('[data-open-report]')&&w.document.querySelector('[data-open-literature]'));
  w.document.querySelector('[data-load-module="extras"]').click();
  await settle(()=>w.document.querySelector('.home-todos')?.textContent.includes('合成任务'));
  assert.match(w.document.querySelector('.home-todos').textContent,/合成任务/);
  assert.ok(w.document.querySelector('[data-home-action="report"]'),'Original weekly todo button remains');
  assert.ok(w.document.querySelector('[data-home-action="literature"]'),'Original literature todo button remains');
  assert.ok(w.document.querySelector('[data-home-action="project"]'),'Original project todo button remains');
  assert.equal(requests.filter(r=>r.path==='/api/bootstrap').length,1,'The initial page uses one bootstrap request');
  assert.equal(requests.filter(r=>['/api/weekly','/api/projects'].includes(r.path)).length,0,'Core weekly and project reads are not duplicated');
  assert.equal(requests.filter(r=>r.path==='/api/literature').length,1,'Literature hydrates independently');
  assert.equal(requests.filter(r=>r.path==='/api/dashboard?section=extras').length,1,'Non-critical modules hydrate after first paint');
  assert.equal(requests.filter(r=>r.path==='/api/finance').length,1,'The visible finance card loads once');
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
  w.document.querySelector('[data-role="manager"]').click();
  assert.match(w.document.querySelector('#app-root').textContent,/项目总览/);
  w.document.querySelector('[data-role="student"]').click();
  await settle(()=>w.document.querySelector('[data-finance="setup"]'));
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
console.log('PASS stability UI: consolidated loading, blocked storage, missing scripts, draft preservation, cancelled finance reads, denial and late responses');

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

{
 const {w,dom,errors,requests}=await setup({collaborator:true});
 try{
  await settle(()=>!w.document.querySelector('#app-root').hidden);
  assert.match(w.document.querySelector('#app-root').textContent,/项目协作/);
  assert.equal(w.document.querySelector('.finance-card'),null);assert.equal(w.document.querySelector('.literature-panel'),null);
  assert.equal(w.document.querySelector('[data-open-learning-center]'),null);
  assert.deepEqual(requests.filter(r=>r.path.startsWith('/api/')).map(r=>r.path).sort(),['/api/bootstrap']);
  await settle(()=>w.document.querySelector('.project-home-card').textContent.includes('暂无正式分配项目'));
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
 console.log('PASS collaborator UI only requests authorized project modules');
}
{
 const {w,dom,errors,requests,pending}=await setup({collaborator:'deep'});
 try{
  await settle(()=>w.document.querySelector('[data-open-learning-center]'));
  pending.get('literature').resolve({literature:{items:[],mineCount:0,minimum:0,canSubmit:false,targetRequired:false}});
  await settle(()=>w.document.querySelector('.literature-panel')?.textContent.includes('只读参与'));
  assert.match(w.document.querySelector('#app-root').textContent,/合作工作台/);
  assert.equal(w.document.querySelector('[data-open-literature]'),null,'Read-only professor has no literature submit control');
  assert.equal(w.document.querySelector('.finance-card'),null);
  assert.deepEqual(requests.filter(r=>r.path.startsWith('/api/')).map(r=>r.path).sort(),['/api/bootstrap','/api/literature']);
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
 console.log('PASS deep collaborator UI: learning materials and read-only literature without internal modules');
}
