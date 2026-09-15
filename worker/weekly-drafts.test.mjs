import assert from 'node:assert/strict';
import {routeDrafts,validateWeeklyImages,publishWeeklySnapshot} from './src/weekly-drafts.js';
import {WeeklyWriteCoordinator} from './src/weekly-coordinator.js';
import {shanghaiWeek} from './src/weekly-access.js';
import {normalizeImage} from './src/weekly-images.js';
import service from './src/runtime.js';
import {WEEKLY_FIELDS} from './src/weekly-write.js';
const week=shanghaiWeek(),env={SESSION_SECRET:'draft-mock-secret',FEISHU_APP_ID:'mock',FEISHU_APP_SECRET:'mock',FRONTEND_URL:'https://app.test',PROFESSOR_OPEN_ID:'ou_1',WEEKLY_DRAFTS_ENABLED:'true',WEEKLY_BACKFILL_ENABLED:'true',WEEKLY_START_DATES:JSON.stringify({'P-002':week.start,'P-003':week.start})};
for(const k of ['MEMBERS','WEEKLY']){env[k+'_TABLE_ID']=k.toLowerCase();env[k+'_BASE_APP_TOKEN']='mock';}
const person=(n,type)=>({record_id:'person'+n,fields:{'人员编号':'P-00'+n,'姓名':'模拟'+n,'飞书成员':[{id:'ou_'+n}],'人员边界':'团队内','成员类别':type,'人员状态':'在组'}});
const people=[person(1,'PI'),person(2,'博士'),person(3,'博士')],reports=[];
const objects=new Map(),stores=[];env.WEEKLY_WRITES={idFromName:n=>n,get(id){if(!objects.has(id)){const map=new Map();stores.push(map);const storage={
  get:async k=>structuredClone(map.get(k)),put:async(k,v)=>{map.set(k,structuredClone(v));},delete:async k=>{if(formalPhase&&k.endsWith(':pending'))return map.delete(k);throw Error('Unexpected deletion '+k);},
  list:async opts=>new Map([...map.entries()].filter(([k])=>k.startsWith(opts.prefix||'')&&(!opts.end||k<opts.end)).sort(([a],[b])=>opts.reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,opts.limit||1000)),
  transaction:async fn=>fn(storage)};objects.set(id,new WeeklyWriteCoordinator({storage},env));}return objects.get(id);}};
let upstreamWrites=0,formalPhase=false;const original=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{const url=new URL(input);assert.equal(url.hostname,'open.feishu.cn');if(url.pathname.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'mock'});
  if(url.pathname.endsWith('/fields'))return Response.json({code:0,data:{items:[...Object.entries(WEEKLY_FIELDS).map(([field_name,types])=>({field_name,type:types[0]})),...['首次提交时间','最近修改时间','提交类型','周报图文'].map(field_name=>({field_name,type:1}))],has_more:false}});
  if(options.method!=='GET'){assert.equal(formalPhase,true);assert.ok(url.pathname.includes('/tables/weekly/records'));upstreamWrites++;const fields=JSON.parse(options.body).fields;const record={record_id:'rec_formal',fields};reports.push(record);return Response.json({code:0,data:{record}});}
  return Response.json({code:0,data:{items:url.pathname.includes('/members/')?people:reports,has_more:false}});};
