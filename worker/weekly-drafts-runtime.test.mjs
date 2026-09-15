import assert from 'node:assert/strict';
import * as mfRuntime from 'miniflare';
import {build} from 'esbuild';
import {shanghaiWeek} from './src/weekly-access.js';
const week=shanghaiWeek(),script=(await build({entryPoints:[new URL('./src/runtime.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'browser'})).outputFiles[0].text;
const bindings={FEISHU_APP_ID:'mock',FEISHU_APP_SECRET:'mock',SESSION_SECRET:'mock-draft-runtime',WEEKLY_DRAFTS_ENABLED:'true',WEEKLY_BACKFILL_ENABLED:'true',WEEKLY_START_DATES:JSON.stringify({'P-002':week.start}),MEMBERS_TABLE_ID:'members',MEMBERS_BASE_APP_TOKEN:'base',WEEKLY_TABLE_ID:'weekly',WEEKLY_BASE_APP_TOKEN:'base'};
let businessWrites=0;
const opts={modules:true,script,compatibilityDate:'2026-08-01',bindings,durableObjects:{WEEKLY_WRITES:{className:'WeeklyWriteCoordinator',useSQLite:true}},outboundService:async request=>{
  const url=new URL(request.url);assert.equal(url.hostname,'open.feishu.cn');
  if(url.pathname.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'mock'});
  if(request.method!=='GET')businessWrites++;assert.equal(request.method,'GET');
  return Response.json({code:0,data:{has_more:false,items:[{record_id:'rec_person',fields:{'人员编号':'P-002','姓名':'模拟学生','飞书成员':[{id:'ou_draft'}],'人员边界':'团队内','成员类别':'博士','人员状态':'在组'}}]}});
}};
const mf=new mfRuntime.Miniflare(mfRuntime.convertV4MiniflareOptions?mfRuntime.convertV4MiniflareOptions(opts):opts);
try{
  const p=Buffer.from(JSON.stringify({purpose:'session',sub:'ou_draft',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(bindings.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(p))).toString('base64url'),headers={Authorization:'Bearer '+p+'.'+sig,'Content-Type':'application/json'};
  const body={weekId:week.id,baseRevision:0,requestId:'draft-runtime-save',values:{progress:'运行时保存'},notes:[],scratch:'临时问题',images:[]};
  const responses=await Promise.all([1,2].map(()=>mf.dispatchFetch('https://worker.test/api/weekly-drafts/week',{method:'PUT',headers,body:JSON.stringify(body)})));
  for(const response of responses){const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.draft.revision,1);}
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1SMAAAAASUVORK5CYII=','base64');
  const uploaded=await mf.dispatchFetch('https://worker.test/api/weekly-drafts/image?weekId='+week.id,{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:png});const image=await uploaded.json();assert.equal(uploaded.status,200,JSON.stringify(image));
  const downloaded=await mf.dispatchFetch('https://worker.test/api/weekly-drafts/image?id='+image.image.id,{headers});assert.equal(downloaded.status,200);assert.equal((await downloaded.arrayBuffer()).byteLength,image.image.size);
  const read=await mf.dispatchFetch('https://worker.test/api/weekly-drafts/week?weekId='+week.id,{headers});assert.equal((await read.json()).draft.scratch,'临时问题');
  assert.equal((await mf.dispatchFetch('https://worker.test/api/weekly-drafts/image?id='+image.image.id)).status,401);
  assert.equal(businessWrites,0);console.log('PASS real SQLite draft transactions, duplicate save, private image byte roundtrip, anonymous denial and no Feishu writes');
}finally{await mf.dispose();}
