import assert from 'node:assert/strict';
import * as mfRuntime from 'miniflare';
import { build } from 'esbuild';
const bundle=await build({entryPoints:[new URL('./src/runtime.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'browser'});
const members=[{record_id:'student',fields:{'人员编号':'P-003','姓名':'运行时学生','飞书成员':[{id:'ou_student'}],'人员状态':'在组','人员边界':'团队内','成员类别':'博士'}}];
const bindings={SESSION_SECRET:'test-only',FEISHU_APP_ID:'test-only',FEISHU_APP_SECRET:'test-only',LEARNING_RECORDS_ENABLED:'true',
  MEMBERS_TABLE_ID:'members',MEMBERS_BASE_APP_TOKEN:'members-base',LEARNING_REVIEWER_PERSON_ID:'P-002',LEARNING_PROFESSOR_PERSON_ID:'P-001'};
const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',bindings,
  durableObjects:{LEARNING_RECORDS:{className:'LearningRecords',useSQLite:true},WEEKLY_WRITES:{className:'WeeklyWriteCoordinator',useSQLite:true}},
  outboundService:async request=>{
    const u=new URL(request.url);assert.equal(u.hostname,'open.feishu.cn');
    if(u.pathname.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'mock'});
    assert.equal(request.method,'GET','learning must not write any Feishu tables');
    assert.ok(u.pathname.endsWith('/members/records'),'must not read project/weekly/qualification tables');
    return Response.json({code:0,data:{items:members,has_more:false}});
  }};
const mf=new mfRuntime.Miniflare(mfRuntime.convertV4MiniflareOptions?mfRuntime.convertV4MiniflareOptions(options):options);
try {
  assert.equal((await mf.dispatchFetch('https://worker.test/api/learning')).status,401);
  const payload=Buffer.from(JSON.stringify({purpose:'session',sub:'ou_student',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(bindings.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url');
  const headers={Authorization:'Bearer '+payload+'.'+sig,'Content-Type':'application/json'};
  const body={requestId:'runtime-learning-request',trackId:'A',lessonId:'01',gains:'只填学习收获'};
  const replies=await Promise.all([1,2].map(()=>mf.dispatchFetch('https://worker.test/api/learning/submit',{method:'POST',headers,body:JSON.stringify(body)})));
  for(const r of replies){const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.equal(d.saved,true);assert.equal(d.event.seq,1);}
  const r=await mf.dispatchFetch('https://worker.test/api/learning/record?track=A&lesson=01',{headers});
  const detail=await r.json();assert.equal(detail.events.length,1);assert.equal(detail.events[0].gains,body.gains);
  members[0].fields['人员状态']='离组';
  assert.equal((await mf.dispatchFetch('https://worker.test/api/learning/record?track=A&lesson=01',{headers})).status,403);
  console.log('PASS real workerd SQLite learning storage, concurrent retry, readback, no unrelated table access and immediate departure denial');
} finally {await mf.dispose();}
