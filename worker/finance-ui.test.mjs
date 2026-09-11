import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { financeActor,financeAccess,validateDocument } from './src/finance-policy.js';
const source=readFileSync(new URL('../finance.js',import.meta.url),'utf8');
const dom=new JSDOM('<main id="root"></main><section id="weekly">周报原文</section>',{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;w.AbortSignal=AbortSignal;
const requests=[];let fail=false,review=false;w.fetch=async(url,options)=>{requests.push({url,options});if(fail)throw Error('offline');return {ok:true,status:200,json:async()=>({ready:true,capabilities:{lineContact:true},statuses:{draft:'草稿'},pending:2,access:{canSubmit:true,canReview:review,canConfigure:false}})};};
w.eval(source);w.document.querySelector('#root').innerHTML=w.ER2Finance.card();const ui=w.ER2Finance.create({apiBase:'https://api.test',getSession:()=>'session',getProfile:()=>({personId:'P-003',name:'申报人'})});await ui.mount();
assert.equal(w.document.querySelector('[data-finance="review"]'),null);
w.document.querySelector('[data-finance="claim"]').click();let form=w.document.querySelector('[data-finance-form]');assert.deepEqual([...form.querySelectorAll('[data-line] input')].map(i=>i.name),['name','quantity','unitPrice','purchaseDate','contact']);assert.equal(form.querySelectorAll('[data-line] input[required]').length,5);
assert.doesNotMatch(form.textContent,/类型|主要参数|存放地点|父记录/);assert.ok(form.querySelector('[data-finance-upload]'));assert.equal(form.reportValidity(),false);assert.equal(form.querySelector('[name=contact]').required,true);
w.document.querySelector('[data-finance="add-line"]').click();assert.equal(w.document.querySelectorAll('[data-line]').length,2);
w.document.querySelector('[data-finance="close"]').click();review=true;await ui.mount();assert.match(w.document.querySelector('[data-finance="review"]').textContent,/审核 · 2/);
fail=true;await ui.mount();assert.match(w.document.querySelector('#root').textContent,/暂时无法载入/);assert.equal(w.document.querySelector('#weekly').textContent,'周报原文');
assert.ok(requests.every(r=>r.url.startsWith('https://api.test/api/finance')));dom.window.close();console.log('PASS finance form five required fields, optional materials, reviewer-only button and failure isolation');

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
  assert.equal(Boolean(root.querySelector('[data-finance="purchase-review"]')),sub==='ou_pi',sub+' purchase review button');
  assert.equal(Boolean(root.querySelector('[data-finance="review"]')),['ou_finance','ou_delegate'].includes(sub),sub+' review button');
  assert.equal(Boolean(root.querySelector('[data-finance="all-records"]')),access.canViewAll,sub+' all records button');
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
  if(access.canViewAll){
    v.fetch=async url=>{urls.push(url);return {ok:true,status:200,json:async()=>({records:[],more:false})};};
    root.querySelector('[data-finance="all-records"]').click();await new Promise(resolve=>setImmediate(resolve));
    assert.match(v.document.querySelector('dialog').textContent,/全部单据/);
    v.document.querySelector('dialog [data-finance="all-records"]').click();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(urls.filter(url=>url.includes('&all=true')).length,2,'refresh keeps the all-records scope');
  }
  roleDom.window.close();
}
console.log('PASS professor-only monthly UI and actions; student, finance, delegate and administrator permissions preserved');

const purchaseDom=new JSDOM('<main></main>',{url:'https://example.test/',runScripts:'outside-only'}),p=purchaseDom.window;
p.AbortSignal=AbortSignal;p.confirm=()=>true;p.HTMLDialogElement.prototype.showModal=function(){this.open=true;};p.HTMLDialogElement.prototype.close=function(){this.open=false;};
let purchaseRecord={id:'PUR-2026-000002',kind:'purchase',owner:'ou_student',ownerName:'朱俊杰',personId:'P-002',status:'sent',revision:1,content:'机械臂',estimate:1152600,totalCents:1152600,purpose:'Voxposer项目',materials:'',attachmentIds:[]};const purchaseRequests=[];
p.fetch=async(input,options={})=>{const url=new URL(input);purchaseRequests.push({url:url.href,options});let data;
  if(url.pathname==='/api/finance')data={ready:true,purchasePending:1,statuses:{sent:'待教师确认',purchase_approved:'已同意购买'},capabilities:{lineContact:true,purchaseReview:true},access:{canSubmit:true,canReviewPurchase:true,canSummary:true,canViewAll:true}};
  else if(url.pathname.endsWith('/records'))data={records:[purchaseRecord],more:false};
  else if(url.pathname.endsWith('/record'))data={document:purchaseRecord,attachments:[],history:[]};
  else if(url.pathname.endsWith('/purchase-review')){const body=JSON.parse(options.body);assert.equal(body.action,'approve');purchaseRecord={...purchaseRecord,status:'purchase_approved',revision:2,reviewedByName:'教授'};data={saved:true,document:purchaseRecord};}
  else throw Error('Unexpected route '+url.pathname);return {ok:true,status:200,json:async()=>data};};
p.eval(source);p.document.querySelector('main').innerHTML=p.ER2Finance.card();await p.ER2Finance.create({apiBase:'https://api.test',getSession:()=>'professor-session',getProfile:()=>({personId:'P-001',name:'教授'})}).mount();
p.document.querySelector('[data-finance="purchase-review"]').click();await new Promise(resolve=>setImmediate(resolve));assert.ok(purchaseRequests.some(r=>r.url.includes('purchaseReview=true')));p.document.querySelector('[data-finance="detail"]').click();await new Promise(resolve=>setImmediate(resolve));
assert.match(p.document.querySelector('dialog').textContent,/教师确认/);assert.equal(p.document.querySelector('[name="content"]').disabled,true);p.document.querySelector('[data-finance="purchase-approve"]').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(purchaseRecord.status,'purchase_approved');assert.ok(purchaseRequests.some(r=>r.url.endsWith('/purchase-review')));purchaseDom.window.close();
console.log('PASS professor purchase queue, read-only detail and explicit approval UI');

// Run the real form through draft, submission and reviewer detail rendering.
// The old-server case verifies that a rollout never sends unsupported fields.
const settled=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,2));}throw Error('Finance UI did not settle');};
for(const supported of [true,false]){
  const fixture=new JSDOM('<main></main>',{url:'https://fixture.test/',runScripts:'outside-only'}),v=fixture.window;
  v.AbortSignal=AbortSignal;v.confirm=()=>true;
  v.HTMLDialogElement.prototype.showModal=function(){this.open=true;};v.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let personId='P-003',record=null;const writes=[];
  const contact='合成店铺 "A&B" <img src=x onerror=alert(1)>';
  v.fetch=async(input,options={})=>{
    const url=new URL(input);assert.equal(url.hostname,'api.test');let data;
    if(url.pathname==='/api/finance')data={ready:true,pending:0,statuses:{draft:'草稿',submitted:'待财务审核'},...(supported?{capabilities:{lineContact:true}}:{}),access:{canSubmit:true,canReview:personId==='P-004'}};
    else if(url.pathname.endsWith('/save')){
      const body=JSON.parse(options.body);writes.push(body);
      record={...validateDocument(body,supported&&body.submit),id:'EXP-2026-000001',personId:'P-003',ownerName:'合成申报人',revision:(record?.revision||0)+1,status:body.submit?'submitted':'draft'};
      data={saved:true,document:record};
    }else if(url.pathname.endsWith('/records'))data={records:[record],more:false};
    else if(url.pathname.endsWith('/record'))data={document:record,attachments:[],history:[]};
    else throw Error('Unexpected route '+url.pathname);
    return {ok:true,status:200,json:async()=>data};
  };
  try{
    v.eval(source);v.document.querySelector('main').innerHTML=v.ER2Finance.card();
    const ui=v.ER2Finance.create({apiBase:'https://api.test',getSession:()=>'fixture-token',getProfile:()=>({personId,name:'合成用户'})});await ui.mount();
    v.document.querySelector('[data-finance="claim"]').click();v.document.querySelector('[data-finance="add-line"]').click();
    [...v.document.querySelectorAll('[data-line]')].forEach((row,index)=>{
      const values={name:'合成设备'+index,quantity:'1',unitPrice:'12.30',purchaseDate:'2026-09-01',...(supported?{contact:index?'另一合成联系人':contact}:{})};
      for(const [key,value]of Object.entries(values))row.querySelector('[name="'+key+'"]').value=value;
    });
    if(supported){
      const second=v.document.querySelectorAll('[name=contact]')[1];second.value='';
      v.document.querySelector('[data-finance-form]').dispatchEvent(new v.Event('submit',{bubbles:true,cancelable:true}));
      await new Promise(r=>setImmediate(r));
      assert.equal(writes.length,0,'Every line requires a contact before submitting');
      second.value='另一合成联系人';
    }
    v.document.querySelector('[data-finance="draft"]').click();
    await settled(()=>v.document.querySelector('[data-finance-message]')?.textContent==='草稿已保存。');
    assert.equal(Object.hasOwn(writes[0].lines[0],'contact'),supported);
    if(supported){
      assert.deepEqual(record.lines.map(line=>line.contact),[contact,'另一合成联系人']);
      assert.equal(v.document.querySelector('[name=contact]').value,contact);
      assert.equal(v.document.querySelector('dialog img'),null,'Contact remains text after redisplay');
    }
    v.document.querySelector('[data-finance-form]').dispatchEvent(new v.Event('submit',{bubbles:true,cancelable:true}));
    await settled(()=>record?.status==='submitted'&&v.document.querySelector('[data-finance-message]')?.textContent.includes('已提交'));
    assert.equal(record.totalCents,2460,'Contact cannot affect totals');
    assert.equal(Object.hasOwn(writes[1].lines[1],'contact'),supported);
    personId='P-004';await ui.mount();v.document.querySelector('[data-finance="review"]').click();
    await settled(()=>v.document.querySelector('[data-finance="detail"]'));
    v.document.querySelector('[data-finance="detail"]').click();await settled(()=>v.document.querySelector('[data-finance-form]'));
    if(supported){assert.equal(v.document.querySelector('[name=contact]').value,contact);assert.equal(v.document.querySelector('[name=contact]').disabled,true);}
    assert.equal(writes.length,2,'Viewing contact never approves or changes a financial document');
  }finally{fixture.window.close();}
}
console.log('PASS per-line contact draft/save/readback, safe text, reviewer visibility and compatibility with an older backend');
