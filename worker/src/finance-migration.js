import { authError } from './authorization.js';
import { DEVICE_FIELDS,EQUIPMENT,SOURCE,legacyDeviceName } from './finance-policy.js';

// This journal is private Durable Object storage. No inventory data is bundled
// into the public website or committed to the source repository.
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(value)))))].map(x=>x.toString(16).padStart(2,'0')).join('');
// Signed image URLs and user avatars can change on every API read. Compare the
// durable business values so an expiring download URL cannot block migration.
const snapshotHash=s=>hash({fields:s.fields,records:[...s.records].sort((a,b)=>a.record_id.localeCompare(b.record_id)).map(r=>({record_id:r.record_id,fields:Object.fromEntries(s.fields.map(f=>{
  const v=r.fields[f.field_name];return [f.field_name,f.type===17?(v||[]).map(a=>({file_token:a.file_token,name:a.name,size:a.size})):f.type===11?(v||[]).map(a=>({id:a.id})):f.type===18||f.type===21?links(v):v];
}))}))});
async function saveSnapshot(storage,key,snapshot){
  const digest=await snapshotHash(snapshot);
  for(const record of snapshot.records)await storage.put(key+':record:'+record.record_id,record);
  await storage.put(key,{app:snapshot.app,table:snapshot.table,fields:snapshot.fields,recordIds:snapshot.records.map(r=>r.record_id),hash:digest});
  const saved=await readSnapshot(storage,key);if(await snapshotHash(saved)!==digest)throw authError(409,'备份回读校验失败，未修改设备');
}
async function readSnapshot(storage,key){const h=await storage.get(key);if(!h)throw authError(409,'迁移备份不存在');const rows=await storage.get(h.recordIds.map(id=>key+':record:'+id));const records=h.recordIds.map(id=>rows.get(key+':record:'+id));if(records.some(r=>!r))throw authError(409,'迁移备份不完整');return {...h,records};}
export function links(value){
  if(value==null)return [];
  if(Array.isArray(value))return value.flatMap(links);
  if(typeof value==='string'&&/^rec[A-Za-z0-9]+$/.test(value))return [value];
  if(typeof value==='object'){
    if(Array.isArray(value.record_ids))return links(value.record_ids);
    if(Array.isArray(value.link_record_ids))return links(value.link_record_ids);
    if(typeof value.record_id==='string')return links(value.record_id);
    if(typeof value.id==='string')return links(value.id);
  }
  throw authError(409,'父记录关联格式需要核对，未修改设备');
}
export function fieldDefinition(f){
  if(![1,2,3,4,5,7,11,15,17,18].includes(f.type))throw authError(409,'暂不支持自动迁移此源字段类型：'+f.field_name);
  const property={};for(const k of ['formatter','date_formatter','multiple','currency_code'])if(f.property?.[k]!==undefined)property[k]=f.property[k];
  if(f.type===5)property.auto_fill=false;
  if([3,4].includes(f.type))property.options=(f.property?.options||[]).map(o=>({name:o.name,...(o.color!==undefined?{color:o.color}:{})}));
  if(f.type===18){if(f.property?.table_id!==SOURCE.table)throw authError(409,'源表关联了其他数据表，需先核对复制范围');property.table_id=EQUIPMENT.table;}
  return {field_name:f.field_name,type:f.type,...(f.ui_type?{ui_type:f.ui_type}:{}),...(Object.keys(property).length?{property}:{})};
}
function text(value){return Array.isArray(value)?value.map(v=>typeof v==='string'?v:v.text||'').join(''):String(value??'');}
async function mappedFields(record,fields,storage,withLinks){const out={};
  for(const f of fields){const value=record.fields[f.field_name];if(value==null)continue;
    if(f.type===18){if(withLinks){out[f.field_name]=[];for(const id of links(value)){const mapped=await storage.get('migration:record:'+id);if(!mapped?.id)throw authError(409,'父记录映射不完整');out[f.field_name].push(mapped.id);}}continue;}
    if(f.type===17){out[f.field_name]=[];for(const file of value){const copied=await storage.get('migration:media:'+file.file_token);if(!copied?.fileToken)throw authError(409,'图片资料尚未复制完整');out[f.field_name].push({file_token:copied.fileToken});}}
    else if(f.type===11)out[f.field_name]=value.map(v=>({id:v.id}));
    else if(f.type===1)out[f.field_name]=text(value);
    else out[f.field_name]=value;
  }return out;
}
function normalized(value,type){if(type===1)return text(value);if(type===17)return(value||[]).map(f=>f.file_token).sort();if(type===11)return(value||[]).map(f=>f.id).sort();if(type===18)return links(value).sort();if(type===4)return(value||[]).slice().sort();if(value==null)return null;return value;}
export async function verifyMigratedRecord(source,target,fields,storage){const expected=await mappedFields(source,fields,storage,true);
  for(const f of fields){const a=normalized(expected[f.field_name],f.type),b=normalized(target.fields?.[f.field_name],f.type);if(JSON.stringify(stable(a))!==JSON.stringify(stable(b)))throw authError(409,'设备复制回读不一致：'+f.field_name+'；源记录 '+source.record_id);}
}

