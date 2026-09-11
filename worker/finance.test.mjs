import assert from 'node:assert/strict';
import { financeActor,financeAccess,validateDocument,devicePayload,monthlySummary,EQUIPMENT,SOURCE,canView,requireReview } from './src/finance-policy.js';
import { executeFinance,processFinanceJobs,prepareFinanceReminders,reconcileExternalDeletions } from './src/finance.js';
import { financeService } from './src/finance-feishu.js';
const people=[['P-001','教授','ou_pi','PI',['管理员']],['P-002','代审','ou_admin','RA',['管理员']],['P-003','申报人','ou_student','博士',[]],['P-004','财务','ou_finance','RA',['财务']],['P-005','其他管理员','ou_other','RA',['管理员']]].map(([id,name,sub,kind,duties])=>({record_id:'rec'+id,fields:{'人员编号':id,'姓名':name,'飞书成员':[{id:sub}],'人员状态':'在组','人员边界':'团队内','成员类别':kind,'系统职责':duties}}));
const env={FINANCE_REVIEWER_PERSON_ID:'P-004',FINANCE_DELEGATE_PERSON_IDS:'P-002',FINANCE_PROFESSOR_PERSON_ID:'P-001',FRONTEND_URL:'https://example.test/'};
class Storage{
 data=new Map();async get(k){return Array.isArray(k)?new Map(k.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))])):structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){return this.data.delete(k);}async list({prefix='',startAfter='',limit=1000}={}){return new Map(structuredClone([...this.data].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a<b?-1:1).slice(0,limit)));}async setAlarm(){}async transaction(fn){const old=structuredClone(this.data);try{return await fn(this);}catch(e){this.data=old;throw e;}}
}
const context=sub=>{const actor=financeActor(people,sub);return {actor,people,access:financeAccess(actor,people,env)};};
const storage=new Storage();await storage.put('settings',{ready:true,equipmentBinding:EQUIPMENT,equipmentVerified:EQUIPMENT});
const fields=[['文本',1],['联络人',1],['数量',1],['采购价格（单价）',2],['采购日期',5],['采购经办人',11],['采购进度',3],['已报销',3]].map(([field_name,type])=>({field_name,type,property:{options:[{name:'完成采购'},{name:'是'}]}}));
let assets=0;const service={equipmentMatches:async d=>d.lines.map((l,index)=>({index,name:l.name,records:[]})),privateAcl:async()=>({externalAccess:false,linkSharing:'closed'}),equipment:{obj_token:'equipment'},target:EQUIPMENT,list:async()=>fields,inventory:async(d,s)=>{for(let i=0;i<d.lines.length;i++)if(!await s.get('asset:'+d.id+':'+i)){assets++;await s.put('asset:'+d.id+':'+i,{recordId:'recasset'+assets});}return true;},mirror:async()=>{}};
const run=(sub,path,body)=>executeFinance(new Request('https://worker.test/api/finance'+path,body?{method:'POST',body:JSON.stringify(body)}:{}),env,storage,async()=>context(sub),async()=>service).then(r=>r.json());
const purchaseStorage=new Storage();await purchaseStorage.put('settings',{ready:true,equipmentBinding:EQUIPMENT,equipmentVerified:EQUIPMENT});
const purchaseRun=(sub,path,body)=>executeFinance(new Request('https://worker.test/api/finance'+path,body?{method:'POST',body:JSON.stringify(body)}:{}),env,purchaseStorage,async()=>context(sub),async()=>service).then(r=>r.json());
const purchaseBody={kind:'purchase',content:'合成机械臂',estimate:'11526.00',purpose:'合成项目',materials:'',attachmentIds:[],submit:true,requestId:'purchase-review-submit'};
const purchase=await purchaseRun('ou_student','/save',purchaseBody);assert.equal(purchase.document.status,'sent');assert.equal(assets,0);
assert.equal((await purchaseRun('ou_pi','/records?purchaseReview=true')).records[0].id,purchase.document.id);
await assert.rejects(purchaseRun('ou_finance','/records?purchaseReview=true'),e=>e.status===403);
const purchaseApproved=await purchaseRun('ou_pi','/purchase-review',{id:purchase.document.id,revision:1,action:'approve',reason:'',requestId:'purchase-review-approve'});assert.equal(purchaseApproved.document.status,'purchase_approved');assert.equal(assets,0);
assert.equal((await purchaseRun('ou_pi','/records?purchaseReview=true')).records.length,0);assert.equal((await purchaseRun('ou_student','/record?id='+purchase.document.id)).document.reviewedByName,'教授');
const returnedPurchase=await purchaseRun('ou_student','/save',{...purchaseBody,requestId:'purchase-review-return-submit'});
await assert.rejects(purchaseRun('ou_pi','/purchase-review',{id:returnedPurchase.document.id,revision:1,action:'return',reason:'',requestId:'purchase-review-empty-return'}),e=>e.status===400);
assert.equal((await purchaseRun('ou_pi','/purchase-review',{id:returnedPurchase.document.id,revision:1,action:'return',reason:'请补充参数',requestId:'purchase-review-return'})).document.status,'returned');
const ownPurchase=await purchaseRun('ou_pi','/save',{...purchaseBody,requestId:'purchase-review-own-submit'});await assert.rejects(purchaseRun('ou_pi','/purchase-review',{id:ownPurchase.document.id,revision:1,action:'approve',reason:'',requestId:'purchase-review-own-approve'}),e=>e.status===403);
console.log('PASS professor purchase queue, approve/return, notifications queued, self-review denial and no equipment writes');
const deletedStorage=new Storage(),deletedId='EXP-2026-000001',deletedDoc={id:deletedId,kind:'claim',owner:'ou_student',ownerName:'申报人',personId:'P-003',status:'submitted',totalCents:100,updatedAt:new Date().toISOString(),revision:1,attachmentIds:[],lines:[]};
await deletedStorage.put('settings',{ready:true,equipmentBinding:EQUIPMENT,equipmentVerified:EQUIPMENT});await deletedStorage.put('finance:bindings',{purchase:'tblPurchase',claim:'tblClaim',line:'tblLine',log:'tblLog'});await deletedStorage.put('doc:'+deletedId,deletedDoc);await deletedStorage.put('mirror:'+deletedId,{recordId:'recDeleted',revision:1});
const deletionService={finance:{obj_token:'finance'},list:async()=>[]};assert.deepEqual((await reconcileExternalDeletions(deletedStorage,deletionService,true)).deleted,[deletedId]);assert.equal((await deletedStorage.get('doc:'+deletedId)).status,'deleted');assert.ok(await deletedStorage.get('job:cleanup:'+deletedId));
const deletedRows=await executeFinance(new Request('https://worker.test/api/finance/records?all=true'),env,deletedStorage,async()=>context('ou_pi'),async()=>deletionService).then(r=>r.json());assert.equal(deletedRows.records.length,0);
const safeStorage=new Storage();await safeStorage.put('finance:bindings',{purchase:'tblPurchase',claim:'tblClaim'});await safeStorage.put('doc:'+deletedId,deletedDoc);await safeStorage.put('mirror:'+deletedId,{recordId:'recUnknown',revision:1});await assert.rejects(reconcileExternalDeletions(safeStorage,{finance:{obj_token:'finance'},list:async()=>{throw Error('incomplete read');}},true));assert.equal((await safeStorage.get('doc:'+deletedId)).status,'submitted');
console.log('PASS explicit Feishu master deletion hides the durable document; incomplete reads never infer deletion');
const draft={kind:'claim',lines:[{name:'传感器',quantity:'2',unitPrice:'99.50',purchaseDate:'2026-08-25',contact:'合成供应商 / 测试联系人'}],requestId:'finance-valid-request',submit:true};
assert.equal(context('ou_finance').access.canReview,true);assert.equal(context('ou_other').access.canReview,false);assert.equal(context('ou_pi').access.canReview,false);assert.equal(context('ou_admin').access.canReview,true);
assert.equal(context('ou_pi').access.canReviewPurchase,true);for(const sub of ['ou_student','ou_finance','ou_admin','ou_other'])assert.equal(context(sub).access.canReviewPurchase,false);
for(const sub of ['ou_student','ou_finance','ou_admin','ou_other']){
  assert.equal(context(sub).access.canSummary,false,'monthly spending is reserved for the configured professor');
  await assert.rejects(run(sub,'/summary?month=2026-08'),e=>e.status===403);
}
assert.equal(context('ou_pi').access.canSummary,true);
assert.equal(canView(context('ou_finance').actor,context('ou_finance').access,{owner:'ou_student',kind:'claim',status:'draft'}),false);
assert.equal(canView(context('ou_finance').actor,context('ou_finance').access,{owner:'ou_student',kind:'purchase',status:'sent'}),false);
assert.equal(canView(context('ou_pi').actor,context('ou_pi').access,{owner:'ou_student',kind:'purchase',status:'sent'}),true);
assert.throws(()=>requireReview(context('ou_finance').actor,context('ou_finance').access,{owner:'previous_finance_account',personId:'P-004'}),e=>e.status===403);
for(const field of ['name','quantity','unitPrice','purchaseDate','contact'])assert.throws(()=>validateDocument({...draft,lines:[{...draft.lines[0],[field]:''}]}));
for(const [field,value]of [['quantity','0'],['quantity','-1'],['unitPrice','3.456'],['purchaseDate','2026-02-30'],['purchaseDate','2099-01-01']])assert.throws(()=>validateDocument({...draft,lines:[{...draft.lines[0],[field]:value}]}));
assert.throws(()=>validateDocument({...draft,owner:'ou_other'}));assert.throws(()=>validateDocument({...draft,lines:[{...draft.lines[0],类型:'其他'}]}));
for(const contact of [17,{},[], 'x'.repeat(501)])assert.throws(()=>validateDocument({...draft,lines:[{...draft.lines[0],contact}]}));
for(const contact of [undefined,null,'','  \t\n ']){
  const body={...draft,lines:[{...draft.lines[0],contact}]};
  assert.throws(()=>validateDocument(body),e=>e.status===400&&e.message==='第1项请填写联络人');
  assert.equal(validateDocument(body,false).lines[0].contact,'','Incomplete claims remain saveable as drafts');
}
assert.throws(()=>validateDocument({...draft,lines:[draft.lines[0],{...draft.lines[0],contact:''}]}),/第2项请填写联络人/);
assert.equal(validateDocument({...draft,lines:[{...draft.lines[0],contact:'  合成店铺  '}]}).lines[0].contact,'合成店铺');
const payload=devicePayload(draft.lines[0],'ou_student',fields);assert.equal(payload['数量'],'2');assert.equal(payload['采购价格（单价）'],99.5);assert.equal(payload['采购进度'],'完成采购');assert.equal(payload['已报销'],'是');assert.deepEqual(payload['采购经办人'],[{id:'ou_student'}]);assert.equal(Object.keys(payload).length,8);assert.equal(payload['联络人'],draft.lines[0].contact);assert.equal(Object.hasOwn(devicePayload({...draft.lines[0],contact:''},'ou_student',fields),'联络人'),false);
const saved=await run('ou_student','/save',draft);assert.equal(saved.document.totalCents,19900);assert.equal(assets,0);assert.deepEqual(await run('ou_student','/save',draft),saved);
await assert.rejects(run('ou_student','/save',{...draft,lines:[{...draft.lines[0],name:'不同'}]}),e=>e.status===409);
assert.equal(saved.document.lines[0].contact,draft.lines[0].contact);
assert.equal((await run('ou_finance','/record?id='+saved.document.id)).document.lines[0].contact,draft.lines[0].contact);
await assert.rejects(run('ou_student','/save',{...draft,lines:[{...draft.lines[0],contact:'另一合成店铺'}]}),e=>e.status===409);
const id=saved.document.id;
for(const sub of ['ou_other','ou_pi']) { assert.equal((await run(sub,'/record?id='+id)).document.id,id); await assert.rejects(run(sub,'/save',{...draft,id,revision:1,requestId:'admin-cannot-edit-others'}),e=>e.status===404); }
assert.equal((await run('ou_pi','/records?all=true')).records.length,1);
await assert.rejects(run('ou_finance','/records?all=true'),e=>e.status===403);
await assert.rejects(run('ou_student','/records?review=true'),e=>e.status===403);
await assert.rejects(run('ou_student','/review',{id,revision:1,action:'approve',requestId:'illegal-self-review'}),e=>e.status===403);
await assert.rejects(run('ou_finance','/review',{id,revision:1,action:'return',reason:'',requestId:'empty-return-reason'}),e=>e.status===400);
const returned=await run('ou_finance','/review',{id,revision:1,action:'return',reason:'请核对单价',requestId:'return-with-reason'});assert.equal(returned.document.status,'returned');assert.equal(assets,0);
const fixed=await run('ou_student','/save',{...draft,id,revision:2,requestId:'finance-resubmit-request'});assert.equal(fixed.document.status,'submitted');
const reviewed=await run('ou_finance','/review',{id,revision:3,action:'approve',requestId:'approve-with-record'});assert.equal(reviewed.document.status,'approved');assert.equal(reviewed.document.lines[0].contact,draft.lines[0].contact);assert.equal(assets,0);
await assert.rejects(run('ou_student','/save',{...draft,id,revision:4,requestId:'edit-approved-record'}),e=>e.status===409);
for(const [k]of storage.data)if(k.startsWith('job:notice'))storage.data.delete(k);
for(let n=0;n<3;n++)await processFinanceJobs(env,storage,async()=>service);assert.equal(assets,1);assert.equal((await run('ou_student','/record?id='+id)).document.status,'completed');
await run('ou_finance','/review',{id,revision:3,action:'approve',requestId:'approve-with-record'});assert.equal(assets,1);
const summary=monthlySummary([reviewed.document,{kind:'purchase',status:'sent',totalCents:500000}], '2026-08');assert.equal(summary.totalCents,19900);
assert.equal((await run('ou_pi','/summary?month=2026-08')).totalCents,19900);
env.FINANCE_PROFESSOR_PERSON_ID='P-005';
await assert.rejects(run('ou_pi','/summary?month=2026-08'),e=>e.status===403);
assert.equal((await run('ou_other','/summary?month=2026-08')).totalCents,19900);
env.FINANCE_PROFESSOR_PERSON_ID='P-001';
people[0].fields['人员状态']='离组';await assert.rejects(run('ou_pi','/summary?month=2026-08'),e=>e.status===403);people[0].fields['人员状态']='在组';
console.log('PASS professor-only monthly summary, direct endpoint denial, reassignment and membership revocation');
people[3].fields['系统职责']=[];await assert.rejects(run('ou_finance','/records?review=true'),e=>e.status===403);
await assert.rejects(run('ou_finance','/review',{id,revision:3,action:'approve',requestId:'approve-with-record'}),e=>e.status===404||e.status===403);
people[3].fields['系统职责']=['财务'];
people[2].fields['人员状态']='离组';await assert.rejects(run('ou_student','/record?id='+id),e=>e.status===403);people[2].fields['人员状态']='在组';
const own=await run('ou_finance','/save',{...draft,requestId:'finance-own-expense'});await assert.rejects(run('ou_finance','/review',{id:own.document.id,revision:1,action:'approve',requestId:'finance-self-approve'}),e=>e.status===403);
await assert.rejects(run('ou_student','/save',{...draft,requestId:'finance-other-attachment',attachmentIds:['not-your-attachment']}),e=>e.status===403);
// Production service enforces the exact permitted tables before any mutation.
const calls=[];const api=await financeService({...env,FINANCE_EQUIPMENT_BINDING:EQUIPMENT},{getTenantToken:async()=>'mock',call:async(path,method='GET',body)=>{calls.push({path,method,body});if(path.startsWith('/wiki/')){const wiki=new URL('https://x'+path).searchParams.get('token');return {data:{node:{obj_type:'bitable',obj_token:wiki===SOURCE.wiki?'source':wiki===EQUIPMENT.wiki?'equipment':'finance',space_id:wiki===SOURCE.wiki?'joey':'er2'}}};}if(path.endsWith('/tables?page_size=100&user_id_type=open_id'))return {data:{items:[],has_more:false}};return {data:{items:[],has_more:false}};}});
await assert.rejects(api.write('source',SOURCE.table,'/records','POST',{}),e=>e.status===403);
await assert.rejects(api.write('equipment','tblMA67apVlRRQbn','/records','POST',{}),e=>e.status===403);
await assert.rejects(api.write('finance','tblLegacy','/records','POST',{}),e=>e.status===403);
await api.sourceSnapshot();assert.equal(calls.filter(c=>c.method!=='GET').length,0);
const reminders=new Storage();await reminders.put('settings',{ready:true,reminders:true,equipmentBinding:EQUIPMENT,equipmentVerified:EQUIPMENT});
await prepareFinanceReminders(Date.parse('2026-09-20T02:00:00Z'),env,reminders,async()=>people);
const firstCount=[...reminders.data.keys()].filter(k=>k.startsWith('job:')).length;assert.equal(firstCount,5);
await prepareFinanceReminders(Date.parse('2026-09-20T02:00:00Z'),env,reminders,async()=>people);assert.equal([...reminders.data.keys()].filter(k=>k.startsWith('job:')).length,firstCount);
await prepareFinanceReminders(Date.parse('2026-09-27T02:00:00Z'),env,reminders,async()=>people);assert.equal([...reminders.data.keys()].filter(k=>k.startsWith('job:')).length,firstCount,'27th only targets outstanding drafts/returns');
await prepareFinanceReminders(Date.parse('2027-01-01T02:00:00Z'),env,reminders,async()=>people);const digest=[...reminders.data.values()].find(v=>v.kind==='monthly'&&v.text.includes('2026-12'));assert.equal(digest.recipient,'ou_pi');
console.log('PASS finance reminder schedules, active recipients, deduplication and year-boundary monthly summary');
console.log('PASS finance required fields, money mapping, private access, self-approval denial, return/resubmit, idempotency, role revocation, attachment ownership and exact write scope');

