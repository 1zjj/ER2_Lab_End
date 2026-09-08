import { requireSession, getTenantToken, listRecords, json } from './index.js';
import { strictBinding, authError, identity, personNumber } from './authorization.js';
import { readScope } from './read-performance.js';
import { FINANCE_VERSION, FINANCE_STORE, STATUS, EQUIPMENT, SOURCE, DEVICE_FIELDS, financeActor, financeAccess, recipient, requireReview, assertView, editable, requestId, validateDocument, monthlySummary, devicePayload } from './finance-policy.js';
import { financeService } from './finance-feishu.js';
import { startMigration,migrationStep } from './finance-migration.js';

export async function financeContext(request, env) {
  const session=await requireSession(request,env); strictBinding(env,'MEMBERS_TABLE_ID');
  const people=await listRecords(env,await getTenantToken(env),'MEMBERS_TABLE_ID');
  const actor=financeActor(people,session.sub);return {actor,people,access:financeAccess(actor,people,env)};
}
export function financeError(request,env,error){
  const status=Number(error.status)||503;
  if(status>=500)console.error('ER2_FINANCE_ERROR',error.code||error.name);
  return json(request,env,{message:status>=500?'预算与报销暂时无法处理，请保留填写内容后重试。':error.message,code:error.code||'FINANCE_ERROR'},status);
}
export async function routeFinance(request,env){try{
  await requireSession(request,env);
  if(env.FINANCE_ENABLED!=='true'||!env.FINANCE_RECORDS)throw authError(503,'预算与报销尚未启用');
  return await env.FINANCE_RECORDS.get(env.FINANCE_RECORDS.idFromName(FINANCE_STORE)).fetch(request);
}catch(e){return financeError(request,env,e);}}
export async function financeEntries(storage,prefix){const result=[];let cursor='';while(true){const page=[...(await storage.list({prefix,limit:1000,...(cursor?{startAfter:cursor}:{})})).entries()];result.push(...page);if(page.length<1000)return result;cursor=page.at(-1)[0];}}
export const fingerprint=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
const docs=async storage=>(await financeEntries(storage,'doc:')).map(([,d])=>d);
const compact=d=>({id:d.id,kind:d.kind,ownerName:d.ownerName,personId:d.personId,status:d.status,totalCents:d.totalCents,updatedAt:d.updatedAt,revision:d.revision,returnReason:d.returnReason||'',syncError:d.syncError||'',noticeError:d.noticeError||''});
export async function enqueue(storage,key,value){await storage.put('job:'+key,{...value,attempts:0,next:Date.now()});await storage.setAlarm(Date.now()+1000);}
async function log(storage,actor,id,action,note=''){const key='log:'+Date.now()+':'+crypto.randomUUID();await storage.put(key,{id:key,documentId:id,actor:actor.sub,name:actor.name,time:new Date().toISOString(),action,note});}
async function parse(request){const raw=await request.text();if(raw.length>120000)throw authError(413,'单据过长');try{return JSON.parse(raw);}catch(_){throw authError(400,'请求格式无效');}}
function configured(settings){if(!settings?.ready)throw authError(409,'财务权限与设备清单正在准备，请稍后办理');}
async function attachments(storage,doc){const out=[];for(const id of doc.attachmentIds||[]){const a=await storage.get('attachment:'+id);if(a)out.push({id,name:a.name,size:a.size});}return out;}

