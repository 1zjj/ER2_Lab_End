import { getTenantToken, feishuRequest, stableMessageUuid } from './index.js';
import { authError, text } from './authorization.js';
import { SOURCE, EQUIPMENT, FINANCE_WIKI, F, devicePayload, legacyDeviceName } from './finance-policy.js';

const enc=encodeURIComponent;
export async function financeService(env, injected={}) {
  const target=env.FINANCE_EQUIPMENT_BINDING || EQUIPMENT;
  if(!/^[A-Za-z0-9]+$/.test(target.wiki||'')||!/^tbl[A-Za-z0-9]+$/.test(target.table||''))throw authError(503,'设备绑定无效');
  const token=await (injected.getTenantToken||getTenantToken)(env);
  const call=injected.call || ((path,method='GET',body)=>feishuRequest(path,{method,bearer:token,body,strictWeeklyWrite:method==='POST'&&/\/records(?:\?|$)/.test(path)}));
  async function node(wiki){const r=await call('/wiki/v2/spaces/get_node?token='+enc(wiki));const n=r.data?.node;if(n?.obj_type!=='bitable'||!n.obj_token)throw authError(503,'目标不是可访问的多维表格');return n;}
  const finance=await node(FINANCE_WIKI),equipment=await node(target.wiki);
  if(finance.obj_token===equipment.obj_token||finance.space_id!==equipment.space_id)throw authError(503,'预算报销与设备目标绑定不匹配');
  const allowed=new Set([finance.obj_token,equipment.obj_token]);
  function path(app,table='',suffix=''){if(!/^[A-Za-z0-9]+$/.test(app)||table&&!/^tbl[A-Za-z0-9]+$/.test(table))throw authError(503,'数据绑定无效');return '/bitable/v1/apps/'+app+(table?'/tables/'+table:'')+suffix;}
  let financeTables;
  async function write(app,table,suffix,method,body){
    if(!allowed.has(app)||app===equipment.obj_token&&(!env.FINANCE_EQUIPMENT_BINDING||table!==target.table))throw authError(403,'禁止修改ER2预算报销范围之外的数据');
    if(app===finance.obj_token){
      const names=new Set(Object.values(F).map(s=>s.name));
      if(!table){if(suffix!=='/tables'||method!=='POST'||!names.has(body?.table?.name))throw authError(403,'只能创建指定财务表');}
      else{if(!financeTables)financeTables=new Set((await list(app,'','/tables')).filter(t=>names.has(t.name)).map(t=>t.table_id));if(!financeTables.has(table))throw authError(403,'只能修改指定工作台财务表');}
    }
    const result=await call(path(app,table,suffix),method,body);
    if(app===finance.obj_token&&!table&&result.data?.table_id){financeTables=null;}
    return result;
  }
  async function list(app,table,suffix){const items=[],seen=new Set();let page='';do{
    const r=await call(path(app,table,suffix)+'?page_size=100&user_id_type=open_id'+(page?'&page_token='+enc(page):'')),d=r.data;
    // Empty record tables can omit items. Require explicit empty pagination;
    // never interpret an absent payload or failed page as zero equipment.
    const empty=suffix==='/records'&&!page&&d?.items==null&&d.total===0&&d.has_more===false;
    if(!d||!Array.isArray(d.items)&&!empty)throw Object.assign(authError(503,'飞书返回的数据不完整'),{code:'FINANCE_LIST_INCOMPLETE',diagnostic:{resource:suffix,keys:Object.keys(d||{}),itemsType:d?.items===null?'null':typeof d?.items,total:d?.total,hasMore:d?.has_more}});
    items.push(...(d.items||[]));if(d.has_more===false)break;
    if(d.has_more!==true)throw authError(503,'飞书分页状态不完整');
    page=d.page_token;if(!page||seen.has(page))throw authError(503,'飞书分页不完整');seen.add(page);
  }while(true);return items;}
  async function uuid(key){const hex=await stableMessageUuid(key);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20);}
  async function putRecord(app,table,fields,id,op){const r=await write(app,table,'/records'+(id?'/'+enc(id):'')+'?user_id_type=open_id'+(!id?'&client_token='+await uuid(op):''),id?'PUT':'POST',{fields});const record=r.data?.record;if(!record?.record_id)throw authError(503,'飞书写入结果未确认');return record;}
  async function snapshot(app,table){return {app,table,fields:await list(app,table,'/fields'),records:await list(app,table,'/records')};}
  async function getRecord(app,table,id){const r=await call(path(app,table,'/records/'+enc(id))+'?user_id_type=open_id');if(!r.data?.record?.record_id)throw authError(503,'设备读取结果不完整');return r.data.record;}
  async function equipmentMatches(doc){
    const rows=await list(equipment.obj_token,target.table,'/records');
    const text=v=>Array.isArray(v)?v.map(x=>x.text||'').join(''):String(v??'');
    return doc.lines.map((line,index)=>({index,name:line.name,records:rows.filter(r=>{
      const f=r.fields||{};return text(f['文本']).trim()===line.name.trim()&&Number(text(f['数量']))===Number(line.quantity)&&Number(text(f['采购价格（单价）']))===Number(line.unitPrice)&&Number(f['采购日期'])===Date.parse(line.purchaseDate+'T00:00:00+08:00');
    }).map(r=>({id:r.record_id,reimbursed:r.fields['已报销']===true||text(r.fields['已报销'])==='是'}))}));
  }
  async function privateAcl(){
    // Sharing belongs to the wiki node; use its matching token/type pair.
    const r=await call('/drive/v2/permissions/'+enc(FINANCE_WIKI)+'/public?type=wiki');
    const p=r.data?.permission_public || r.data?.permission || r.data;
    // Drive v2 uses an enum; unknown or conflicting values must remain blocked.
    const entity=p?.external_access_entity;
    const externalAccess=entity==='open'||p?.external_access===true?true:
      entity==='closed'||(entity===undefined&&p?.external_access===false)?false:undefined;
    return {externalAccess,linkSharing:p?.link_share_entity,raw:p};
  }
  async function ensureFinanceTables(storage){
    const tables=await list(finance.obj_token,'','/tables');const bindings={};
    for(const [kind,schema] of Object.entries(F)){
      const matches=tables.filter(t=>t.name===schema.name);if(matches.length>1)throw authError(503,'存在同名财务表，请核对后重试');
      let table=matches[0];
      if(!table){const r=await write(finance.obj_token,'','/tables','POST',{table:{name:schema.name,default_view_name:'全部记录',fields:Object.entries(schema.fields).map(([field_name,type])=>({field_name,type}))}});table=r.data;if(!table?.table_id)throw authError(503,'财务表创建结果未确认');tables.push({...table,name:schema.name});}
      const fields=await list(finance.obj_token,table.table_id,'/fields');
      for(const [name,type] of Object.entries(schema.fields)){const f=fields.find(f=>f.field_name===name);if(f&&f.type!==type)throw authError(503,'财务字段类型不一致：'+name);if(!f)await write(finance.obj_token,table.table_id,'/fields','POST',{field_name:name,type});}
      bindings[kind]=table.table_id;await storage.put('finance:bindings',bindings);
    }return bindings;
  }
  async function archiveRecord(table,fields,id,op,storage){
    if(!id){const key='archive-intent:'+op;let intent=await storage.get(key);
      if(!intent){intent={startedAt:Date.now()};await storage.put(key,intent);}
      if(Date.now()-intent.startedAt>45*60000){
        const field=Object.hasOwn(fields,'来源ID')?'来源ID':'操作编号';
        const r=await call(path(finance.obj_token,table,'/records/search')+'?user_id_type=open_id&page_size=2','POST',{filter:{conjunction:'and',conditions:[{field_name:field,operator:'is',value:[fields[field]]}]}});
        if(!Array.isArray(r.data?.items)||r.data.has_more||r.data.items.length!==1)throw authError(409,'财务归档结果需要核对，已停止重复创建');
        id=r.data.items[0].record_id;
      }
    }
    return putRecord(finance.obj_token,table,fields,id,op);
  }
  let contactSchemaTable;
  async function ensureLineContact(table){
    if(contactSchemaTable===table)return;
    let fields=await list(finance.obj_token,table,'/fields');
    if(!fields.some(f=>f.field_name==='联络人')){
      await write(finance.obj_token,table,'/fields','POST',{field_name:'联络人',type:1});
      fields=await list(finance.obj_token,table,'/fields');
    }
    const contacts=fields.filter(f=>f.field_name==='联络人');
    if(contacts.length!==1||contacts[0].type!==1)throw authError(503,'报销明细联络人字段尚未核验为文本字段');
    contactSchemaTable=table;
  }
  async function mirror(doc,bindings,storage,logs=[],limit=10){
    if(doc.kind==='claim'&&doc.lines.some(line=>typeof line.contact==='string'))await ensureLineContact(bindings.line);
    let processed=0;
    const kind=doc.kind;let fields=kind==='purchase'?{'申请编号':doc.id,'申请人':[{id:doc.owner}],'人员编号':doc.personId,'购买内容':doc.content,'预计金额':(doc.estimate||0)/100,'用途':doc.purpose,'资料说明':doc.materials,'系统状态':doc.status,'来源ID':doc.id}:
      {'报销编号':doc.id,'申报人':[{id:doc.owner}],'人员编号':doc.personId,'合计金额':doc.totalCents/100,'处理状态':doc.status,'资料说明':doc.materials,'退回原因':doc.returnReason||'','来源ID':doc.id};
    if(doc.submittedAt)fields['提交时间']=Date.parse(doc.submittedAt);
    if(doc.approvedAt){fields['审核人']=[{id:doc.approvedBy}];fields['审核时间']=Date.parse(doc.approvedAt);}
    const files=await storage.get(doc.attachmentIds.map(id=>'attachment:'+id));
    fields['资料附件']=[...files.values()].map(a=>({file_token:a.fileToken}));
    const old=await storage.get('mirror:'+doc.id);
    const record=await archiveRecord(bindings[kind],fields,old?.recordId,'mirror:'+doc.id,storage);
    await storage.put('mirror:'+doc.id,{recordId:record.record_id,revision:doc.revision});
    if(kind==='claim')for(let i=0;i<doc.lines.length;i++){
      const line=doc.lines[i],key=doc.id+':'+i,prior=await storage.get('line:'+key);
      if(prior?.revision===doc.revision)continue;if(processed++>=limit)return false;
      const f={'明细编号':key,'报销编号':doc.id,'名称':line.name,'数量':Number(line.quantity||0),'采购价格（单价）':Number(line.unitPrice||0),'金额':line.amountCents/100,'来源ID':key,'设备记录ID':(await storage.get('asset:'+key))?.recordId||''};
      if(line.purchaseDate)f['采购日期']=Date.parse(line.purchaseDate+'T00:00:00+08:00');
      if(typeof line.contact==='string')f['联络人']=line.contact;
      const saved=await archiveRecord(bindings.line,f,prior?.recordId,'line:'+key,storage);
      if(Object.hasOwn(f,'联络人')&&text((await getRecord(finance.obj_token,bindings.line,saved.record_id)).fields?.['联络人'])!==f['联络人'])throw authError(503,'报销明细联络人写入结果尚未确认');
      await storage.put('line:'+key,{recordId:saved.record_id,revision:doc.revision});
    }
    // Remove only stale detail rows that this module created for this same draft.
    const oldLines=[...(await storage.list({prefix:'line:'+doc.id+':'})).entries()];
    for(const [key,entry]of oldLines)if(Number(key.split(':').at(-1))>=doc.lines?.length){if(processed++>=limit)return false;await write(finance.obj_token,bindings.line,'/records/'+entry.recordId,'DELETE');await storage.delete(key);}
    for(const entry of logs){const key='audit:'+entry.id;if(await storage.get(key))continue;if(processed++>=limit)return false;
      const saved=await archiveRecord(bindings.log,{'操作编号':entry.id,'单据编号':entry.documentId,'操作人':[{id:entry.actor}],'时间':Date.parse(entry.time),'操作':entry.action,'说明':entry.note,'来源ID':entry.id},'',key,storage);await storage.put(key,{recordId:saved.record_id});
    }
    return true;
  }
  async function inventory(doc,storage,limit=4){
    if(!['approved','sync_error'].includes(doc.status)||!doc.approvedBy||!doc.approvedAt)throw authError(409,'设备入库需要已确认的财务审核记录');
    const fields=await list(equipment.obj_token,target.table,'/fields');let processed=0;
    for(let i=0;i<doc.lines.length;i++){
      const key='asset:'+doc.id+':'+i;let saved=await storage.get(key);if(saved?.target && (saved.target.wiki!==target.wiki||saved.target.table!==target.table))throw authError(409,'设备目标与已有入库记录不一致，已停止处理');if(saved?.verified)continue;if(processed++>=limit)return false;
      const fieldsToWrite={...devicePayload(doc.lines[i],doc.owner,fields),...legacyDeviceName(doc.lines[i].name,fields)};
      const intent='intent:'+key;let operation=await storage.get(intent);
      if(operation?.target && (operation.target.wiki!==target.wiki||operation.target.table!==target.table))throw authError(409,'设备目标与原写入意图不一致，已停止处理');
      if(!operation){operation={target,uuid:await uuid(key),startedAt:Date.now(),payload:fieldsToWrite};await storage.put(intent,operation);}
      // Never repeat an ambiguous create outside Feishu's short deduplication window.
      if(!saved){
        if(Date.now()-operation.startedAt>45*60000)throw authError(409,'设备写入结果需要人工核对，系统已停止重复创建');
        const result=await putRecord(equipment.obj_token,target.table,operation.payload,'',key);
        saved={target,recordId:result.record_id,createdAt:new Date().toISOString(),verified:false};await storage.put(key,saved);
      }
      if(saved.needsUpdate){
        const candidate=(await equipmentMatches({lines:[doc.lines[i]]}))[0].records.find(r=>r.id===saved.recordId);
        if(!candidate)throw authError(409,'待关联设备的采购信息已经变化，已停止自动更新');
        if(candidate.reimbursed&&!saved.updateStarted)throw authError(409,'待关联设备已经报销，请核对是否重复');
        saved.updateStarted=true;await storage.put(key,saved);
        await putRecord(equipment.obj_token,target.table,operation.payload,saved.recordId,key);
        saved.needsUpdate=false;await storage.put(key,saved);
      }
      const record=await getRecord(equipment.obj_token,target.table,saved.recordId);
      const normalize=(value,name)=>name==='采购经办人'?(value||[]).map(v=>v.id).sort().join(','):Array.isArray(value)?value.map(v=>v.text??v).join(''):String(value??'');
      for(const [name,value]of Object.entries(operation.payload))if(normalize(record.fields?.[name],name)!==normalize(value,name))throw authError(409,'设备写入后的字段核验不一致，请财务核对：'+name);
      await storage.put(key,{...saved,target,verified:true});
    }return true;
  }
  async function upload(file){return uploadTo(file,finance.obj_token,false);}
  async function uploadEquipmentMedia(file){return uploadTo(file,equipment.obj_token,true);}
  async function uploadTo(file,parent,migration){
    if(!file||file.size<1||file.size>20*1024*1024)throw authError(400,'每份资料须为1字节至20MB');
    const name=String(file.name||'资料').replace(/[\x00-\x1f/\\]/g,'_').slice(0,150);
    if(!migration&&!/\.(pdf|png|jpe?g|webp|heic|docx?|xlsx?|txt|zip)$/i.test(name))throw authError(400,'请上传PDF、图片、文档、表格或ZIP资料');
    const form=new FormData();form.append('file_name',name);form.append('parent_type','bitable_file');form.append('parent_node',parent);form.append('size',String(file.size));form.append('file',file,name);
    const response=await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all',{method:'POST',headers:{Authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(60000)});
    const r=await response.json();if(!response.ok||r.code!==0||!r.data?.file_token)throw authError(503,'飞书资料上传未成功，请保留原文件后重试');
    return {fileToken:r.data.file_token,name,size:file.size};
  }
  async function download(fileToken){const r=await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/'+enc(fileToken)+'/download',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(60000)});if(!r.ok)throw authError(503,'资料暂时无法下载');return r;}
  async function notify(openId,text,id){return call('/im/v1/messages?receive_id_type=open_id','POST',{receive_id:openId,msg_type:'text',content:JSON.stringify({text}),uuid:await stableMessageUuid('finance:'+id)});}
  return {finance,equipment,target,token,node,list,write,snapshot,getRecord,equipmentMatches,privateAcl,ensureFinanceTables,mirror,inventory,upload,uploadEquipmentMedia,download,notify,putRecord,
    sourceSnapshot:async()=>{const source=await node(SOURCE.wiki);if(allowed.has(source.obj_token)||source.space_id===equipment.space_id)throw authError(503,'来源与ER2目标必须独立');return snapshot(source.obj_token,SOURCE.table);}};
}
