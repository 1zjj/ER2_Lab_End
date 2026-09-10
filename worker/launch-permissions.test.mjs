import assert from 'node:assert/strict';
import service from './src/runtime.js';
import { authority, canProject } from './src/authorization.js';

const env={SESSION_SECRET:'synthetic-launch-test-secret-32-characters',FEISHU_APP_ID:'fixture',FEISHU_APP_SECRET:'fixture',FRONTEND_URL:'https://fixture.test'};
for(const key of ['MEMBERS','AUTH_PROJECTS','PROJECT_MEMBERS','PROJECTS','WEEKLY','LITERATURE','LINKS','TASKS','COURSES']){env[key+'_TABLE_ID']=key.toLowerCase();env[key+'_BASE_APP_TOKEN']='base-'+key.toLowerCase();}
const person=(id,kind,boundary,duties=[])=>({record_id:'person'+id,fields:{'人员编号':'P-'+String(id).padStart(3,'0'),'姓名':'合成人员'+id,'飞书成员':[{id:'ou_fixture_'+id}],'成员类别':kind,'人员边界':boundary,'系统职责':duties,'人员状态':'在组','保密等级':'内部'}});
let people=[person(1,'PI','团队内',['管理员']),person(2,'RA','团队内',['管理员']),person(3,'博士','团队内'),person(4,'企业伙伴','团队外'),person(5,'临时','团队内',['管理员','课程审核'])];
const projects=[{record_id:'project1',fields:{'项目编号':'PRJ-001','项目阶段':'执行中','保密等级':'内部'}}];
let relations=[];
const rows={projects:[{record_id:'master1',fields:{'项目编号':'P01','统一项目编号':'PRJ-001','项目名称':'合成项目','项目主页':'https://lcnywl4yrecr.feishu.cn/wiki/Fixture'}}],literature:[{record_id:'internal-reading',fields:{'论文标题':'内部合成文献','提交时间':Date.now()}}]};
const realFetch=globalThis.fetch;let mutations=0;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(input);assert.equal(url.hostname,'open.feishu.cn');
 if(url.pathname.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'fixture',expire:7200});
 if(options.method!=='GET'){mutations++;throw Error('Unexpected write');}
 const m=url.pathname.match(/\/tables\/([^/]+)\/records$/);assert.ok(m,url.pathname);
 return Response.json({code:0,data:{items:({members:people,auth_projects:projects,project_members:relations})[m[1]]||rows[m[1]]||[],has_more:false}});
};
async function call(id,path,method='GET'){
 const payload=Buffer.from(JSON.stringify({purpose:'session',sub:'ou_fixture_'+id,roles:['manager','teacher'],exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url');
 return service.fetch(new Request('https://fixture.test'+path,{method,headers:{Authorization:'Bearer '+payload+'.'+sig}}),env);
}
try{
 for(const id of [4,5]){
  const start=await(await call(id,'/api/dashboard/start')).json();assert.equal(start.collaborator,true);assert.deepEqual(start.profile.roles,['collaborator']);assert.deepEqual(Object.keys(start.moduleLoading),['projects']);
  const full=await(await call(id,'/api/dashboard')).json();assert.equal(full.collaborator,true);assert.equal(JSON.stringify(full).includes('内部合成文献'),false);assert.equal('teacher' in full,false);
  for(const route of ['/api/literature','/api/weekly','/api/reports/history','/api/admin/native-permissions','/api/admin/project-consistency','/api/admin/permission-sync'])assert.equal((await call(id,route)).status,403,route);
  assert.equal((await call(id,'/api/literature','POST')).status,403);
  assert.equal((await call(id,'/api/reports','POST')).status,403);
 }
 assert.equal((await(await call(3,'/api/literature')).json()).literature.items.length,1);
 for(const id of [1,2]){
  const data=await(await call(id,'/api/projects')).json();assert.equal(data.projects.length,1);assert.equal(data.projects[0].permission,3);
 }
 assert.equal((await(await call(3,'/api/projects')).json()).projects.length,0);
 rows.projects.push({record_id:'new-master',fields:{'统一项目编号':'PRJ-099','项目名称':'新合成项目'}});
 assert.equal((await(await call(1,'/api/projects')).json()).projects.length,2);
 assert.equal((await call(1,'/api/projects/PRJ-099')).status,200);
 assert.equal((await call(3,'/api/projects/PRJ-099')).status,403);
 rows.projects.pop();
 const copy=structuredClone(people);copy[0].fields['系统职责']=[];assert.equal(canProject(authority(copy,projects,[],'ou_fixture_1'),'PRJ-001'),false);
 people[4].fields['访问到期日']='2000-01-01';assert.equal((await call(5,'/api/dashboard/start')).status,403);
 assert.equal(mutations,0);
 console.log('PASS launch policy: administrator new projects, external and internal-temporary isolation, expiry, private routes and no writes');
}finally{globalThis.fetch=realFetch;}
