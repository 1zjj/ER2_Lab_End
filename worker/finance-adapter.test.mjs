import assert from 'node:assert/strict';
import { financeService } from './src/finance-feishu.js';
import { SOURCE,EQUIPMENT,F,devicePayload } from './src/finance-policy.js';
class Storage {
 data=new Map();async get(k){return Array.isArray(k)?new Map(k.filter(x=>this.data.has(x)).map(x=>[x,structuredClone(this.data.get(x))])):structuredClone(this.data.get(k));}
 async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){return this.data.delete(k);}async list({prefix=''}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
}
const fields=[['文本',1],['数量',1],['采购价格（单价）',2],['采购日期',5],['采购经办人',11],['采购进度',3],['已报销',3],['设备名称',1]].map(([field_name,type])=>({field_name,type,property:{options:[{name:'完成采购'},{name:'是'}]}}));
const line={name:'仪器',quantity:'2',unitPrice:'99.50',purchaseDate:'2026-08-25',amountCents:19900};
const claim=(id,n=1)=>({id,kind:'claim',owner:'ou_user',personId:'P-003',ownerName:'申报人',revision:1,status:'approved',attachmentIds:[],materials:'',totalCents:n*19900,lines:Array.from({length:n},(_,i)=>({...line,name:'仪器'+i}))});
async function fixture(){
 const data=new Map(),calls=[],storage=new Storage(),bindings=Object.fromEntries(Object.keys(F).map(k=>[k,'tbl'+k]));let failRead=false,counter=0;
 const call=async(path,method='GET',body)=>{
  const u=new URL('https://mock'+path);calls.push({path,method,body});
  if(u.pathname.startsWith('/wiki/')){const w=u.searchParams.get('token');return {data:{node:{obj_type:'bitable',obj_token:w===SOURCE.wiki?'source':w===EQUIPMENT.wiki?'equipment':'finance',space_id:w===SOURCE.wiki?'joey':'er2'}}};}
  if(u.pathname==='/bitable/v1/apps/finance/tables')return {data:{items:Object.entries(F).map(([k,s])=>({table_id:bindings[k],name:s.name})),has_more:false}};
  const match=u.pathname.match(/^\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/]+)\/(fields|records)(?:\/([^/]+))?$/);assert.ok(match,path);const [,app,table,kind,id]=match;
  if(kind==='fields')return {data:{items:fields,has_more:false}};
  const key=app+':'+table;if(!data.has(key))data.set(key,new Map());const rows=data.get(key);
  if(id==='search'){const condition=body.filter.conditions[0];return {data:{items:[...rows.values()].filter(r=>r.fields[condition.field_name]===condition.value[0]),has_more:false}};}
  if(method==='GET'){if(id){if(failRead){failRead=false;throw Error('interrupted readback');}return {data:{record:structuredClone(rows.get(id))}};}return {data:{items:structuredClone([...rows.values()]),has_more:false}};}
  assert.ok(app==='finance'||app==='equipment'&&table===EQUIPMENT.table,'bounded target');
  if(method==='DELETE'){rows.delete(id);return {data:{}};}
  const row=id?rows.get(id):{record_id:'rec'+ ++counter,fields:{}};assert.ok(row);Object.assign(row.fields,structuredClone(body.fields));rows.set(row.record_id,row);return {data:{record:structuredClone(row)}};
 };
 const service=await financeService({}, {getTenantToken:async()=>'mock',call});
 return {service,data,calls,storage,bindings,failNextRead(){failRead=true;}};
}
const f=await fixture(),d=claim('EXP-LARGE',50);let loops=0;
while(true){const before=f.calls.length,done=await f.service.inventory(d,f.storage);assert.ok(f.calls.length-before<=10,'bounded calls per inventory batch');loops++;if(done)break;assert.ok(loops<20);}
assert.equal(loops,13);assert.equal(f.data.get('equipment:'+EQUIPMENT.table).size,50);const writes=f.calls.filter(c=>c.method==='POST').length;await f.service.inventory(d,f.storage);assert.equal(f.calls.filter(c=>c.method==='POST').length,writes);
const interrupted=await fixture(),one=claim('EXP-INTERRUPTED');interrupted.failNextRead();await assert.rejects(interrupted.service.inventory(one,interrupted.storage));assert.equal((await interrupted.storage.get('asset:EXP-INTERRUPTED:0')).verified,false);await interrupted.service.inventory(one,interrupted.storage);assert.equal(interrupted.data.get('equipment:'+EQUIPMENT.table).size,1,'readback retry never duplicates an asset');
const linked=await fixture(),existing={record_id:'recExisting',fields:{...devicePayload(one.lines[0],one.owner,fields),'已报销':'否','类型':'手工分类','主要参数':'保留参数','图片':[{file_token:'existingphoto'}]}};linked.data.set('equipment:'+EQUIPMENT.table,new Map([[existing.record_id,existing]]));await linked.storage.put('asset:'+one.id+':0',{recordId:existing.record_id,needsUpdate:true});await linked.service.inventory(one,linked.storage);assert.equal(existing.fields['已报销'],'是');assert.equal(existing.fields['设备名称'],one.lines[0].name);assert.equal(existing.fields['主要参数'],'保留参数');assert.equal(existing.fields['类型'],'手工分类');assert.deepEqual(existing.fields['图片'],[{file_token:'existingphoto'}]);assert.equal(linked.calls.filter(c=>c.method==='POST').length,0,'linking an existing device only updates that record');
const expired=await fixture();await expired.storage.put('intent:asset:'+one.id+':0',{startedAt:Date.now()-46*60000,payload:devicePayload(one.lines[0],one.owner,fields)});await assert.rejects(expired.service.inventory(one,expired.storage),e=>e.status===409);assert.equal(expired.calls.filter(c=>c.method==='POST').length,0);
const archive=await fixture(),logs=[{id:'audit-1',documentId:d.id,actor:d.owner,time:'2026-08-26T00:00:00Z',action:'确认已报销',note:''}];loops=0;
while(true){const before=archive.calls.length,done=await archive.service.mirror(d,archive.bindings,archive.storage,logs);assert.ok(archive.calls.length-before<=13,'bounded calls per mirror batch');loops++;if(done)break;assert.ok(loops<10);}
assert.equal(archive.data.get('finance:tblclaim').size,1);assert.equal(archive.data.get('finance:tblline').size,50);assert.equal(archive.data.get('finance:tbllog').size,1);const before=archive.calls.filter(c=>c.method==='POST').length;await archive.service.mirror(d,archive.bindings,archive.storage,logs);assert.equal(archive.calls.filter(c=>c.method==='POST').length,before);
// An old ambiguous archive retry adopts the unique receipt rather than creating again.
await archive.storage.delete('mirror:'+d.id);await archive.storage.put('archive-intent:mirror:'+d.id,{startedAt:Date.now()-46*60000});await archive.service.mirror(d,archive.bindings,archive.storage,logs);assert.equal(archive.data.get('finance:tblclaim').size,1);assert.ok(archive.calls.some(c=>c.path.includes('/records/search')));
console.log('PASS finance adapter bounded 50-item batches, exact inventory readback, interrupted-write recovery, existing-asset preservation, expired-create protection and archive recovery');
