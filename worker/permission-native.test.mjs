import assert from 'node:assert/strict';
import { nativePermissionAdapter } from './src/permission-native.js';
const people=[1,2,3].map(n=>({record_id:'person'+n,fields:{'人员编号':'P-00'+n,'姓名':'合成人员'+n,'飞书成员':[{id:'ou_test'+n}],'人员状态':'在组','人员边界':'团队内','成员类别':'博士','保密等级':'内部','系统职责':n<3?['管理员']:[]}}));
const fields={'项目编号':'PRJ-001','统一项目编号':'PRJ-001','项目名称':'合成项目','项目阶段':'执行中','保密等级':'内部','项目主页':'https://lcnywl4yrecr.feishu.cn/wiki/ProjectFixture'};
const rows={members:people,projects:[{record_id:'master',fields}],auth_projects:[{record_id:'mirror',fields}],project_members:[{record_id:'relation',fields:{'关联人员':['person3'],'关联项目':['mirror'],'授权状态':'有效','工作台授权确认':'已确认','权限落实状态':'待核验','权限级别':'编辑','成员边界':'团队内','加入日期':'2020-01-01','权限到期日':'2099-01-01','审批人':[{id:'ou_test1'}]}}]};
const env={FEISHU_APP_ID:'fixture',FEISHU_APP_SECRET:'fixture',MEMBERS_BASE_WIKI_TOKEN:'Anchor'};
for(const name of Object.keys(rows)){env[name.toUpperCase()+'_TABLE_ID']=name;env[name.toUpperCase()+'_BASE_APP_TOKEN']='fixture';}
let references=false,foreignOwner=false,publicLink=false,failRead=false,childCount=0,requestCount=0;
const writes=[],realFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 requestCount++;
 const u=new URL(input),path=u.pathname;
 const result=data=>Response.json({code:0,data});
 if(path.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'fixture',expire:7200});
 if(options.method!=='GET'){writes.push({path,query:u.search,body:JSON.parse(options.body)});return result({});}
 if(path.includes('/tables/'))return result({items:rows[path.split('/tables/')[1].split('/')[0]],has_more:false});
 if(path.endsWith('/get_node'))return result({node:{space_id:'ER2fixture',node_token:u.searchParams.get('token'),node_type:'origin',owner:foreignOwner?'ou_unknown':'ou_test1',obj_type:'docx',obj_token:'DocFixture',parent_node_token:''}});
 if(path.endsWith('/nodes'))return result({items:u.searchParams.get('parent_node_token')==='ProjectFixture'?Array.from({length:childCount},(_,i)=>({node_token:'ChildFixture'+i})):[],has_more:false});
 if(path.includes('/blocks'))return result({items:references?[{file:{token:'attachment'}}]:[],has_more:false});
 if(path.endsWith('/public'))return result({permission_public:{external_access_entity:'closed',link_share_entity:publicLink?'tenant_readable':'closed',lock_switch:true}});
 if(path.endsWith('/members')){
   if(failRead)return result({});
   const items=u.searchParams.get('perm_type')==='container'?[{member_id:'ou_test1',member_type:'openid',perm:'full_access',type:'user'},{member_id:'ou_test2',member_type:'openid',perm:'full_access',type:'user'},{member_id:'ou_obsolete',member_type:'openid',perm:'edit',type:'user'}]:[];
   return result({items});
 }
 throw Error('Unexpected '+path);
};
try{
 const adapter=nativePermissionAdapter(env),target=await adapter.target();assert.equal(target.complete,true);assert.equal(target.resources[0].desired.ou_test3,'edit');
 let observed=await adapter.observe(target);assert.equal(observed.complete,true);assert.equal(observed.changes.length,2);
 await adapter.apply(observed.changes.find(c=>c.method==='DELETE'),target);assert.equal(writes.length,1);assert.match(writes[0].path,/ou_obsolete$/);assert.equal(writes[0].body.perm_type,'container');
 rows.project_members[0].fields['权限落实状态']='待撤回';const revoke=await adapter.target();assert.equal(revoke.resources[0].desired.ou_test3,undefined);
 await assert.rejects(adapter.apply(observed.changes.find(c=>c.method==='POST'),target),e=>e.status===409);assert.equal(writes.length,1);
 for(const mode of ['reference','owner','public','read']){
  references=mode==='reference';foreignOwner=mode==='owner';publicLink=mode==='public';failRead=mode==='read';
  observed=await adapter.observe(await adapter.target());assert.equal(observed.complete,false,mode);assert.ok(observed.issues.length);
 }
 references=foreignOwner=publicLink=failRead=false;
 rows.projects[0].fields={...fields,'保密等级':''};assert.equal((await adapter.target()).complete,false);
 assert.equal(writes.length,1,'no write on source drift, unsupported references, owner or incomplete reads');
 rows.projects[0].fields={...fields};childCount=20;
 const boundedTarget=await adapter.target();let cursor=null,batches=0,last;
 do {
   requestCount=0;
   last=await adapter.observeBatch(boundedTarget,cursor);cursor=last.cursor;batches++;
   assert.ok(requestCount<=20,'each batch stays within the runtime subrequest budget');
   if(last.pending)assert.notEqual(last.complete,true,'partial inventory never certifies permissions');
 }while(last.pending&&batches<20);
 assert.equal(batches,11);assert.equal(last.complete,true);assert.equal(last.inventory.length,21);
 const partial=await adapter.observeBatch(boundedTarget,null);
 const changed=await adapter.observeBatch({...boundedTarget,version:'changed-target'},partial.cursor);
 assert.equal(changed.cursor.index,2,'new target restarts from roots instead of retaining old observations');
}finally{globalThis.fetch=realFetch;}
console.log('PASS native adapter: approved relation targets, ER2-scoped delete payload, source changes reject queued grants, pending revoke, owner/public/attachment/read failures block certification');