const failed=await run('ou_student','/save',{...draft,requestId:'failed-inventory-claim'});
await run('ou_finance','/review',{id:failed.document.id,revision:1,action:'approve',requestId:'review-failed-inventory'});
for(const [k]of storage.data)if(k.startsWith('job:notice'))storage.data.delete(k);
await processFinanceJobs(env,storage,async()=>({...service,inventory:async()=>{throw new Error('write interrupted');}}));
assert.equal((await storage.get('doc:'+failed.document.id)).status,'sync_error','failed writes cannot be reported completed');
await assert.rejects(run('ou_finance','/review',{id:failed.document.id,revision:1,action:'approve',requestId:'second-distinct-review'}),e=>e.status===409);
console.log('PASS failed inventory never reports completion and distinct repeat approval is rejected');

// Enforce the new rule at both write boundaries without changing old records on read.
const requiredStorage=new Storage();await requiredStorage.put('settings',{ready:true,equipmentBinding:EQUIPMENT,equipmentVerified:EQUIPMENT});
const requiredRun=(sub,path,body)=>executeFinance(new Request('https://worker.test/api/finance'+path,body?{method:'POST',body:JSON.stringify(body)}:{}),env,requiredStorage,async()=>context(sub),async()=>service).then(r=>r.json());
const noContact={...draft,lines:[{...draft.lines[0],contact:''}],requestId:'missing-required-contact'};
await assert.rejects(requiredRun('ou_student','/save',noContact),e=>e.status===400&&e.message.includes('请填写联络人'));
assert.equal((await requiredStorage.list({prefix:'doc:'})).size,0);
const incomplete=await requiredRun('ou_student','/save',{...noContact,submit:false});
assert.equal(incomplete.document.status,'draft');
const legacy={...incomplete.document,status:'submitted'};await requiredStorage.put('doc:'+legacy.id,legacy);
assert.equal((await requiredRun('ou_finance','/record?id='+legacy.id)).document.lines[0].contact,'');
await assert.rejects(requiredRun('ou_finance','/review',{id:legacy.id,revision:legacy.revision,action:'approve',requestId:'legacy-missing-contact'}),e=>e.status===400&&e.message.includes('请填写联络人'));
assert.deepEqual(await requiredStorage.get('doc:'+legacy.id),legacy);
assert.equal((await requiredStorage.list({prefix:'job:'})).size,0);
console.log('PASS required contact on submission and approval, incomplete drafts and historical record reads');