export async function executeFinance(request,env,storage,contextProvider=financeContext,serviceProvider=financeService){
  env=readScope(env,request);const c=await contextProvider(request,env),{actor,access}=c;
  const url=new URL(request.url),path=url.pathname.slice('/api/finance'.length)||'/';
  const settings=await storage.get('settings')||{};
  if(request.method==='GET'){
    if(path==='/')return json(request,env,{version:FINANCE_VERSION,access,ready:Boolean(settings.ready),statuses:STATUS,
      pending:access.canReview?(await docs(storage)).filter(d=>d.kind==='claim'&&['submitted','sync_error','approved'].includes(d.status)).length:0,
      reminders:settings.reminders||false});
    if(path==='/records'){
      const review=url.searchParams.get('review')==='true';if(review&&!access.canReview)throw authError(403,'没有财务审核权限');
      const page=Math.max(0,Number(url.searchParams.get('page')||0));if(!Number.isSafeInteger(page))throw authError(400,'分页无效');
      const rows=(await docs(storage)).filter(d=>review?d.kind==='claim'&&d.status!=='draft':d.owner===actor.sub&&d.personId===actor.personId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      return json(request,env,{records:rows.slice(page*50,page*50+50).map(compact),more:rows.length>(page+1)*50});
    }
    if(path==='/record'){
      const d=await storage.get('doc:'+url.searchParams.get('id'));assertView(actor,access,d);
      return json(request,env,{document:d,attachments:await attachments(storage,d),history:(await financeEntries(storage,'log:')).map(([,l])=>l).filter(l=>l.documentId===d.id)});
    }
    if(path==='/attachment'){
      const d=await storage.get('doc:'+url.searchParams.get('document'));assertView(actor,access,d);
      const id=url.searchParams.get('id');if(!d.attachmentIds.includes(id))throw authError(404,'资料不存在');
      const a=await storage.get('attachment:'+id);if(!a||a.owner!==d.owner)throw authError(404,'资料不存在');
      const response=await(await serviceProvider(env)).download(a.fileToken),headers=new Headers(json(request,env,{}).headers);
      headers.set('Content-Type','application/octet-stream');headers.set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(a.name));
      return new Response(response.body,{headers});
    }
    if(path==='/summary'){
      if(!access.canSummary)throw authError(403,'没有查看财务汇总的权限');return json(request,env,monthlySummary(await docs(storage),url.searchParams.get('month')||''));
    }
    if(path==='/equipment-check'){
      const d=await storage.get('doc:'+url.searchParams.get('id'));assertView(actor,access,d);requireReview(actor,access,d);
      if(d.kind!=='claim'||d.status!=='submitted')throw authError(409,'仅待审核报销单需要核对设备');
      return json(request,env,{matches:await(await serviceProvider(env)).equipmentMatches(d)});
    }
    if(path==='/setup'){
      if(!access.canConfigure)throw authError(403,'仅管理员可配置预算与报销');
      return json(request,env,{settings,access,inspection:await storage.get('inspection'),migration:await storage.get('migration'),jobs:(await financeEntries(storage,'job:')).map(([key,j])=>({key,attempts:j.attempts,error:j.error||'',next:j.next}))});
    }
    throw authError(404,'财务接口不存在');
  }
  if(request.method!=='POST')throw authError(405,'不支持此操作');
  if(path==='/setup')return setup(request,env,storage,c,settings,serviceProvider);
  configured(settings);
  if(path==='/upload'){
    if(!access.canSubmit)throw authError(403,'当前成员不能提交报销');
    const id=requestId(request.headers.get('X-Request-ID'));
    const prior=await storage.get('attachment:'+id);if(prior){if(prior.owner!==actor.sub||prior.personId!==actor.personId)throw authError(409,'上传标识不可重复使用');return json(request,env,{id,name:prior.name,size:prior.size});}
    const count=await storage.get('uploads:'+actor.sub)||{since:Date.now(),count:0};if(Date.now()-count.since>86400000){count.since=Date.now();count.count=0;}if(count.count>=100)throw authError(429,'今日上传数量已达上限');
    const form=await request.formData(),file=form.get('file');if(!(file instanceof File))throw authError(400,'请选择资料');
    const service=await serviceProvider(env);await checkPrivacy(service);
    const saved=await service.upload(file);await storage.put('attachment:'+id,{...saved,owner:actor.sub,personId:actor.personId,createdAt:new Date().toISOString()});await storage.put('uploads:'+actor.sub,{...count,count:count.count+1});
    return json(request,env,{id,name:saved.name,size:saved.size});
  }
  const body=await parse(request),rid=requestId(body.requestId),key='request:'+actor.sub+':'+rid;
  const hash=await fingerprint({path,body}),old=await storage.get(key);if(old){
    if(old.hash!==hash)throw authError(409,'同一请求标识的内容发生变化，请先查看已保存记录');
    if(old.result.document){assertView(actor,access,old.result.document);if(['/review','/retry'].includes(path))requireReview(actor,access,old.result.document);}
    return json(request,env,old.result);
  }
  let result;
  if(path==='/save'){
    if(!access.canSubmit)throw authError(403,'当前成员不能提交报销');
    const d=validateDocument(body,body.submit===true);let prior=body.id?await storage.get('doc:'+body.id):null;
    if(body.id){assertView(actor,{...access,canReview:false},prior);if(!editable(prior)||prior.kind!==d.kind)throw authError(409,'这张单据已锁定，不能修改');if(body.revision!==prior.revision)throw authError(409,'记录已更新，请先重新打开核对');}
    for(const id of d.attachmentIds){const a=await storage.get('attachment:'+id);if(!a||a.owner!==actor.sub||a.personId!==actor.personId)throw authError(403,'资料归属不匹配');}
    if(d.purchaseId){const p=await storage.get('doc:'+d.purchaseId);if(!p||p.owner!==actor.sub||p.kind!=='purchase')throw authError(400,'只能关联本人的采购申请');}
    if(body.submit&&!access.reviewerReady)throw authError(409,'财务负责人尚未配置，暂不能提交');
    if(body.submit&&d.kind==='purchase')recipient(c.people,env.FINANCE_PROFESSOR_PERSON_ID||'P-001');
    result=await storage.transaction(async tx=>{
      const year=new Date().getUTCFullYear(),counterKey='counter:'+d.kind+':'+year;
      let id=prior?.id;if(!id){const n=(await tx.get(counterKey)||0)+1;await tx.put(counterKey,n);id=(d.kind==='claim'?'EXP':'PUR')+'-'+year+'-'+String(n).padStart(6,'0');}
      const now=new Date().toISOString(),doc={...d,id,owner:actor.sub,ownerName:actor.name,personId:actor.personId,createdAt:prior?.createdAt||now,updatedAt:now,revision:(prior?.revision||0)+1,status:body.submit?(d.kind==='claim'?'submitted':'sent'):'draft',...(body.submit?{submittedAt:now}:{})};
      await tx.put('doc:'+id,doc);const result={saved:true,document:doc};
      await log(tx,actor,id,body.submit?'提交':'保存草稿');
      if(body.submit){await enqueue(tx,'mirror:'+id,{kind:'mirror',id});await enqueue(tx,'notice:submit:'+id+':'+doc.revision,{kind:'submitted',id,revision:doc.revision});}
      await tx.put(key,{hash,result});return result;
    });
  }else if(path==='/review'){
    if(Object.keys(body).some(k=>!['id','revision','action','reason','requestId','equipmentDecisions','duplicateReason'].includes(k)))throw authError(400,'审核参数无效');
    const d=await storage.get('doc:'+body.id);assertView(actor,access,d);requireReview(actor,access,d);
    if(d.kind!=='claim'||d.status!=='submitted'||d.revision!==body.revision)throw authError(409,'报销单状态已变化，请刷新核对');
    if(!['return','approve'].includes(body.action))throw authError(400,'审核操作无效');
    const reason=String(body.reason||'').trim();if(body.action==='return'&&(!reason||reason.length>2000))throw authError(400,'请填写退回原因（最多2000字）');
    if(body.action==='approve'){
      // Revalidate every mandatory field at the authority boundary.
      validateDocument({kind:'claim',lines:d.lines.map(({name,quantity,unitPrice,purchaseDate})=>({name,quantity,unitPrice,purchaseDate})),requestId:rid});
      const service=await serviceProvider(env);await checkPrivacy(service);
      const fields=await service.list(service.equipment.obj_token,EQUIPMENT.table,'/fields');for(const line of d.lines)devicePayload(line,d.owner,fields);
      const matches=await service.equipmentMatches(d),decisions=body.equipmentDecisions||{};d.equipmentMatches={};
      if(typeof decisions!=='object'||Array.isArray(decisions))throw authError(400,'设备核对结果无效');
      for(const item of matches){if(!item.records.length)continue;const decision=decisions[item.index];
        if(decision==='new'){if(typeof body.duplicateReason!=='string'||!body.duplicateReason.trim()||body.duplicateReason.length>2000)throw authError(409,'存在相同采购信息，请说明为何确认为另一笔采购');continue;}
        const matched=item.records.find(r=>r.id===decision);if(!matched)throw authError(409,'设备清单已存在相同采购信息，请先核对是否关联原记录');
        if(matched.reimbursed)throw authError(409,'所选设备已标记报销，不能再次关联报销');
        if(Object.values(d.equipmentMatches).includes(matched.id))throw authError(409,'同一设备记录不能重复对应多项明细');
        const linked=await storage.get('equipment-claim:'+matched.id);if(linked&&linked!==d.id)throw authError(409,'所选设备已被另一张报销单关联');
        d.equipmentMatches[item.index]=matched.id;
      }
      d.duplicateReason=String(body.duplicateReason||'').trim();
    }
    const latest=await contextProvider(request,env);requireReview(latest.actor,latest.access,d);
    if(latest.actor.personId!==actor.personId)throw authError(403,'审核账号身份已变化');
    d.status=body.action==='approve'?'approved':'returned';d.updatedAt=new Date().toISOString();d.revision++;
    if(d.status==='approved'){d.approvedAt=d.updatedAt;d.approvedBy=actor.sub;d.approvedByName=actor.name;d.returnReason='';}else d.returnReason=reason;
    result={saved:true,document:d};await storage.transaction(async tx=>{
      await tx.put('doc:'+d.id,d);await log(tx,actor,d.id,body.action==='approve'?'确认已报销并入库':'退回修改',reason);
      for(const [index,recordId]of Object.entries(d.equipmentMatches||{})){
        await tx.put('asset:'+d.id+':'+index,{recordId,linkedExisting:true,needsUpdate:true,verified:false});await tx.put('equipment-claim:'+recordId,d.id);
      }
      await enqueue(tx,(d.status==='approved'?'inventory:':'mirror:')+d.id,{kind:d.status==='approved'?'inventory':'mirror',id:d.id});
      await enqueue(tx,'notice:review:'+d.id+':'+d.revision,{kind:'reviewed',id:d.id,revision:d.revision});await tx.put(key,{hash,result});
    });
  }else if(path==='/retry'){
    const d=await storage.get('doc:'+body.id);assertView(actor,access,d);requireReview(actor,access,d);
    if(!['approved','sync_error'].includes(d.status))throw authError(409,'这张单据不需要重试');
    await enqueue(storage,'inventory:'+d.id,{kind:'inventory',id:d.id});await log(storage,actor,d.id,'重试设备入库');result={saved:true,document:d};
  }else throw authError(404,'财务接口不存在');
  await storage.put(key,{hash,result});return json(request,env,result);
}

