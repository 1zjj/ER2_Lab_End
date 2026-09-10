import { authError, strictBinding, text } from './authorization.js';
import { canonicalProjectData, projectDisplayProjection } from './project-master.js';
import { permissionAuditContext } from './permission-audit.js';
import { listRecords, getTenantToken, feishuRequest, json, stableMessageUuid } from './index.js';

const bindings=['MEMBERS_TABLE_ID','PROJECTS_TABLE_ID','AUTH_PROJECTS_TABLE_ID','PROJECT_MEMBERS_TABLE_ID'];
const enc=encodeURIComponent;
const refs=v=>!Array.isArray(v)&&Array.isArray(v?.link_record_ids)?v.link_record_ids:(Array.isArray(v)?v:[]).flatMap(x=>typeof x==='string'?[x]:x.record_ids||[x.record_id].filter(Boolean));
const personIds=v=>(Array.isArray(v)?v:[]).map(x=>x.id||x.open_id).filter(Boolean).sort();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fieldEqual=(name,a,b)=>['项目负责人','成员'].includes(name)?same(personIds(a),personIds(b)):
  name==='关联人员'?same(refs(a).sort(),refs(b).sort()):text(a)===text(b);

// Only canonical definitions and verified business relationships produce writes.
// No caller supplies table IDs, values, owners or collaborator lists.
export function projectSourcePlan(people,master,mirrors,relations) {
  const canonical=canonicalProjectData(master,[],[]),issues=[...canonical.issues],changes=[],pendingProjects=[];
  const catalog=canonicalProjectData(master,mirrors,relations);
  issues.push(...catalog.issues.filter(i=>['MIRROR_ID_DUPLICATE'].includes(i.code)));
  for(const p of canonical.projects){
    const id=p.fields['项目编号'];
    if(p.definitionBlocked)continue;
    const matches=mirrors.filter(m=>text(m.fields?.['项目编号'])===id);
    if(matches.length>1)continue;
    const mirror=matches[0];
    const expected={'项目编号':id,'项目名称':p.fields['项目名称'],'项目阶段':p.fields['项目阶段'],'保密等级':p.fields['保密等级']};
    const fields=Object.fromEntries(Object.entries(expected).filter(([k,v])=>!mirror||!fieldEqual(k,mirror.fields?.[k],v)));
    if(Object.keys(fields).length)changes.push({binding:'AUTH_PROJECTS_TABLE_ID',projectId:id,recordId:mirror?.record_id||'',fields});
    const approved=catalog.relations.filter(r=>refs(r.fields?.['关联项目']).includes(p.record_id)&&r.fields?.['授权状态']==='有效');
    if(approved.some(r=>r.fields?.['权限落实状态']!=='已落实')){pendingProjects.push(id);continue;}
    // Compute after replacing the mirror's policy with the canonical definition;
    // policy drift itself is corrected first, never treated as a second source.
    const projection=projectDisplayProjection(people,canonical.projects,catalog.relations).find(x=>x.projectId===id);
    if(!projection)continue;
    issues.push(...projection.issues.map(code=>({code,projectId:id})));
    const actual=master.find(r=>r.record_id===p.record_id);
    const display=Object.fromEntries(Object.entries(projection.fields).filter(([k,v])=>!fieldEqual(k,actual?.fields?.[k],v)));
    if(Object.keys(display).length)changes.push({binding:'PROJECTS_TABLE_ID',projectId:id,recordId:p.record_id,fields:display});
    if(mirror){
      const mirrorDisplay={'项目负责人':projection.fields['项目负责人'],'关联人员':projection.members.map(x=>people.find(y=>text(y.fields?.['人员编号']||y.fields?.['成员编号'])===x.personId)?.record_id).filter(Boolean)};
      const fields=Object.fromEntries(Object.entries(mirrorDisplay).filter(([k,v])=>!fieldEqual(k,mirror.fields?.[k],v)));
      if(Object.keys(fields).length)changes.push({binding:'AUTH_PROJECTS_TABLE_ID',projectId:id,recordId:mirror.record_id,fields});
    }
  }
  return {issues,changes,pendingProjects,warnings:catalog.issues.filter(i=>i.code==='ORPHAN_MIRROR')};
}

