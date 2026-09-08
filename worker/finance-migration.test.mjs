import assert from 'node:assert/strict';
import { startMigration,migrationStep } from './src/finance-migration.js';
import { SOURCE,EQUIPMENT,DEVICE_FIELDS } from './src/finance-policy.js';
class Storage{data=new Map();async get(k){return Array.isArray(k)?new Map(k.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))])):structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}}
const types=[1,3,3,1,17,1,2,1,18,5,3,1,11];
const fields=DEVICE_FIELDS.map((field_name,i)=>({field_name,field_id:'fldSource'+i,type:types[i],is_primary:i===0,...(types[i]===18?{property:{table_id:SOURCE.table,multiple:false}}:{}),...([3,4].includes(types[i])?{property:{options:[{name:'完成采购'},{name:'是'},{name:'机器人硬件'}]}}:{})}));
const source={app:'sourceapp',table:SOURCE.table,fields,records:[{record_id:'recParent',fields:{'文本':'底盘','类型':'机器人硬件','采购进度':'完成采购','数量':'1','采购价格（单价）':500,'采购日期':Date.parse('2026-01-01T00:00:00+08:00'),'已报销':'是','图片':[{file_token:'sourceimage',name:'photo.png',size:3}],'采购经办人':[{id:'ou_owner'}]}},{record_id:'recChild',fields:{'文本':'相机','数量':'2','采购价格（单价）':10,'父记录':['recParent']}}]};
function fixture({foreignReference=false,emptyReference=false,failBackup=false}={}){
 const storage=new Storage(),writes=[],target={app:'targetapp',table:EQUIPMENT.table,fields:[{field_name:'设备编号',field_id:'fldOldPrimary',type:20,is_primary:true},{field_name:'错误示例',field_id:'fldOld',type:1},{field_name:'设备名称',field_id:'fldLegacyName',type:1}],records:[{record_id:'recOld',fields:{'设备编号':'DUMMY','错误示例':'不准确'}}]};
 if(failBackup){const put=storage.put.bind(storage);storage.put=(k,v)=>{if(k==='migration:before')throw Error('storage unavailable');return put(k,v);};}
 const other={app:'targetapp',table:'tblOther',fields:foreignReference||emptyReference?[{field_name:'设备',type:18,property:{table_id:EQUIPMENT.table}}]:[],records:foreignReference?[{record_id:'recLoan',fields:{'设备':['recOld']}}]:[]};let counter=0;
 const service={equipment:{obj_token:'targetapp'},sourceSnapshot:async()=>{const copy=structuredClone(source);copy.records[0].fields['图片'][0].tmp_url='https://signed.example/'+crypto.randomUUID();return copy;},snapshot:async(app,table)=>structuredClone(table===EQUIPMENT.table?target:other),
  list:async(app,table,suffix)=>!table?[{table_id:EQUIPMENT.table},{table_id:'tblOther',name:'借还'}]:structuredClone(suffix==='/fields'?target.fields:target.records),
  write:async(app,table,suffix,method,body)=>{assert.equal(app,'targetapp');assert.equal(table,EQUIPMENT.table);writes.push({suffix,method});
    if(suffix.startsWith('/fields/')){const id=suffix.split('/').at(-1),f=target.fields.find(f=>f.field_id===id);assert.ok(f);if(method==='DELETE'){target.fields=target.fields.filter(x=>x!==f);for(const r of target.records)delete r.fields[f.field_name];}else Object.assign(f,structuredClone(body));}
    else if(suffix==='/fields')target.fields.push({...structuredClone(body),field_id:'fldNew'+counter++,is_primary:false});
    else if(suffix.startsWith('/records/')&&method==='DELETE')target.records=target.records.filter(r=>r.record_id!==suffix.split('/').at(-1));else assert.fail('unexpected mutation');return {data:{}};
  },
  putRecord:async(app,table,values,id)=>{assert.equal(app,'targetapp');assert.equal(table,EQUIPMENT.table);writes.push({method:id?'UPDATE_RECORD':'CREATE_RECORD'});let r=id?target.records.find(r=>r.record_id===id):null;if(!r){r={record_id:'recNew'+counter++,fields:{}};target.records.push(r);}Object.assign(r.fields,structuredClone(values));return structuredClone(r);},
  getRecord:async(app,table,id)=>structuredClone(target.records.find(r=>r.record_id===id)),download:async token=>{assert.equal(token,'sourceimage');return new Response('img');},uploadEquipmentMedia:async file=>{assert.equal(file.name,'photo.png');assert.equal(await file.text(),'img');return {fileToken:'copiedimage',name:file.name,size:file.size};}
 };return {storage,service,writes,target,other};
}
const f=fixture(),original=JSON.stringify(source);await assert.rejects(startMigration(f.service,f.storage,{personId:'P-002'}),e=>e.status===409);assert.equal(f.writes.length,0);
await startMigration(f.service,f.storage,{personId:'P-002'},{nativeDependenciesVerified:true});assert.equal(f.writes.length,0,'backups finish before first device mutation');
let m;for(let n=0;n<20;n++){m=await migrationStep(f.service,f.storage);if(m.status==='completed')break;}
assert.equal(m.status,'completed');assert.equal(f.target.records.length,2);assert.ok(DEVICE_FIELDS.every(name=>f.target.fields.some(field=>field.field_name===name)));assert.equal(f.target.fields.find(x=>x.field_id==='fldOldPrimary').field_name,'设备编号');assert.equal(f.target.fields.find(x=>x.field_id==='fldOldPrimary').type,20);assert.ok(f.writes.every(w=>!w.suffix?.startsWith('/fields/')||w.method!=='DELETE'));assert.equal(f.target.records.some(r=>r.record_id==='recOld'),false);
const parent=f.target.records.find(r=>r.fields['文本']==='底盘'),child=f.target.records.find(r=>r.fields['文本']==='相机');assert.equal(parent.fields['设备名称'],'底盘');assert.deepEqual(child.fields['父记录'],[parent.record_id]);assert.deepEqual(parent.fields['图片'],[{file_token:'copiedimage'}]);assert.equal(JSON.stringify(source),original);
const count=f.writes.length;await migrationStep(f.service,f.storage);assert.equal(f.writes.length,count,'completed migration never rewrites manually completed equipment');
assert.equal((await f.storage.get('migration:before:record:recOld')).fields['错误示例'],'不准确');
for(const config of [{foreignReference:true},{failBackup:true}]){const x=fixture(config);await assert.rejects(startMigration(x.service,x.storage,{personId:'P-002'},{nativeDependenciesVerified:true}));assert.equal(x.writes.length,0);assert.equal(x.target.records.length,1);}
const empty=fixture({emptyReference:true});await startMigration(empty.service,empty.storage,{personId:'P-002'},{nativeDependenciesVerified:true});assert.equal(empty.writes.length,0);
console.log('PASS equipment migration backup-before-write, parent remapping, attachment copy, source immutability, field/value readback, other-table protection and retry safety');