async function checkPrivacy(service){const acl=await service.privateAcl();if(acl.externalAccess!==false||!['closed',''].includes(acl.linkSharing))throw authError(409,'预算报销资料权限需要管理员先核对，当前暂停写入');return acl;}
async function setup(request,env,storage,c,settings,serviceProvider){
  if(!c.access.canConfigure)throw authError(403,'仅管理员可配置预算与报销');const body=await parse(request);
  if(body.action==='disable'){await storage.put('settings',{...settings,ready:false});return json(request,env,{saved:true});}
  const service=await serviceProvider(env);
  if(body.action==='migration-start'){
    const migration=await startMigration(service,storage,c.actor,{nativeDependenciesVerified:body.nativeDependenciesVerified===true});
    await log(storage,c.actor,'SETUP','设备迁移备份完成');return json(request,env,{migration});
  }
  if(body.action==='migration-step')return json(request,env,{migration:await migrationStep(service,storage)});
  if(body.action==='inspect'){
    const inspection={time:new Date().toISOString(),scope:{equipmentTable:EQUIPMENT.table,sourceTable:SOURCE.table},errors:[]};
    for(const [name,fn]of Object.entries({privacy:()=>service.privateAcl(),source:()=>service.sourceSnapshot(),equipment:()=>service.snapshot(service.equipment.obj_token,EQUIPMENT.table),tables:()=>service.list(service.equipment.obj_token,'','/tables')})){
      try{const value=await fn();if(['source','equipment'].includes(name)){await storage.put('inspection:'+name,value);inspection[name]={count:value.records.length,fields:value.fields,app:value.app,table:value.table};}else inspection[name]=value;}catch(e){inspection.errors.push({stage:name,code:e.code||'',upstreamCode:e.upstreamCode,upstreamStatus:e.upstreamStatus,message:e.message,...(e.diagnostic?{diagnostic:e.diagnostic}:{})});}
    }
    // Read foreign schemas only. Never alter loan, maintenance or calibration data.
    inspection.references=[];
    for(const t of inspection.tables||[])if(t.table_id!==EQUIPMENT.table){const fs=await service.list(service.equipment.obj_token,t.table_id,'/fields');for(const f of fs)if(f.property?.table_id===EQUIPMENT.table)inspection.references.push({table:t.table_id,tableName:t.name,field:f.field_name,type:f.type});}
    await storage.put('inspection',inspection);await log(storage,c.actor,'SETUP','只读核对');return json(request,env,{inspection});
  }
  if(body.action==='prepare'){
    await checkPrivacy(service);const bindings=await service.ensureFinanceTables(storage);await log(storage,c.actor,'SETUP','准备财务资料表');return json(request,env,{bindings});
  }
  if(body.action==='activate'){
    await checkPrivacy(service);if(!c.access.reviewerReady)throw authError(409,'财务负责人职责未配置');recipient(c.people,env.FINANCE_PROFESSOR_PERSON_ID||'P-001');
    if(!body.nativePermissionsVerified)throw authError(409,'需先核实四张财务资料表仅财务和指定管理员可访问');
    const bindings=await storage.get('finance:bindings');if(!bindings||Object.keys(bindings).length!==4)throw authError(409,'财务资料表尚未准备完成');
    const migration=await storage.get('migration');if(migration?.status!=='completed')throw authError(409,'设备源表复制尚未完成并核验');
    const fields=await service.list(service.equipment.obj_token,EQUIPMENT.table,'/fields');devicePayload({name:'字段验证',quantity:'1',unitPrice:'1.00',purchaseDate:'2026-01-01'},c.actor.sub,fields);
    await storage.put('settings',{...settings,ready:true,nativePermissionsVerifiedBy:c.actor.personId,activatedAt:new Date().toISOString(),reminders:body.reminders===true});
    if((await financeEntries(storage,'job:')).some(([,j])=>j.next<Number.MAX_SAFE_INTEGER))await storage.setAlarm(Date.now()+1000);
    await log(storage,c.actor,'SETUP','启用预算与报销');return json(request,env,{saved:true});
  }
  throw authError(400,'配置操作尚未支持');
}

