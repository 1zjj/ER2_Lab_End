import assert from 'node:assert/strict';
import service from './src/runtime.js';
import {shanghaiWeek} from './src/weekly-access.js';
import {inspectTableReads,DIAGNOSTIC_TABLES} from './src/read-diagnostics.js';
const env={SESSION_SECRET:'test-isolation-secret',FEISHU_APP_ID:'fixture',FEISHU_APP_SECRET:'fixture',FRONTEND_URL:'https://fixture.test',WEEKLY_BACKFILL_ENABLED:'true',WEEKLY_START_DATES:'{"P-002":"2026-09-07"}',FILTERED_READS:'true'};
for(const k of ['MEMBERS','WEEKLY','PROJECTS','AUTH_PROJECTS','PROJECT_MEMBERS']){env[k+'_TABLE_ID']=k;env[k+'_BASE_APP_TOKEN']='fixture';}
const member={record_id:'person',fields:{'人员编号':'P-002','姓名':'模拟学生','飞书成员':[{id:'ou_fixture'}],'人员状态':'在组','人员边界':'团队内','成员类别':'博士','系统职责':[]}};
const week=shanghaiWeek().id;
let rows=[], calls=[],failSearch=false,denyProject=true;
const original=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
  assert.equal(new URL(url).hostname,'open.feishu.cn','No real external requests');
  if(String(url).endsWith('/tenant_access_token/internal')) return Response.json({code:0,tenant_access_token:'fixture',expire:7200});
  const table=String(url).match(/tables\/([^/]+)\/records/)?.[1]; assert.ok(table,String(url));calls.push(table);
  const search=String(url).includes('/search?');
  assert.ok(options.method==='GET'||search,'No mutation allowed');
  if(search){const filter=JSON.parse(options.body).filter;assert.ok(filter.conditions.some(c=>c.field_name==='飞书OpenID'&&c.value[0]==='ou_fixture'),'Non-reviewer uses owner-filtered query');}
  if(search&&failSearch)return Response.json({code:1254000,msg:'fixture incompatible filter'},{status:400});
  if(denyProject&&!['MEMBERS','WEEKLY'].includes(table)) return Response.json({code:99991672,msg:'fixture denied'},{status:403});
  // Intentionally return too-broad search results to test fallback/post-filter.
  return Response.json({code:0,data:{items:table==='MEMBERS'?[member]:table==='WEEKLY'?rows:[],has_more:false}});
};
const payload=Buffer.from(JSON.stringify({purpose:'session',sub:'ou_fixture',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url');
const call=path=>service.fetch(new Request('https://fixture.test'+path,{headers:{Authorization:'Bearer '+payload+'.'+signature}}),env);
try {
  for(failSearch of [false,true]){
    rows=[{record_id:'foreign',fields:{'飞书OpenID':'ou_other','周次':week,'关联项目':['private-project'],'本周完成':'PRIVATE_SENTINEL'}}];calls=[];
    const response=await call('/api/weekly'); assert.equal(response.status,200);
    assert.doesNotMatch(await response.text(),/PRIVATE_SENTINEL|private-project/);
    assert.ok(calls.every(t=>['MEMBERS','WEEKLY'].includes(t)),'Foreign report must not cause project dependency');
  }
  failSearch=false;
  rows=[{record_id:'own',fields:{'飞书OpenID':'ou_fixture','周次':week,'关联项目':['own-project']}}];
  assert.equal((await call('/api/weekly')).status,502,'Own project-scoped report still requires project authorization');
  rows=[{record_id:'old',fields:{'飞书OpenID':'ou_fixture','周次':'2020-W01','关联项目':['old-project']}}];calls=[];
  assert.equal((await call('/api/weekly')).status,200);
  assert.ok(!calls.includes('PROJECTS'),'Out-of-window record does not create dependency');
  assert.equal((await call('/api/admin/read-diagnostics')).status,403,'Student cannot read diagnostics');
  member.fields['系统职责']=['管理员'];
  const response=await call('/api/admin/read-diagnostics');assert.equal(response.status,200);
  const diagnostic=await response.json(); assert.equal(diagnostic.readComplete,false);assert.equal(diagnostic.tables.length,5);
  assert.equal(diagnostic.tables.find(t=>t.binding==='PROJECTS_TABLE_ID').upstreamStatus,403);
  assert.equal(diagnostic.tables.find(t=>t.binding==='WEEKLY_TABLE_ID').ok,true);
  assert.ok(diagnostic.tables.every(t=>Number.isFinite(t.durationMs)));
  assert.doesNotMatch(JSON.stringify(diagnostic),/ou_fixture|own-project|fixture denied|Bearer/);
  const failures=await inspectTableReads(env,'fixture',async()=>{throw Object.assign(new Error('secret'),{status:504,code:'READ_TIMEOUT'});});
  assert.deepEqual(failures.map(t=>t.binding),DIAGNOSTIC_TABLES); assert.ok(failures.every(t=>t.code==='READ_TIMEOUT'));
}finally{globalThis.fetch=original;}
console.log('PASS weekly read isolation, fallback filtering, retained project denial, admin-only per-table diagnostics');