async function token(n){const p=Buffer.from(JSON.stringify({purpose:'session',sub:'ou_'+n,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return p+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(p))).toString('base64url');}
async function call(n,path,method='GET',body){return routeDrafts(new Request('https://worker.test/api/weekly-drafts'+path,{method,headers:{Authorization:'Bearer '+await token(n),Origin:env.FRONTEND_URL,...(body&&!(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof Uint8Array?body:JSON.stringify(body)}:{})}),env);}
try{
  assert.equal((await routeDrafts(new Request('https://worker.test/api/weekly-drafts'),env)).status,401);
  const empty=await(await call(2,'/week?weekId='+week.id)).json();assert.equal(empty.draft.revision,0);assert.equal(empty.editable,true);
  assert.equal(stores[0].size,0,'Reading current week does not create or overwrite a draft');
  const body={weekId:week.id,baseRevision:0,requestId:'draft-save-01',values:{progress:'尚未整理'},notes:[],scratch:'刚遇到的问题',images:[]};
  let saved=await(await call(2,'/week','PUT',body)).json();assert.equal(saved.draft.revision,1);assert.equal(saved.draft.scratch,body.scratch);
  const keysBefore=stores[0].size;assert.equal((await(await call(2,'/week','PUT',body)).json()).draft.revision,1);assert.equal(stores[0].size,keysBefore);
  const conflict=await call(2,'/week','PUT',{...body,requestId:'draft-save-02',values:{progress:'另一设备'},baseRevision:0});assert.equal(conflict.status,409);
  assert.equal((await call(1,'/week?weekId='+week.id+'&owner=ou_2')).status,403,'Professor cannot read private drafts');
  assert.equal((await call(3,'/week?weekId='+week.id+'&owner=ou_2')).status,403);
  const old=shanghaiWeek(week.startsAt-14*86400000).id;assert.equal((await(await call(2,'/week?weekId='+old)).json()).editable,false);
  assert.equal((await call(2,'/week','PUT',{...body,weekId:old})).status,400);
  const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1SMAAAAASUVORK5CYII=','base64'));
  assert.equal(normalizeImage(png).width,1);
  assert.throws(()=>normalizeImage(new TextEncoder().encode('<svg onload="alert(1)"/>')));
  const upload=await(await call(2,'/image?weekId='+week.id,'POST',png)).json();assert.ok(upload.image.ready);
  const id=upload.image.id;assert.equal((await(await call(2,'/image?weekId='+week.id,'POST',png)).json()).image.id,id);
  const refs=[{id,caption:'实验截图',section:'progress'}];
  saved=await(await call(2,'/week','PUT',{...body,baseRevision:1,requestId:'draft-save-03',images:refs})).json();assert.equal(saved.draft.revision,2);
  assert.ok([...stores[0].keys()].some(k=>k.startsWith('version:')&&k.endsWith('00000001')),'Older versions retained');
  assert.equal((await call(2,'/image?id='+id)).status,200);
  assert.equal((await call(3,'/image?id='+id+'&owner=ou_2')).status,403);
  assert.equal((await call(1,'/image?id='+id+'&owner=ou_2&recordId=rec_test&submission=request01')).status,403);
  reports.push({record_id:'rec_test',fields:{'飞书OpenID':'ou_2','请求ID':'request01','提交状态':'已提交','周报图文':JSON.stringify({images:refs})}});
  assert.equal((await call(1,'/image?id='+id+'&owner=ou_2&recordId=rec_test&submission=request01')).status,200);
  await publishWeeklySnapshot(env,{sub:'ou_2'},'rec_test',week.id,'request01',{progress:'正式提交'},refs);
  assert.equal((await validateWeeklyImages(env,{sub:'ou_2'},refs)).length,1);
  await assert.rejects(()=>validateWeeklyImages(env,{sub:'ou_3'},refs));
  people[1].fields['人员状态']='离组';assert.equal((await call(2,'/image?id='+id)).status,403);
  assert.equal(upstreamWrites,0,'Drafts never write Feishu records or messages');
  people[1].fields['人员状态']='在组';formalPhase=true;
  async function submit(body){return service.fetch(new Request('https://worker.test/api/reports',{method:'POST',headers:{Authorization:'Bearer '+await token(2),'Content-Type':'application/json'},body:JSON.stringify(body)}),env);}
  const formal={weekId:week.id,requestId:'formal-images-01',baseRevision:'',progress:'图文成果',nextPlan:'下一步',images:refs};
  const response=await submit(formal);const actual=await response.json();assert.equal(response.status,200,JSON.stringify(actual));assert.equal(actual.report.images[0].id,id);
  assert.equal((await submit(formal)).status,200);assert.equal(upstreamWrites,1,'Image retry must not create a second record');
  assert.equal((await submit({...formal,images:[{...refs[0],caption:'不同图片说明'}]})).status,409,'Idempotency includes image metadata');
  console.log('PASS private weekly drafts: partial/scratch save, idempotency, conflict, no deletion, history, image ownership, submitted-only teacher read, expiry and zero business writes');
}finally{globalThis.fetch=original;}
