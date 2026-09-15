import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {readFileSync} from 'node:fs';
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),dom=new JSDOM(html,{url:'https://fixture.test',runScripts:'outside-only',virtualConsole:vc}),w=dom.window;
w.indexedDB=indexedDB;w.structuredClone=structuredClone;w.AbortSignal=AbortSignal;w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{};w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){if(!this.open)return;this.open=false;this.dispatchEvent(new w.Event('close'));};
const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>timeout(fn,ms===2000?15:ms);
const profile={sub:'ou_full_draft',personId:'P-002',name:'模拟学生',roles:['student']},week={id:'2026-W38',label:'2026-09-14—2026-09-20'};
let draft={weekId:week.id,revision:0,values:{},notes:[],images:[],scratch:''},cloudSaves=0,formalWrites=0;
const student={report:{status:'pending',label:'未提交',values:{},revision:''},history:[],projects:[],tasks:[],links:[],course:{lessons:[]},backfill:{allowed:true,week:{id:'2026-W37',start:'2026-09-07',end:'2026-09-13'},values:{},revision:''}};
const core={profile,week,student,teacher:{students:[],stats:{},courseReview:{visible:false}},manager:{stats:{},automations:[]},catalog:[],progressive:true,moduleLoading:{weekly:true,projects:true,literature:true},moduleDeferred:{extras:true},moduleErrors:{},capabilities:{weeklyDrafts:{enabled:true},features:{weeklySubmit:true,literatureSubmit:true},courses:{enabled:false}}};
w.fetch=async(input,init={})=>{const url=new URL(input,w.location.href);assert.ok(['fixture.test','worker.test'].includes(url.hostname));
  if(url.pathname==='/data/catalog.json')return Response.json([]);
  if(url.pathname==='/api/dashboard/start')return Response.json(core);
  if(url.pathname==='/api/weekly')return Response.json({profile,week,student,teacher:core.teacher});
  if(url.pathname==='/api/projects')return Response.json({projects:[]});
  if(url.pathname==='/api/literature')return Response.json({literature:{items:[],mineCount:0,minimum:3}});
  if(url.pathname==='/api/weekly-drafts')return Response.json({currentWeek:week,weeks:[]});
  if(url.pathname==='/api/weekly-drafts/week'){
    if(init.method==='PUT'){cloudSaves++;const b=JSON.parse(init.body);draft={...b,revision:draft.revision+1,savedAt:new Date().toISOString()};return Response.json({draft,saved:true});}
    return Response.json({draft,editable:true,currentWeek:week});
  }
  if(url.pathname==='/api/reports'){formalWrites++;const b=JSON.parse(init.body);return Response.json({readBackVerified:true,weekId:b.weekId,report:{recordId:'rec_mock',weekId:b.weekId,values:b,images:[],revision:'new'}});}
  if(url.pathname==='/api/finance')return Response.json({ready:false,access:{}});
  throw Error('Unexpected request '+url.pathname);
};
w.eval(readFileSync(new URL('../config.js',import.meta.url),'utf8'));w.ER2_CONFIG={demo:false,apiBase:'https://worker.test',feishuWikiUrl:'https://fixture.test/wiki'};w.sessionStorage.setItem('er2-session','mock-session');
for(const file of ['draft-store','guide-store','learning-center','finance','weekly-drafts-ui'])w.eval(readFileSync(new URL('../'+file+'.js',import.meta.url),'utf8'));
w.eval(readFileSync(new URL('../app.js',import.meta.url),'utf8'));
const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Client did not settle: '+errors.join(';'));};
try{
  await wait(()=>w.document.querySelector('[data-open-draft]')&&w.document.querySelector('[data-open-report]'));
  w.document.querySelector('[data-open-draft]').click();await wait(()=>w.document.querySelector('[data-note]'));
  assert.equal(cloudSaves,0);const note=w.document.querySelector('[data-note]');note.value='日常问题';note.dispatchEvent(new w.Event('input',{bubbles:true}));await wait(()=>cloudSaves===1);
  w.document.querySelector('.weekly-draft-modal [data-close]').click();
  w.document.querySelector('[data-open-report]').click();await wait(()=>w.document.querySelector('#report-form .weekly-form-draft'));
  const form=w.document.querySelector('#report-form');form.elements.progress.value='正式成果';form.elements.nextPlan.value='计划';form.elements.progress.dispatchEvent(new w.Event('input',{bubbles:true}));
  await wait(()=>cloudSaves>=2);assert.equal(form.querySelector('.weekly-form-draft').previousElementSibling.querySelector('textarea').name,'progress');
  assert.equal(formalWrites,0,'Typing and cloud drafts are not submissions');
  assert.equal(errors.length,0,errors.join(';'));
  console.log('PASS full client: identity-first shell, cloud notebook, daily autosave, current form image area and zero accidental submission');
}finally{dom.window.close();}
