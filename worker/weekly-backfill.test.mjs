import assert from 'node:assert/strict';
import service, { weeklyBackfillReadiness } from './src/index.js';
import { mockWeeklyCoordinator } from './test-weekly-coordinator.mjs';
import { WEEKLY_FIELDS } from './src/weekly-write.js';
import { shanghaiWeek } from './src/weekly-access.js';
const now = Date.now(), week = shanghaiWeek(now), previous = shanghaiWeek(week.startsAt - 1);
const env = { SESSION_SECRET:'mock-weekly-policy-secret', FEISHU_APP_ID:'mock', FEISHU_APP_SECRET:'mock',
  FRONTEND_URL:'https://example.test', WEEKLY_BACKFILL_ENABLED:'true', WEEKLY_REVIEWER_OPEN_ID:'ou_1', PROFESSOR_OPEN_ID:'ou_1',
  WEEKLY_START_DATES: JSON.stringify({'P-002':previous.start,'P-006':week.start}) };
for (const key of ['MEMBERS','PROJECTS','AUTH_PROJECTS','PROJECT_MEMBERS','WEEKLY','AUTOMATION_LOGS']) {
  env[key+'_TABLE_ID'] = key.toLowerCase(); env[key+'_BASE_APP_TOKEN'] = 'mock-base';
}
env.WEEKLY_WRITES = mockWeeklyCoordinator(env);
const person = (i, type, boundary, duties=[]) => ({record_id:'p'+i,fields:{'人员编号':'P-00'+i,'姓名':'模拟'+i,
  '飞书成员':[{id:'ou_'+i}],'人员状态':'在组','人员边界':boundary,'成员类别':type,'系统职责':duties}});
const people = [person(1,'PI','团队内'),person(2,'RA','团队内',['管理员','课程审核']),
  person(5,'PI','团队外'),person(6,'联合培养','团队外')];
const rows = [];
let writes = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options={}) => {
  const url = new URL(input); assert.equal(url.hostname,'open.feishu.cn');
  if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({code:0,tenant_access_token:'mock-token'});
  if (url.pathname.endsWith('/fields')) return Response.json({code:0,data:{items:[
    ...Object.entries(WEEKLY_FIELDS).map(([field_name,types])=>({field_name,type:types[0]})),
    ...['首次提交时间','最近修改时间','提交类型'].map(field_name=>({field_name,type:1}))],has_more:false}});
  const match = /\/tables\/([^/]+)\/records(?:\/([^/]+))?$/.exec(url.pathname);
  assert.ok(match, 'Unexpected network action '+url.pathname);
  const [,table,id] = match;
  if (options.method === 'GET') return Response.json({code:0,data:{items:table==='members'?people:table==='weekly'?rows:[],has_more:false}});
  assert.equal(table,'weekly','No non-weekly writes permitted');
  const fields = JSON.parse(options.body).fields; writes++;
  const record = id ? rows.find(r=>r.record_id===id) : {record_id:'r'+writes,fields:{}};
  Object.assign(record.fields, fields); if (!id) rows.push(record);
  return Response.json({code:0,data:{record}});
};
async function call(id,path,body) {
  const payload = Buffer.from(JSON.stringify({purpose:'session',sub:'ou_'+id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url');
  const response = await service.fetch(new Request('https://example.test'+path,{method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+payload+'.'+signature,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
  return {status:response.status,data:await response.json()};
}
const form = (weekId,id) => ({weekId,requestId:id,baseRevision:'',progress:'真实结果',nextPlan:'下一步'});
try {
  assert.equal((await weeklyBackfillReadiness(env)).ready,true);
  assert.equal((await weeklyBackfillReadiness({...env,PROFESSOR_OPEN_ID:'ou_2'})).ready,false);
  assert.equal((await weeklyBackfillReadiness({...env,WEEKLY_START_DATES:'{}'})).ready,false);
  const denied = await call(6,'/api/reports',form(previous.id,'before-start'));
  assert.equal(denied.status,400); assert.equal(writes,0);
  const submitted = await call(6,'/api/reports',form(week.id,'current'));
  assert.equal(submitted.status,200,JSON.stringify(submitted));
  assert.equal(submitted.data.weekId,week.id);
  assert.equal((await call(5,'/api/reports',form(week.id,'teacher'))).status,403);
  const backfill = await call(2,'/api/reports',form(previous.id,'backfill'));
  assert.equal(backfill.status,200,JSON.stringify(backfill));
  assert.equal(rows.find(r=>r.fields['飞书OpenID']==='ou_2').fields['提交类型'],'历史补交');
  const repeat = await call(2,'/api/reports',form(previous.id,'backfill'));
  assert.equal(repeat.status,200); assert.equal(writes,2);
  assert.equal((await call(2,'/api/reports',{...form(previous.id,'changed'),progress:'覆盖内容'})).status,409);
  const admin = await call(2,'/api/weekly');
  assert.equal(admin.status,200,JSON.stringify(admin));
  assert.deepEqual(admin.data.teacher.students,[]);
  assert.equal(admin.data.student.report.status,'pending','Backfill must not complete current week');
  const pi = await call(1,'/api/weekly');
  assert.equal(pi.status,200,JSON.stringify(pi)); assert.equal(pi.data.teacher.students.length,2);
  assert.ok(pi.data.teacher.students.some(s=>s.id==='ou_6'));
  assert.equal((await call(2,'/api/reports/history?person=ou_6')).status,403);
  assert.equal((await call(6,'/api/reports/history?person=ou_2')).status,403);
  assert.equal((await call(1,'/api/reports/history?person=ou_6')).data.reports.length,1);
  assert.equal((await call(2,'/api/teacher/review',{recordId:rows[0].record_id,comment:'越权',requestId:'review-denied'})).status,403);
  assert.equal((await call(1,'/api/teacher/review',{recordId:rows[0].record_id,comment:'已阅',requestId:'review-ok'})).status,200);
  console.log('PASS enabled weekly API: external current-only start, previous-week backfill, idempotency, no overwrite, private admin view, sole reviewer; all network mocked');
} finally { globalThis.fetch = originalFetch; }
