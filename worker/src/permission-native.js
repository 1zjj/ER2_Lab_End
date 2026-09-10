import { authority, identity, isAdministrator, strictBinding, authError, text } from './authorization.js';
import { canonicalProjectData } from './project-master.js';
import { getTenantToken, listRecords, feishuRequest } from './index.js';
import { inspectNativePermissions } from './permission-audit.js';

const enc = encodeURIComponent;
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
function wikiToken(value) {
  if (Array.isArray(value)) value = value.length === 1 ? value[0] : null;
  try { const u = new URL(typeof value === 'object' ? value?.link || value?.url || '' : value || '');
    return u.origin === 'https://lcnywl4yrecr.feishu.cn' && !u.username && !u.password && /^\/wiki\/[A-Za-z0-9]+$/.test(u.pathname) ? u.pathname.split('/').pop() : '';
  } catch (_) { return ''; }
}

export function nativePermissionAdapter(env, storage) {
  async function call(path, options = {}) {
    const r = await feishuRequest(path, { bearer: await getTenantToken(env), ...options, singleAttempt: options.method && options.method !== 'GET' });
    if (r.code !== 0) throw authError(502,'原生权限接口未确认');
    return r.data || {};
  }
  async function target() {
    const keys=['MEMBERS_TABLE_ID','PROJECTS_TABLE_ID','AUTH_PROJECTS_TABLE_ID','PROJECT_MEMBERS_TABLE_ID'];
    keys.forEach(key=>strictBinding(env,key));
    const token=await getTenantToken(env);
    const [people,master,mirrors,relations]=await Promise.all(keys.map(key=>listRecords(env,token,key)));
    const catalog=canonicalProjectData(master,mirrors,relations);
    const linkedIds=v=>!Array.isArray(v)&&Array.isArray(v?.link_record_ids)?v.link_record_ids:(Array.isArray(v)?v:v?[v]:[]).flatMap(x=>typeof x==='string'?[x]:x.record_ids||[x.record_id].filter(Boolean));
    const pendingOnly=id=>{const mirror=mirrors.find(r=>text(r.fields?.['项目编号'])===id);return mirror&&!relations.some(r=>linkedIds(r.fields?.['关联项目']).includes(mirror.record_id)&&r.fields?.['授权状态']==='有效');};
    const warnings=catalog.issues.filter(i=>i.code==='MIRROR_TITLE_DRIFT'||i.code==='ORPHAN_MIRROR'&&pendingOnly(i.projectId));
    const issues=catalog.issues.filter(i=>!warnings.includes(i));
    const admins=[];
    for(const p of people){try {const a=authority(people,[],[],identity(p));if(isAdministrator(a))admins.push(a.sub);}catch(_){}}
    if(admins.length!==2)issues.push({code:'EXPECTED_TWO_ACTIVE_ADMINISTRATORS'});
    // The execution target is computed from approved relations, not a display
    // member field and not a manually entered list of Feishu collaborators.
    const approved=relations.map(r=>({...r,fields:{...r.fields,'权限落实状态':['待撤回','已撤回'].includes(r.fields?.['权限落实状态'])?'已撤回':'待核验'}}));
    const executionCatalog=canonicalProjectData(master,mirrors,approved),resources=[];
    for(const project of executionCatalog.projects){
      const id=text(project.fields['项目编号']),root=wikiToken(project.fields['项目主页']);
      if(!root){issues.push({code:'PROJECT_WIKI_MISSING',projectId:id});continue;}
      const desired=Object.fromEntries(admins.map(sub=>[sub,'full_access']));
      for(const p of people){try{const actor=authority(people,executionCatalog.projects,executionCatalog.relations,identity(p));const grant=actor.grants[id];if(grant&&!desired[actor.sub])desired[actor.sub]=grant.level>=2?'edit':'view';}catch(_){}}
      resources.push({projectId:id,nodeToken:root,desired});
    }
    // Structural/policy drift blocks writes until data is explicitly corrected.
    const previous=await storage?.get('permission:inventory') || [];
    for(const p of previous)if(!resources.some(r=>r.projectId===p.projectId))issues.push({code:'REMOVED_PROJECT_HAS_NATIVE_RESOURCES',node:p.nodeToken,projectId:p.projectId});
    const stable={resources:resources.sort((a,b)=>a.projectId.localeCompare(b.projectId)),admins:admins.sort(),issues};
    return {version:await digest(stable),...stable,warnings,complete:issues.length===0};
  }
  async function observe(target) {
    const issues=[],changes=[],seen=new Set(),inventory=[];
    const pending=target.resources.map(r=>({...r,root:true}));
    for(let i=0;i<pending.length;i++){
      if(i>=100){issues.push({code:'INVENTORY_LIMIT',limit:100});break;}
      const resource=pending[i];
      if(seen.has(resource.nodeToken)){issues.push({code:'RESOURCE_SHARED_BETWEEN_PROJECTS',node:resource.nodeToken});continue;}
      seen.add(resource.nodeToken);
      let snapshot;
      try {snapshot=await inspectNativePermissions(env,resource.nodeToken,'',{call});}
      catch(e){issues.push({code:'NODE_READ_FAILED',node:resource.nodeToken,status:e.upstreamStatus||e.status||503,cause:e.code||e.upstreamCode||'READ_FAILED'});continue;}
      if(!snapshot.readComplete||snapshot.hasMore){issues.push({code:'RESOURCE_READ_INCOMPLETE',node:resource.nodeToken,details:snapshot.issues});continue;}
      const node=snapshot.node;
      inventory.push({nodeToken:node.node_token,projectId:resource.projectId,parent:node.parent_node_token,owner:node.owner,objectToken:node.obj_token,type:node.obj_type});
      if(node.node_type!=='origin'||!target.admins.includes(node.owner)){issues.push({code:'OWNER_OR_SHORTCUT_REQUIRES_REVIEW',node:resource.nodeToken});continue;}
      for(const child of snapshot.children)pending.push({...resource,nodeToken:child.node_token,root:false});
      if(snapshot.sharing?.link_share_entity!=='closed'||snapshot.sharing?.external_access_entity!=='closed'||resource.root&&snapshot.sharing?.lock_switch!==true)
        issues.push({code:'PUBLIC_OR_INHERITED_ACCESS_REQUIRES_REVIEW',node:resource.nodeToken});
      if(node.obj_type!=='docx'){issues.push({code:'BASE_OR_OBJECT_REQUIRES_SEPARATE_AUDIT',node:resource.nodeToken,type:node.obj_type});continue;}
      // Underlying document permissions must also be readable. Its memberships
      // may be inherited; never infer a complete revoke from wiki lists alone.
      let underlying;
      try { underlying=await call('/drive/v1/permissions/'+enc(node.obj_token)+'/members?type=docx'); }
      catch(_){issues.push({code:'UNDERLYING_DOCUMENT_READ_FAILED',node:resource.nodeToken});continue;}
      if(!Array.isArray(underlying.items)){issues.push({code:'UNDERLYING_MEMBERS_INCOMPLETE',node:resource.nodeToken});continue;}
      let blocks;
      try {blocks=await call('/docx/v1/documents/'+enc(node.obj_token)+'/blocks?page_size=500');}
      catch(_){issues.push({code:'DOCUMENT_REFERENCES_UNREADABLE',node:resource.nodeToken});continue;}
      if(!Array.isArray(blocks.items)||blocks.has_more!==false){issues.push({code:'DOCUMENT_INVENTORY_INCOMPLETE',node:resource.nodeToken});continue;}
      // Referenced files and embedded objects have separate permissions. Keep
      // this object blocked until those resources have an explicit inventory.
      if(blocks.items.some(b=>b.file||b.image||b.bitable||b.sheet||b.iframe||b.view||JSON.stringify(b).includes('feishu.cn/')))
        issues.push({code:'ATTACHMENT_OR_REFERENCE_REQUIRES_AUDIT',node:resource.nodeToken});
      for(const [scope,members,type,token] of [['container',snapshot.container,'wiki',node.node_token],['single_page',snapshot.singlePage,'wiki',node.node_token],['document',underlying.items,'docx',node.obj_token]]){
        const present=new Set();
        for(const m of members){
          if(m.member_type==='appid'&&m.member_id===env.FEISHU_APP_ID)continue;
          if(m.member_type!=='openid'||m.type&&m.type!=='user'){issues.push({code:'GROUP_OR_UNKNOWN_MEMBER',node:resource.nodeToken,scope});continue;}
          if(present.has(m.member_id)){issues.push({code:'DUPLICATE_MEMBER',node:resource.nodeToken,scope});continue;}present.add(m.member_id);
          const expected=resource.desired[m.member_id];
          if(m.member_id===node.owner&&expected!=='full_access'){issues.push({code:'OWNER_REVOKE_REQUIRES_REVIEW',node:resource.nodeToken});continue;}
          if(!expected)changes.push({priority:0,method:'DELETE',node:resource.nodeToken,token,type,scope,member:m.member_id,permission:null});
          else if(m.perm!==expected)changes.push({priority:({view:1,edit:2,full_access:3})[expected]<({view:1,edit:2,full_access:3})[m.perm]?1:2,method:'PUT',node:resource.nodeToken,token,type,scope,member:m.member_id,permission:expected});
        }
        // Grant only on the project container. Existing child/document direct
        // entries are reconciled but are never invented to mask inheritance.
        if(resource.root&&scope==='container')for(const [member,permission] of Object.entries(resource.desired))if(!present.has(member))
          changes.push({priority:2,method:'POST',node:resource.nodeToken,token,type,scope,member,permission});
      }
    }
    return {complete:issues.length===0,issues,changes,inventory};
  }
  async function apply(change,target) {
    if(!target.complete||target.issues.length)throw authError(409,'目标权限尚未完成核验');
    if(!['DELETE','PUT','POST'].includes(change.method)||!['wiki','docx'].includes(change.type))throw authError(400,'权限操作无效');
    const fresh=await targetProvider();
    if(!fresh.complete||fresh.version!==target.version)throw authError(409,'目标权限已变化');
    const audit=await inspectNativePermissions(env,change.node,'',{call});
    if(!audit.readComplete||!target.admins.includes(audit.node.owner)||change.token!==(change.type==='wiki'?audit.node.node_token:audit.node.obj_token))throw authError(409,'资源归属已变化');
    let ancestor=audit.node, root;
    for(let depth=0;depth<20;depth++){
      root=target.resources.find(r=>r.nodeToken===ancestor.node_token);
      if(root)break;
      if(!ancestor.parent_node_token)break;
      ancestor=(await call('/wiki/v2/spaces/get_node?token='+enc(ancestor.parent_node_token))).node;
      if(!ancestor||ancestor.space_id!==audit.spaceId)break;
    }
    if(!root)throw authError(409,'资源已不属于受管项目');
    const expected=root.desired[change.member]||null;
    if(expected!==change.permission||change.method==='DELETE'&&target.admins.includes(change.member))throw authError(409,'成员目标权限已变化');
    const suffix=change.method==='POST'?'':'/'+enc(change.member);
    const scope=change.type==='wiki'?{perm_type:change.scope}:{};
    await call('/drive/v1/permissions/'+enc(change.token)+'/members'+suffix+'?type='+change.type+'&need_notification=false'+(change.method==='DELETE'?'&member_type=openid':''),{
      method:change.method,body:change.method==='DELETE'?{type:'user',...scope}:{member_type:'openid',member_id:change.member,perm:change.permission,type:'user',...scope}
    });
  }
  const targetProvider=target;
  return {target,observe,apply};
}
