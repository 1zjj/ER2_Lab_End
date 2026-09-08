import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { financeActor,financeAccess } from './src/finance-policy.js';
const source=readFileSync(new URL('../finance.js',import.meta.url),'utf8');
const dom=new JSDOM('<main id="root"></main><section id="weekly">周报原文</section>',{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;w.AbortSignal=AbortSignal;
const requests=[];let fail=false,review=false;w.fetch=async(url,options)=>{requests.push({url,options});if(fail)throw Error('offline');return {ok:true,status:200,json:async()=>({ready:true,statuses:{draft:'草稿'},pending:2,access:{canSubmit:true,canReview:review,canConfigure:false}})};};
w.eval(source);w.document.querySelector('#root').innerHTML=w.ER2Finance.card();const ui=w.ER2Finance.create({apiBase:'https://api.test',getSession:()=>'session',getProfile:()=>({personId:'P-003',name:'申报人'})});await ui.mount();
assert.equal(w.document.querySelector('[data-finance="review"]'),null);
w.document.querySelector('[data-finance="claim"]').click();let form=w.document.querySelector('[data-finance-form]');assert.deepEqual([...form.querySelectorAll('[data-line] input')].map(i=>i.name),['name','quantity','unitPrice','purchaseDate']);assert.equal(form.querySelectorAll('[data-line] input[required]').length,4);
assert.doesNotMatch(form.textContent,/类型|主要参数|存放地点|联络人|父记录/);assert.ok(form.querySelector('[data-finance-upload]'));assert.equal(form.reportValidity(),false);
w.document.querySelector('[data-finance="add-line"]').click();assert.equal(w.document.querySelectorAll('[data-line]').length,2);
w.document.querySelector('[data-finance="close"]').click();review=true;await ui.mount();assert.match(w.document.querySelector('[data-finance="review"]').textContent,/审核 · 2/);
fail=true;await ui.mount();assert.match(w.document.querySelector('#root').textContent,/暂时无法载入/);assert.equal(w.document.querySelector('#weekly').textContent,'周报原文');
assert.ok(requests.every(r=>r.url.startsWith('https://api.test/api/finance')));dom.window.close();console.log('PASS finance form four required device fields, optional materials, reviewer-only button and failure isolation');

const people=[['P-001','ou_pi',['管理员']],['P-002','ou_delegate',['管理员']],['P-003','ou_student',[]],['P-004','ou_finance',['财务']],['P-005','ou_admin',['管理员']]].map(([id,sub,duties])=>({record_id:'rec'+id,fields:{'人员编号':id,'姓名':sub,'飞书成员':[{id:sub}],'人员状态':'在组','人员边界':'团队内','成员类别':id==='P-001'?'PI':'博士','系统职责':duties}}));
const env={FINANCE_PROFESSOR_PERSON_ID:'P-001',FINANCE_REVIEWER_PERSON_ID:'P-004',FINANCE_DELEGATE_PERSON_IDS:'P-002'};
for(const sub of ['ou_pi','ou_student','ou_finance','ou_delegate','ou_admin']){
  const actor=financeActor(people,sub),access=financeAccess(actor,people,env);
  const roleDom=new JSDOM('<main></main>',{url:'https://example.test/',runScripts:'outside-only'}),v=roleDom.window,urls=[];
  v.AbortSignal=AbortSignal;v.HTMLDialogElement.prototype.showModal=function(){this.open=true;};v.HTMLDialogElement.prototype.close=function(){this.open=false;};
  v.fetch=async url=>{urls.push(url);return {ok:true,status:200,json:async()=>url.includes('/summary?')?{totalCents:12300,pendingCents:0,syncIssues:0,items:[]}:{ready:true,pending:0,access}};};
  v.eval(source);v.document.querySelector('main').innerHTML=v.ER2Finance.card();
  await v.ER2Finance.create({apiBase:'https://api.test',getSession:()=>'test-session',getProfile:()=>({personId:actor.personId})}).mount();
  const root=v.document.querySelector('[data-finance-card-actions]');
  assert.equal(Boolean(root.querySelector('[data-finance="summary"]')),sub==='ou_pi',sub+' monthly button');
  assert.equal(Boolean(root.querySelector('[data-finance="review"]')),['ou_finance','ou_delegate'].includes(sub),sub+' review button');
  assert.equal(Boolean(root.querySelector('[data-finance="setup"]')),['ou_pi','ou_delegate','ou_admin'].includes(sub),sub+' configuration button');
  for(const action of ['purchase','claim','records'])assert.ok(root.querySelector('[data-finance="'+action+'"]'));
  if(sub==='ou_pi'){
    root.querySelector('[data-finance="summary"]').click();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(urls.filter(url=>url.includes('/summary?')).length,1);
    assert.match(v.document.querySelector('[data-finance-summary]').textContent,/123\.00/);
  }else{
    for(const action of ['summary','load-summary']){
      const stale=v.document.createElement('button');stale.dataset.finance=action;root.append(stale);stale.click();
    }
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(urls.filter(url=>url.includes('/summary?')).length,0,'unauthorized or stale controls do not open the summary');
    assert.equal(v.document.querySelector('dialog'),null);
  }
  roleDom.window.close();
}
console.log('PASS professor-only monthly UI and actions; student, finance, delegate and administrator permissions preserved');