export function projectSourceAdapter(env){
  const call=async(path,options={})=>feishuRequest(path,{bearer:await getTenantToken(env),...options});
  async function snapshot(){
    bindings.forEach(k=>strictBinding(env,k));
    const token=await getTenantToken(env);
    const rows=await Promise.all(bindings.map(k=>listRecords(env,token,k)));
    return rows;
  }
  async function plan(){
    const rows=await snapshot(),plan=projectSourcePlan(...rows);
    // Include source and current projection values to reject stale queued writes,
    // including owner changes that do not change the native access level.
    const version=await stableMessageUuid(JSON.stringify(rows));
    return {...plan,version};
  }
  async function destination(key){
    if(!['PROJECTS_TABLE_ID','AUTH_PROJECTS_TABLE_ID'].includes(key))throw authError(403,'不能修改此数据源');
    const b=strictBinding(env,key),anchor=env.MEMBERS_BASE_WIKI_TOKEN;
    const wiki=env[key.replace(/_TABLE_ID$/,'')+'_BASE_WIKI_TOKEN'];
    if(!anchor||!wiki)throw authError(503,'写入前必须核实 ER2 知识库归属');
    const [root,node]=await Promise.all([anchor,wiki].map(async token=>(await call('/wiki/v2/spaces/get_node?token='+enc(token))).data?.node));
    if(!root?.space_id||node?.space_id!==root.space_id||node?.obj_type!=='bitable'||!node.obj_token||b.appToken&&b.appToken!==node.obj_token)
      throw authError(403,'目标数据源不属于已核实的 ER2');
    return '/bitable/v1/apps/'+enc(node.obj_token)+'/tables/'+enc(b.tableId);
  }
  async function apply(change,version){
    const fresh=await plan();
    if(fresh.version!==version||fresh.issues.length||!fresh.changes.some(c=>same(c,change)))throw authError(409,'主数据已变化，重新对账');
    const path=await destination(change.binding);
    const allowed=change.binding==='PROJECTS_TABLE_ID'?{'项目负责人':[11],'成员':[11]}:
      {'项目编号':[1],'项目名称':[1],'项目阶段':[3],'保密等级':[3],'项目负责人':[11],'关联人员':[18,21]};
    const schema=(await call(path+'/fields?page_size=100')).data;
    if(!Array.isArray(schema?.items)||schema.has_more!==false)throw authError(503,'字段结构未完整读回');
    for(const name of Object.keys(change.fields)){
      const field=schema.items.find(f=>f.field_name===name);
      if(!allowed[name]?.includes(field?.type))throw authError(409,'派生字段结构不一致：'+name);
    }
    const latest=await plan();
    if(latest.version!==version)throw authError(409,'写入前主数据已变化');
    const uuid=await stableMessageUuid('source:'+change.projectId);
    const clientToken=uuid.slice(0,8)+'-'+uuid.slice(8,12)+'-4'+uuid.slice(13,16)+'-a'+uuid.slice(17,20)+'-'+uuid.slice(20);
    const r=await call(path+'/records'+(change.recordId?'/'+enc(change.recordId):'')+'?user_id_type=open_id'+(!change.recordId?'&client_token='+clientToken:''),
      {method:change.recordId?'PUT':'POST',body:{fields:change.fields},singleAttempt:true});
    if(!r.data?.record?.record_id)throw authError(503,'写入结果未确认，须读回对账');
    // A mutation response does not certify the projection. Next step re-reads all
    // sources before reporting matched or compensating an in-flight source edit.
  }
  return {plan,apply};
}

export class ProjectSourceSync {
  constructor(storage,adapter,now=()=>Date.now()){this.storage=storage;this.adapter=adapter;this.now=now;}
  async status(){return {...(await this.storage.get('source:status')||{state:'disabled'}),enabled:await this.storage.get('source:enabled')===true};}
  async record(value){const status={...value,checkedAt:new Date(this.now()).toISOString()};await this.storage.put('source:status',status);return this.status();}
  async inspect(){return this.record({state:'inspected',...await this.adapter.plan()});}
  async enable(version){const p=await this.adapter.plan();if(!version||p.version!==version||p.issues.length)throw authError(409,'请先核对当前版本的同步计划');await this.storage.put('source:enabled',true);await this.storage.setAlarm(this.now()+1000);return this.record({state:'queued',...p});}
  async disable(){await this.storage.put('source:enabled',false);await this.storage.deleteAlarm();return this.record({state:'disabled'});}
  async step(){
    if(!await this.storage.get('source:enabled'))return this.status();
    await this.storage.setAlarm(this.now()+60000);
    try{
      const p=await this.adapter.plan();
      if(p.issues.length)return this.record({state:'blocked',...p});
      if(!p.changes.length){await this.storage.delete('source:pending');await this.storage.put('source:attempts',0);return this.record({state:p.pendingProjects.length?'waiting_native_verification':'matched',...p});}
      const change=p.changes[0];
      await this.storage.put('source:pending',{version:p.version,change,startedAt:this.now()});
      await this.adapter.apply(change,p.version);
      const sequence=(await this.storage.get('source:sequence')||0)+1;
      await this.storage.put('source:sequence',sequence);
      await this.storage.put('source:event:'+String(sequence).padStart(12,'0'),{version:p.version,change,time:this.now()});
      await this.storage.put('source:attempts',0);await this.storage.setAlarm(this.now()+1000);
      return this.record({state:'awaiting_readback',version:p.version,change});
    }catch(e){
      const attempts=(await this.storage.get('source:attempts')||0)+1;await this.storage.put('source:attempts',attempts);
      if(attempts>=5){await this.storage.put('source:enabled',false);await this.storage.deleteAlarm();}
      return this.record({state:attempts>=5?'manual_intervention':'retry_after_readback',attempts,issues:[{code:e.code||'SOURCE_SYNC_FAILED',status:e.status||503}]});
    }
  }
}

export async function routeProjectSourceSync(request,env){
  try{await permissionAuditContext(request,env);if(!env.WEEKLY_WRITES)throw authError(503,'同步任务尚未配置');
    return env.WEEKLY_WRITES.get(env.WEEKLY_WRITES.idFromName('er2-project-source-sync-v1:'+env.MEMBERS_BASE_WIKI_TOKEN)).fetch(request);
  }catch(e){return json(request,env,{message:e.status<500?e.message:'主数据同步暂不可用'},e.status||503);}
}
export async function executeProjectSourceSync(request,env,storage){
  try{
    await permissionAuditContext(request,env);const engine=new ProjectSourceSync(storage,projectSourceAdapter(env));
    if(request.method==='GET')return json(request,env,await engine.status());
    if(request.method!=='POST')throw authError(405,'不支持此操作');
    const body=await request.json();if(!body||Object.keys(body).some(k=>!['action','version'].includes(k)))throw authError(400,'同步请求无效');
    if(body.action==='inspect')return json(request,env,await engine.inspect());
    if(body.action==='enable')return json(request,env,await engine.enable(body.version));
    if(body.action==='disable')return json(request,env,await engine.disable());
    throw authError(400,'同步操作无效');
  }catch(e){return json(request,env,{message:e.status<500?e.message:'主数据同步未完成'},e.status||503);}
}