export async function processFinanceJobs(env,storage,serviceProvider=financeService){
  if(!(await storage.get('settings'))?.ready)return;
  const jobs=(await financeEntries(storage,'job:')).filter(([,j])=>j.next<=Date.now()).slice(0,2);if(!jobs.length)return;
  let service;
  try{service=await serviceProvider(env);}catch(e){for(const [key,j]of jobs)await storage.put(key,{...j,attempts:j.attempts+1,error:'飞书连接失败',next:Date.now()+60000});await storage.setAlarm(Date.now()+60000);return;}
  for(const [key,j]of jobs){try{
    const settings=await storage.get('settings');if(!settings?.ready)continue;
    if(j.kind==='monthly'){
      if(!settings.reminders){await storage.delete(key);continue;}
      const people=await listRecords(env,await getTenantToken(env),'MEMBERS_TABLE_ID'),target=recipient(people,j.personId);
      if(target.sub!==j.recipient)throw authError(409,'提醒收件人的身份发生变化');
      if(j.firstAttempt&&Date.now()-j.firstAttempt>45*60000)throw authError(409,'通知结果待人工核对，已停止重复发送');
      if(!j.firstAttempt){j.firstAttempt=Date.now();await storage.put(key,j);}
      await service.notify(target.sub,j.text,key);await storage.delete(key);continue;
    }
    const doc=await storage.get('doc:'+j.id);if(!doc){await storage.delete(key);continue;}
    await checkPrivacy(service);
    if(j.kind==='inventory'){
      if(!['approved','sync_error'].includes(doc.status)){await storage.delete(key);continue;}
      if(!await service.inventory(doc,storage)){await storage.put(key,{...j,next:Date.now()+1000});continue;}
      doc.status='completed';doc.completedAt=new Date().toISOString();doc.syncError='';doc.updatedAt=doc.completedAt;doc.revision++;
      await storage.put('doc:'+doc.id,doc);await enqueue(storage,'mirror:'+doc.id,{kind:'mirror',id:doc.id});
    }else if(j.kind==='mirror'){
      const logs=(await financeEntries(storage,'log:')).map(([,l])=>l).filter(l=>l.documentId===doc.id);
      if(await service.mirror(doc,await storage.get('finance:bindings'),storage,logs)===false){await storage.put(key,{...j,next:Date.now()+1000});continue;}
    }else{
      const people=await listRecords(env,await getTenantToken(env),'MEMBERS_TABLE_ID');
      let target,text;
      if(j.kind==='submitted'&&doc.kind==='purchase'){
        target=recipient(people,env.FINANCE_PROFESSOR_PERSON_ID||'P-001');
        text=`【采购申请 ${doc.id}】\n${doc.ownerName}准备购买：${doc.content}\n预计金额：¥${(doc.totalCents/100).toFixed(2)}\n用途：${doc.purpose}\n请在飞书中回复是否同意，后续资料通过群聊沟通。`;
      }else if(j.kind==='submitted'){
        target=recipient(people,env.FINANCE_REVIEWER_PERSON_ID||'P-004','财务');
        if(target.sub===doc.owner)target=recipient(people,String(env.FINANCE_DELEGATE_PERSON_IDS||'').split(',')[0],'管理员');
        text=`【报销待审核 ${doc.id}】\n${doc.ownerName}提交${doc.lines.length}项，合计¥${(doc.totalCents/100).toFixed(2)}。\n请打开工作台“预算与报销 → 审核”。`;
      }else{target=financeActor(people,doc.owner);if(target.personId!==doc.personId)throw authError(403,'申报人身份发生变化');text=`【报销 ${doc.id}】${STATUS[doc.status]}${doc.returnReason?'\n退回原因：'+doc.returnReason:''}`;}
      if(j.firstAttempt&&Date.now()-j.firstAttempt>45*60000)throw authError(409,'通知结果待人工核对，已停止重复发送');
      if(!j.firstAttempt){j.firstAttempt=Date.now();await storage.put(key,j);}
      await service.notify(target.sub,text+'\n'+env.FRONTEND_URL+'?page=finance',key);doc.noticeError='';await storage.put('doc:'+doc.id,doc);
    }
    await storage.delete(key);
  }catch(e){const attempts=j.attempts+1;await storage.put(key,{...j,attempts,error:e.message,next:e.status===409?Number.MAX_SAFE_INTEGER:Date.now()+Math.min(3600000,30000*2**Math.min(attempts,6))});
    const doc=await storage.get('doc:'+j.id);if(doc){if(j.kind==='inventory'){doc.status='sync_error';doc.syncError=e.status===409?e.message:'设备写入尚未确认，请财务核对后重试';}else doc.noticeError=j.kind==='mirror'?'飞书资料归档待重试':'飞书通知待重试';await storage.put('doc:'+doc.id,doc);}
  }}
  const remaining=(await financeEntries(storage,'job:')).filter(([,j])=>j.next<Number.MAX_SAFE_INTEGER);if(remaining.length)await storage.setAlarm(Math.max(Date.now()+3000,Math.min(...remaining.map(([,j])=>j.next))));
}