export async function startMigration(service,storage,actor,{nativeDependenciesVerified=false}={}){
  const previous=await storage.get('migration');if(previous)return previous;
  if(!nativeDependenciesVerified)throw authError(409,'先核实设备原生工作流及需要保留的字段，再启动迁移');
  const source=await service.sourceSnapshot(),target=await service.snapshot(service.equipment.obj_token,EQUIPMENT.table);
  if(source.records.length<1)throw authError(409,'源表为空，未进行设备替换');
  if(source.fields.length!==DEVICE_FIELDS.length||DEVICE_FIELDS.some(name=>!source.fields.some(f=>f.field_name===name)))throw authError(409,'源表字段与已确认的13项不一致，请重新核对');
  source.fields.forEach(fieldDefinition);const primary=source.fields.filter(f=>f.is_primary);if(primary.length!==1||primary[0].field_name!=='文本')throw authError(409,'源表名称索引字段不匹配');
  if(target.fields.filter(f=>f.is_primary).length!==1)throw authError(409,'目标索引字段不匹配');
  for(const f of source.fields){const existing=target.fields.find(t=>t.field_name===f.field_name);
    if(existing&&(existing.type!==f.type||f.type===18&&existing.property?.table_id!==EQUIPMENT.table))throw authError(409,'同名字段与原有设备功能不兼容，未修改字段：'+f.field_name);
  }
  const sourceIds=new Set(source.records.map(r=>r.record_id));
  for(const r of source.records)for(const f of source.fields.filter(f=>f.type===18))for(const id of links(r.fields[f.field_name]))if(!sourceIds.has(id))throw authError(409,'父记录指向源表之外，未进行替换；源记录 '+r.record_id+'，父记录 '+id);
  const other=[];for(const t of await service.list(service.equipment.obj_token,'','/tables')){
    if(t.table_id===EQUIPMENT.table||t.table_id==='tblo6LU7jHulq1gu')continue;
    const s=await service.snapshot(service.equipment.obj_token,t.table_id);
    const oldIds=new Set(target.records.map(r=>r.record_id));
    const references=s.fields.filter(f=>f.property?.table_id===EQUIPMENT.table);
    if(oldIds.size&&s.records.some(r=>references.some(f=>[18,21].includes(f.type)?links(r.fields[f.field_name]).some(id=>oldIds.has(id)):r.fields[f.field_name]!=null)))throw authError(409,'旧设备记录仍被 '+t.name+' 引用；为保护其他功能，迁移已停止');
    other.push({table:t.table_id,hash:await snapshotHash(s)});
  }
  await saveSnapshot(storage,'migration:source',source);await saveSnapshot(storage,'migration:before',target);
  const files=[...new Map(source.records.flatMap(r=>source.fields.filter(f=>f.type===17).flatMap(f=>(r.fields[f.field_name]||[]))).map(f=>[f.file_token,f])).values()];
  if(files.some(f=>!f.file_token||!f.name||!Number.isFinite(f.size)||f.size>20*1024*1024))throw authError(409,'源表存在无法直接复制的附件，未进行替换');
  const migration={id:crypto.randomUUID(),status:'running',phase:'media',cursor:0,sourceCount:source.records.length,oldCount:target.records.length,files,other,actor:actor.personId,startedAt:new Date().toISOString(),sourceHash:await snapshotHash(source),nativeDependenciesVerified:true};
  await storage.put('settings',{...(await storage.get('settings')||{}),ready:false});await storage.put('migration',migration);return migration;
}

