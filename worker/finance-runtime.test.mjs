import assert from 'node:assert/strict';
import * as mfRuntime from 'miniflare';
import { build } from 'esbuild';
const entry=new URL('./src/runtime.js',import.meta.url).pathname,finance=new URL('./src/finance.js',import.meta.url).pathname;
const bundle=await build({stdin:{contents:`import runtime from ${JSON.stringify(entry)}; import { EQUIPMENT } from ${JSON.stringify(new URL('./src/finance-policy.js',import.meta.url).pathname)}; import { FinanceRecords as Actual } from ${JSON.stringify(finance)}; export { LearningRecords, WeeklyWriteCoordinator } from ${JSON.stringify(entry)}; export class FinanceRecords extends Actual { constructor(state,env){super(state,env);state.blockConcurrencyWhile(()=>state.storage.put('settings',{ready:true,equipmentBinding:EQUIPMENT,equipmentVerified:EQUIPMENT}));} } export default runtime;`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser'});
const members=[{record_id:'student',fields:{'人员编号':'P-003','姓名':'测试申报人','飞书成员':[{id:'ou_student'}],'人员状态':'在组','人员边界':'团队内','成员类别':'博士'}}];
const bindings={SESSION_SECRET:'test-only',FEISHU_APP_ID:'test-only',FEISHU_APP_SECRET:'test-only',FINANCE_ENABLED:'true',MEMBERS_TABLE_ID:'members',MEMBERS_BASE_APP_TOKEN:'membersbase'};
const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',bindings,durableObjects:{FINANCE_RECORDS:{className:'FinanceRecords',useSQLite:true},LEARNING_RECORDS:{className:'LearningRecords',useSQLite:true},WEEKLY_WRITES:{className:'WeeklyWriteCoordinator',useSQLite:true}},outboundService:async request=>{const u=new URL(request.url);assert.equal(u.hostname,'open.feishu.cn');if(u.pathname.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'mock'});assert.equal(request.method,'GET');assert.ok(u.pathname.endsWith('/members/records'));return Response.json({code:0,data:{items:members,has_more:false}});}};
const mf=new mfRuntime.Miniflare(mfRuntime.convertV4MiniflareOptions?mfRuntime.convertV4MiniflareOptions(options):options);
try{
  for(const path of ['','/setup','/records?review=true','/attachment'])assert.equal((await mf.dispatchFetch('https://worker.test/api/finance'+path)).status,401);
  const payload=Buffer.from(JSON.stringify({purpose:'session',sub:'ou_student',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(bindings.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']),sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url');
  const headers={Authorization:'Bearer '+payload+'.'+sig,'Content-Type':'application/json'},body={requestId:'concurrent-draft-request',kind:'claim',submit:false,lines:[{name:'设备',quantity:'',unitPrice:'',purchaseDate:''}]};
  const responses=await Promise.all([1,2].map(()=>mf.dispatchFetch('https://worker.test/api/finance/save',{method:'POST',headers,body:JSON.stringify(body)})));let ids=[];
  for(const r of responses){const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));ids.push(d.document.id);}assert.equal(ids[0],ids[1]);
  const records=await(await mf.dispatchFetch('https://worker.test/api/finance/records',{headers})).json();assert.equal(records.records.length,1);
  assert.equal((await mf.dispatchFetch('https://worker.test/api/finance/setup',{headers})).status,403);
  members[0].fields['人员状态']='离组';assert.equal((await mf.dispatchFetch('https://worker.test/api/finance/record?id='+ids[0],{headers})).status,403);
  console.log('PASS finance real SQLite transactions, concurrent retry, private records, anonymous denial and immediate departure denial');
}finally{await mf.dispose();}