export async function prepareFinanceReminders(time,env,storage,peopleProvider){
  const settings=await storage.get('settings');if(!settings?.ready||!settings.reminders)return;
  const day=new Date(Number(time)+8*3600000).toISOString(),date=day.slice(0,10),n=Number(day.slice(8,10));if(![1,20,27].includes(n)||day.slice(11,13)!=='10')return;
  const ledger='schedule:'+date;if(await storage.get(ledger))return;
  const people=await(peopleProvider?peopleProvider():listRecords(env,await getTenantToken(env),'MEMBERS_TABLE_ID')),records=await docs(storage),notices=[];
  if(n===1){
    const previous=new Date(date+'T00:00:00Z');previous.setUTCMonth(previous.getUTCMonth()-1);const month=previous.toISOString().slice(0,7),summary=monthlySummary(records,month),target=recipient(people,env.FINANCE_PROFESSOR_PERSON_ID||'P-001');
    notices.push({target,text:`【${month} 实验室费用汇总】\n已确认报销：¥${(summary.totalCents/100).toFixed(2)}\n尚未确认报销：¥${(summary.pendingCents/100).toFixed(2)}\n按实际采购月份统计；历史设备迁入不计为新增费用。${summary.syncIssues?'\n设备入库待处理单据：'+summary.syncIssues:''}`});
  }else{
    const targets=people.filter(p=>p.fields?.['人员边界']==='团队内'&&p.fields?.['人员状态']==='在组'&&p.fields?.['是否启用']!==false&&!p.fields?.['离组时间']).map(p=>recipient(people,personNumber(p)));
    for(const target of targets){const todo=records.filter(d=>d.kind==='claim'&&d.owner===target.sub&&d.personId===target.personId&&['draft','returned'].includes(d.status));if(n===27&&!todo.length)continue;
      notices.push({target,text:n===20?'【月度报销提醒】\n请整理本月采购费用，在工作台“预算与报销”提交。每项需填写名称、数量、采购单价、采购日期。已提交的请勿重复填报。':`【报销补充提醒】\n你有${todo.length}张草稿或退回单据，请核对并补充后提交财务。`});
    }
  }
  await storage.transaction(async tx=>{for(const {target,text}of notices)await enqueue(tx,'monthly:'+date+':'+target.personId,{kind:'monthly',personId:target.personId,recipient:target.sub,text:text+'\n'+env.FRONTEND_URL+'?page=finance'});await tx.put(ledger,{count:notices.length,time:Date.now()});});
}
export async function scheduleFinance(time,env){if(env.FINANCE_ENABLED!=='true'||!env.FINANCE_RECORDS)return;try{await env.FINANCE_RECORDS.get(env.FINANCE_RECORDS.idFromName(FINANCE_STORE)).fetch(new Request('https://internal/_finance-scheduled',{method:'POST',body:JSON.stringify({time})}));}catch(e){console.error('ER2_FINANCE_SCHEDULE_FAILED',e.code||e.name);}}

export class FinanceRecords{
  constructor(state,env){this.state=state;this.env=env;this.queue=Promise.resolve();}
  serial(fn){const r=this.queue.then(fn);this.queue=r.catch(()=>{});return r;}
  fetch(request){const path=new URL(request.url).pathname;if(path==='/_finance-storage-check')return Promise.resolve(Response.json({version:FINANCE_VERSION}));
    if(path==='/_finance-scheduled'&&request.method==='POST')return this.serial(async()=>{await prepareFinanceReminders((await request.json()).time,this.env,this.state.storage);return Response.json({ok:true});});
    const execute=()=>executeFinance(request,this.env,this.state.storage).catch(e=>financeError(request,this.env,e));return request.method==='GET'?execute():this.serial(execute);}
  alarm(){return this.serial(()=>processFinanceJobs(this.env,this.state.storage));}
}
