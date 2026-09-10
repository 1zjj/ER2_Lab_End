import assert from 'node:assert/strict';
import {projectSourcePlan,ProjectSourceSync,projectSourceAdapter} from './src/project-source-sync.js';

const people=[1,2].map(n=>({record_id:'person'+n,fields:{'人员编号':'P-00'+n,'姓名':'测试人员'+n,'飞书成员':[{id:'ou_source'+n}],
  '人员状态':'在组','人员边界':'团队内','成员类别':'博士','保密等级':'内部','系统职责':n===1?['管理员']:[]}}));
const master=[{record_id:'master',fields:{'统一项目编号':'PRJ-001','项目名称':'正式名称','项目阶段':'执行中','保密等级':'内部','项目负责人':[{id:'ou_source1'}],'成员':[{id:'ou_source1'}]}}];
const mirrors=[{record_id:'mirror',fields:{'项目编号':'PRJ-001','项目名称':'旧名称','项目阶段':'执行中','保密等级':'内部','项目负责人':[{id:'ou_source1'}],'关联人员':['person1']}}];
const relations=[{record_id:'relation',fields:{'关联人员':['person2'],'关联项目':['mirror'],'项目角色':'负责人','权限级别':'编辑','授权状态':'有效','工作台授权确认':'已确认','权限落实状态':'待核验','成员边界':'团队内','加入日期':'2020-01-01','权限到期日':'2099-01-01','审批人':[{id:'ou_source1'}]}}];
let p=projectSourcePlan(people,master,mirrors,relations);
assert.deepEqual(p.pendingProjects,['PRJ-001']);assert.equal(p.issues.length,0);
assert.deepEqual(p.changes,[{binding:'AUTH_PROJECTS_TABLE_ID',projectId:'PRJ-001',recordId:'mirror',fields:{'项目名称':'正式名称'}}]);
relations[0].fields['权限落实状态']='已落实';
p=projectSourcePlan(people,master,mirrors,relations);
assert.equal(p.changes.length,3);assert.deepEqual(p.changes[1].fields,{'项目负责人':[{id:'ou_source2'}],'成员':[{id:'ou_source2'}]});
assert.deepEqual(p.changes[2].fields,{'项目负责人':[{id:'ou_source2'}],'关联人员':['person2']});
assert.ok(p.changes.every(c=>!['MEMBERS_TABLE_ID','PROJECT_MEMBERS_TABLE_ID'].includes(c.binding)),'never overwrites identity or authorization');
assert.ok(projectSourcePlan(people,[...master,...master],mirrors,relations).issues.length);
assert.ok(projectSourcePlan(people,master,[...mirrors,...mirrors],relations).issues.length);
assert.equal(projectSourcePlan(people,master,[],[]).changes[0].recordId,'','missing mirror is created from canonical definition');
relations[0].fields['授权状态']='已退出';
assert.deepEqual(projectSourcePlan(people,master,mirrors,relations).changes[1].fields,{'项目负责人':[],'成员':[]},'withdrawal clears derived members');
relations[0].fields['授权状态']='有效';
master[0].fields['项目阶段']='暂停';
assert.equal(projectSourcePlan(people,master,mirrors,relations).changes[0].fields['项目阶段'],'暂停');
master[0].fields['项目阶段']='执行中';

// Exercise production writer with synthetic network responses, including actual
// schema validation, source edits during preparation, and foreign-space denial.
const rows={members:people,projects:master,auth_projects:mirrors,project_members:relations};
const env={FEISHU_APP_ID:'sourceFixture',FEISHU_APP_SECRET:'sourceFixture',MEMBERS_BASE_WIKI_TOKEN:'MembersFixture'};
for(const k of Object.keys(rows)){env[k.toUpperCase()+'_TABLE_ID']=k;env[k.toUpperCase()+'_BASE_WIKI_TOKEN']=k==='projects'?'ProjectsFixture':'MembersFixture';}
const realFetch=globalThis.fetch;let writes=0,foreign=false,drift=false,wrongSchema=false;
globalThis.fetch=async(input,options={})=>{
 const u=new URL(input),path=u.pathname,ok=data=>Response.json({code:0,data});
 if(path.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'fixture',expire:7200});
 if(path.endsWith('/get_node')){const project=u.searchParams.get('token')==='ProjectsFixture';return ok({node:{space_id:foreign&&project?'OtherSpace':'ER2Fixture',obj_type:'bitable',obj_token:project?'ProjectBase':'MemberBase'}});}
 const match=path.match(/\/tables\/([^/]+)\/(records|fields)(?:\/([^/]+))?$/);assert.ok(match,path);const [,table,kind,id]=match;
 if(kind==='fields'){
  if(drift){master[0].fields['项目名称']='Concurrent rename';drift=false;}
  return ok({has_more:false,items:Object.entries({'项目编号':1,'项目名称':wrongSchema?2:1,'项目阶段':3,'保密等级':3,'项目负责人':11,'成员':11,'关联人员':21}).map(([field_name,type])=>({field_name,type}))});
 }
 if(options.method==='GET')return ok({items:structuredClone(rows[table]),has_more:false});
 assert.equal(options.method,'PUT');writes++;Object.assign(rows[table].find(r=>r.record_id===id).fields,JSON.parse(options.body).fields);return ok({record:{record_id:id}});
};
try{
 const a=projectSourceAdapter(env),plan=await a.plan();
 wrongSchema=true;await assert.rejects(a.apply(plan.changes[0],plan.version),e=>e.status===409);assert.equal(writes,0);wrongSchema=false;
 drift=true;await assert.rejects(a.apply(plan.changes[0],plan.version),e=>e.status===409);assert.equal(writes,0);master[0].fields['项目名称']='正式名称';
 const again=await a.plan();await a.apply(again.changes[0],again.version);assert.equal(writes,1);assert.equal(mirrors[0].fields['项目名称'],'正式名称');
 foreign=true;const before=await a.plan();await assert.rejects(a.apply(before.changes.find(c=>c.binding==='PROJECTS_TABLE_ID'),before.version),e=>e.status===403);assert.equal(writes,1);
}finally{globalThis.fetch=realFetch;}

const data=new Map();let alarm=null,version='v1',changes=[{binding:'AUTH_PROJECTS_TABLE_ID',fields:{'项目名称':'目标'}}],attempts=0,lose=true;
const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k),setAlarm:async n=>{alarm=n;},deleteAlarm:async()=>{alarm=null;}};
const adapter={plan:async()=>({version,changes,issues:[],pendingProjects:[]}),apply:async(c,v)=>{assert.equal(v,version);attempts++;changes=[];version='v2';if(lose){lose=false;throw Error('response lost');}}};
const engine=()=>new ProjectSourceSync(storage,adapter,()=>1000);
await assert.rejects(engine().enable('stale'),e=>e.status===409);
await engine().enable('v1');assert.equal((await engine().step()).state,'retry_after_readback');
assert.equal((await engine().step()).state,'matched');assert.equal(attempts,1,'restart after ambiguous write reads actual state, no duplicate write');
adapter.plan=async()=>{throw Error('persistent failure');};
for(let i=0;i<5;i++)await engine().step();
assert.equal((await engine().status()).state,'manual_intervention');assert.equal(alarm,null);
console.log('PASS source sync: canonical mirror, verified derived ownership, no identity/authorization writes, schema and ER2 scope, stale plans, restart readback, finite retries');
