import assert from 'node:assert/strict';
import { COPY_FIELDS, financeReady, equipmentBinding, verifyEquipmentCopy, copyDigest } from './src/finance-equipment.js';
import { executeFinance } from './src/finance.js';
import { SOURCE,EQUIPMENT } from './src/finance-policy.js';

const types=[1,3,3,1,17,1,2,1,5,3,1,11];
const fields=COPY_FIELDS.map((field_name,i)=>({field_name,type:types[i],is_primary:i===0,...(types[i]===3?{property:{options:[{name:'完成采购',color:1},{name:'是',color:2}, {color:3}]}}:{})}));
const row={record_id:'recSource',fields:{'文本':[{text:'仪器'}],'数量':'2','采购价格（单价）':99.5,'采购日期':Date.parse('2026-08-25'),'图片':[{file_token:'sourcePhoto',name:'photo.jpg',size:123}],'采购经办人':[{id:'ou_student',name:'申报人'}]}};
const source={app:'source',table:SOURCE.table,fields:[...fields.slice(0,8),{field_name:'父记录',type:18},...fields.slice(8)],records:[row]};
const target={app:'copy',table:'tblCopy',fields:structuredClone(fields),records:[{record_id:'recCopy',fields:{...structuredClone(row.fields),'文本':'仪器','图片':[{file_token:'copyPhoto',name:'photo.jpg',size:123}]}}]};
const service={target:{wiki:'CopyWiki',table:'tblCopy'},equipment:{obj_token:'copy'},sourceSnapshot:async()=>structuredClone(source),snapshot:async()=>structuredClone(target),privateAcl:async()=>({externalAccess:false,linkSharing:'closed'})};
const original=JSON.stringify(source);
const proof=await verifyEquipmentCopy(service,'ou_admin');assert.equal(proof.count,1);assert.equal(proof.fields,12);assert.equal(proof.images,1);assert.equal(JSON.stringify(source),original);
for(const mutate of [s=>s.records.push(structuredClone(s.records[0])),s=>s.records[0].fields['数量']='3',s=>s.records[0].fields['图片'][0].size=124,s=>s.fields.reverse(),s=>s.fields[1].property.options[0].color=8]){
  const bad=structuredClone(target);mutate(bad);await assert.rejects(verifyEquipmentCopy({...service,snapshot:async()=>bad},'ou_admin'),e=>e.status===409);
}
const reused=structuredClone(target);reused.records[0].fields['图片'][0].file_token='sourcePhoto';await assert.rejects(verifyEquipmentCopy({...service,snapshot:async()=>reused},'ou_admin'),e=>e.status===409);
assert.equal(financeReady({ready:true}),false);assert.equal(financeReady({ready:true,equipmentBinding:service.target,equipmentVerified:proof}),true);
assert.deepEqual(equipmentBinding('https://team.feishu.cn/wiki/CopyWiki?table=tblCopy'),service.target);
for(const url of ['https://evil.test/wiki/CopyWiki?table=tblCopy','https://team.feishu.cn/wiki/CopyWiki','https://team.feishu.cn/wiki/'+SOURCE.wiki+'?table='+SOURCE.table,'https://team.feishu.cn/wiki/'+EQUIPMENT.wiki+'?table='+EQUIPMENT.table])assert.throws(()=>equipmentBinding(url));

class Storage { data=new Map();async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async list({prefix=''}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}async transaction(fn){return fn(this);}async setAlarm(){} }
const storage=new Storage();await storage.put('migration',{status:'running',phase:'media',cursor:0});
const actor={sub:'ou_admin',personId:'P-002',name:'管理员'},access={canConfigure:true,reviewerReady:true};
const people=[{record_id:'pi',fields:{'人员编号':'P-001','姓名':'教授','飞书成员':[{id:'ou_pi'}],'人员状态':'在组','人员边界':'团队内','成员类别':'PI','系统职责':['管理员']}}];
const call=body=>executeFinance(new Request('https://work.test/api/finance/setup',{method:'POST',body:JSON.stringify(body)}),{},storage,async()=>({actor,access,people}),async env=>{if(env.FINANCE_EQUIPMENT_BINDING)assert.deepEqual(env.FINANCE_EQUIPMENT_BINDING,service.target);return service;});
const bind={action:'bind-equipment',equipmentUrl:'https://team.feishu.cn/wiki/CopyWiki?table=tblCopy',nativeEquipmentPermissionsVerified:true};
await assert.rejects(call({...bind,nativeEquipmentPermissionsVerified:false}));
for(const action of ['migration-start','migration-step'])await assert.rejects(call({action}),e=>e.status===409);
await call(bind);assert.equal((await storage.get('migration')).status,'superseded');assert.equal((await storage.get('settings')).ready,false);
await storage.put('finance:bindings',{purchase:'tblP',claim:'tblC',line:'tblL',log:'tblA'});
await assert.rejects(call({action:'activate'}),e=>e.status===409);
target.records[0].fields['数量']='9';await assert.rejects(call({action:'activate',nativePermissionsVerified:true}),e=>e.status===409);target.records[0].fields['数量']='2';
await call({action:'activate',nativePermissionsVerified:true,reminders:false});assert.equal(financeReady(await storage.get('settings')),true);
await assert.rejects(call(bind),e=>e.status===409);
assert.equal(await copyDigest(target),proof.digest);
console.log('PASS native copy field/data/image verification, source immutability, private target binding, retired migration denial and activation gates');