export async function migrationStep(service,storage){
  const m=await storage.get('migration');if(!m)throw authError(409,'请先启动带备份的迁移');if(m.status==='completed')return m;
  const source=await readSnapshot(storage,'migration:source'),before=await readSnapshot(storage,'migration:before');const app=service.equipment.obj_token;
  if(app!==before.app||before.table!==EQUIPMENT.table)throw authError(409,'设备目标发生变化，迁移已停止');
  const advance=phase=>{m.phase=phase;m.cursor=0;};
  if(m.phase==='media'){
    for(let end=Math.min(m.cursor+2,m.files.length);m.cursor<end;m.cursor++){
      const file=m.files[m.cursor],key='migration:media:'+file.file_token;if(await storage.get(key))continue;
      const response=await service.download(file.file_token),blob=await response.blob();if(blob.size!==file.size)throw authError(409,'源图片大小核对不一致');
      const copy=await service.uploadEquipmentMedia(new File([blob],file.name,{type:blob.type}));await storage.put(key,copy);
    }if(m.cursor===m.files.length)advance('schema');
  }else if(m.phase==='schema'){
    if(!m.schemaStarted){const current=await service.snapshot(app,EQUIPMENT.table);if(await snapshotHash(current)!==before.hash)throw authError(409,'设备主表在备份后发生变化，未开始替换');
      if(await snapshotHash(await service.sourceSnapshot())!==m.sourceHash)throw authError(409,'源表在复制准备期间发生变化，未开始替换');
      m.schemaStarted=true;await storage.put('migration',m);
    }
    // Existing field IDs, primary keys and workflow/view dependencies survive.
    // Only missing source columns/options are added; no field is deleted/retyped.
    const current=await service.list(app,EQUIPMENT.table,'/fields');let actions=0;
    for(const f of source.fields){const found=current.find(t=>t.field_name===f.field_name);
      if(!found){await service.write(app,EQUIPMENT.table,'/fields','POST',fieldDefinition(f));if(++actions>=6)break;}
      else if(found.type!==f.type)throw authError(409,'设备字段在迁移中发生变化：'+f.field_name);
      else if([3,4].includes(f.type)){
        const oldOptions=found.property?.options||[],missing=(f.property?.options||[]).filter(o=>!oldOptions.some(old=>old.name===o.name));
        if(missing.length){await service.write(app,EQUIPMENT.table,'/fields/'+found.field_id,'PUT',{field_name:found.field_name,type:found.type,property:{...found.property,options:[...oldOptions,...missing.map(({name,color})=>({name,color}))]}});if(++actions>=6)break;}
      }
    }
    if(actions===0)advance('records');
  }else if(m.phase==='records'){
    for(let end=Math.min(m.cursor+5,source.records.length);m.cursor<end;m.cursor++){
      const row=source.records[m.cursor],key='migration:record:'+row.record_id;if(await storage.get(key))continue;
      const intentKey='migration:intent:'+row.record_id;let intent=await storage.get(intentKey);if(!intent){intent={time:Date.now()};await storage.put(intentKey,intent);}if(Date.now()-intent.time>45*60000)throw authError(409,'复制记录的写入结果待核对，已停止重复创建');
      const values={...await mappedFields(row,source.fields,storage,false),...legacyDeviceName(text(row.fields['文本']),before.fields)};
      const record=await service.putRecord(app,EQUIPMENT.table,values,'',m.id+':'+row.record_id);await storage.put(key,{id:record.record_id});
    }if(m.cursor===source.records.length)advance('parents');
  }else if(m.phase==='parents'){
    for(let end=Math.min(m.cursor+5,source.records.length);m.cursor<end;m.cursor++){
      const row=source.records[m.cursor],mapped=await storage.get('migration:record:'+row.record_id),fields=await mappedFields(row,source.fields,storage,true),parentFields=Object.fromEntries(source.fields.filter(f=>f.type===18&&Object.hasOwn(fields,f.field_name)).map(f=>[f.field_name,fields[f.field_name]]));
      if(Object.keys(parentFields).length)await service.putRecord(app,EQUIPMENT.table,parentFields,mapped.id,m.id+':parent:'+row.record_id);
      await verifyMigratedRecord(row,await service.getRecord(app,EQUIPMENT.table,mapped.id),source.fields,storage);
    }if(m.cursor===source.records.length)advance('remove-old');
  }else if(m.phase==='remove-old'){
    // Source copy is complete and verified before old dummy records are removed.
    const present=new Set((await service.list(app,EQUIPMENT.table,'/records')).map(r=>r.record_id));
    for(let end=Math.min(m.cursor+8,before.records.length);m.cursor<end;m.cursor++){const old=before.records[m.cursor];if(present.has(old.record_id))await service.write(app,EQUIPMENT.table,'/records/'+old.record_id,'DELETE');}
    if(m.cursor===before.records.length)advance('verify');
  }else if(m.phase==='verify'){
    if(await snapshotHash(await service.sourceSnapshot())!==m.sourceHash)throw authError(409,'源表在迁移期间有新变动，请核对后完成验收');
    const target=await service.snapshot(app,EQUIPMENT.table);if(target.records.length!==source.records.length||source.fields.some(f=>!target.fields.some(t=>t.field_name===f.field_name&&t.type===f.type)))throw authError(409,'复制后的记录数或源字段不一致');
    if(before.fields.some(f=>!target.fields.some(t=>t.field_id===f.field_id&&t.field_name===f.field_name&&t.type===f.type&&t.is_primary===f.is_primary)))throw authError(409,'原有设备字段结构发生变化，请核对');
    const records=new Map(target.records.map(r=>[r.record_id,r]));for(const row of source.records){const mapped=await storage.get('migration:record:'+row.record_id);await verifyMigratedRecord(row,records.get(mapped.id),source.fields,storage);}
    for(const t of m.other)if(await snapshotHash(await service.snapshot(app,t.table))!==t.hash)throw authError(409,'其他设备业务表在迁移期间发生变化，请核对，未修改这些表');
    m.status='completed';m.completedAt=new Date().toISOString();advance('completed');
  }else throw authError(409,'迁移阶段不明确，请核对备份');
  await storage.put('migration',m);return m;
}
