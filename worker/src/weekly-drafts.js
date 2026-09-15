import {requireSession,requireMemberIdentity,json,getTenantToken,listRecords} from './index.js';
import {resolveTableBinding} from './v2/bindings.js';
import {weeklyHash} from './weekly-history.js';
import {owesWeekly,reviewsWeekly,selectWeeklyTarget,shanghaiWeek} from './weekly-access.js';
import {validateImageRefs,normalizeImage,IMAGE_LIMIT,imageManifest} from './weekly-images.js';
import {readScope} from './read-performance.js';
export const DRAFT_VERSION='weekly-drafts-v1';
export const draftsEnabled=env=>env.WEEKLY_DRAFTS_ENABLED==='true';
export async function draftReadiness(env){if(!draftsEnabled(env))return {enabled:false};try{const r=await(await draftObject(env,'health')).fetch(new Request('https://internal/_draft/health'));return {enabled:true,ready:r.ok&&(await r.json()).version===DRAFT_VERSION,version:DRAFT_VERSION,privateImages:true};}catch(_){return {enabled:true,ready:false};}}
const fail=(status,message)=>Object.assign(new Error(message),{status});
const weekKey=value=>{if(!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value||''))throw fail(400,'周次无效');return value;};
async function actorFor(request,env){env.__er2ReadOnly=true;return requireMemberIdentity(env,await requireSession(request,env));}
export async function draftObject(env,owner){
  const b=resolveTableBinding(env,'WEEKLY_TABLE_ID');if(!env.WEEKLY_WRITES||!b.tableId||!(b.appToken||b.wikiToken))throw fail(503,'草稿存储未配置');
  const key=await weeklyHash(['private-weekly-draft-v1',b.appToken||b.wikiToken,b.tableId,owner]);
  return env.WEEKLY_WRITES.get(env.WEEKLY_WRITES.idFromName(key));
}
export async function routeDrafts(request,env){
  if(request.method==='OPTIONS'){const response=json(request,env,{});response.headers.set('Access-Control-Allow-Methods','GET, PUT, POST, OPTIONS');return response;}
  if(!draftsEnabled(env))return json(request,env,{message:'云端草稿尚未启用'},503);
  try{const signed=await requireSession(request,env);const url=new URL(request.url),owner=url.searchParams.get('owner')||signed.sub;
    if(!/^ou_[\w-]+$/.test(owner))throw fail(400,'账号标识无效');
    const headers=new Headers(request.headers);headers.set('X-ER2-Draft-Owner',owner);headers.delete('X-ER2-Published-Image');
    if(owner!==signed.sub){const actor=await actorFor(request,readScope(env,request));
      if(url.pathname!=='/api/weekly-drafts/image'||request.method!=='GET'||!reviewsWeekly(actor,env))throw fail(403,'草稿仅本人可见');
      const records=await listRecords(env,await getTenantToken(env),'WEEKLY_TABLE_ID');
      const text=value=>Array.isArray(value)?value.map(v=>v.text||'').join(''):String(value||'');
      const record=records.find(r=>r.record_id===url.searchParams.get('recordId')&&text(r.fields['飞书OpenID'])===owner&&text(r.fields['请求ID'])===url.searchParams.get('submission')&&text(r.fields['提交状态'])==='已提交');
      if(!record||!imageManifest(record).some(i=>i.id===url.searchParams.get('id')))throw fail(403,'图片不属于有效的正式提交');
      headers.set('X-ER2-Published-Image',url.searchParams.get('id'));
    }
    return (await draftObject(env,owner)).fetch(new Request(request,{headers}));
  }catch(error){return draftError(request,env,error);}
}
function draftError(request,env,error){return json(request,env,{code:error.code||'DRAFT_FAILED',message:error.status?error.message:'草稿暂时无法同步，本机内容请保留'},error.status||503);}
async function parse(request){const text=await request.text();if(new TextEncoder().encode(text).length>90000)throw fail(413,'草稿内容过长，请分批整理');try{return JSON.parse(text);}catch(_){throw fail(400,'草稿格式无效');}}
function requestId(id){if(typeof id!=='string'||!/^[\w-]{8,100}$/.test(id))throw fail(400,'保存请求标识无效');return id;}
async function ownedImages(storage,refs){const images=validateImageRefs(refs);let total=0;for(const item of images){const meta=await storage.get('image:'+item.id);if(!meta?.ready)throw fail(409,'图片尚未上传完成或不属于当前账号');total+=meta.size;}if(total>10*IMAGE_LIMIT)throw fail(400,'本周图片总量超出限制');return images;}
export async function validateWeeklyImages(env,actor,images){
  validateImageRefs(images);
  if(!images.length)return [];
  if(!draftsEnabled(env))throw fail(503,'图片功能未启用');
  const response=await (await draftObject(env,actor.sub)).fetch(new Request('https://internal/_draft/validate',{method:'POST',body:JSON.stringify({owner:actor.sub,images})}));
  const data=await response.json();if(!response.ok)throw fail(response.status,data.message);return data.images;
}
export async function publishWeeklySnapshot(env,actor,record,weekId,request,values,images,submissionType=''){
  if(!draftsEnabled(env))return;
  const response=await(await draftObject(env,actor.sub)).fetch(new Request('https://internal/_draft/publish',{method:'POST',body:JSON.stringify({owner:actor.sub,recordId:record,weekId,requestId:request,values,images,submissionType})}));
  if(!response.ok)throw fail(503,'正式记录已保存，草稿快照待确认，请使用原请求核对');
}
export async function executeDraft(request,env,storage){
  try{
    const url=new URL(request.url),path=url.pathname;
    if(path==='/_draft/health')return Response.json({ok:true,version:DRAFT_VERSION});
    if(path==='/_draft/validate'||path==='/_draft/publish'){
      const body=await parse(request);const known=await storage.get('owner');
      if(known&&known!==body.owner)throw fail(403,'草稿所属账号不一致');
      if(path==='/_draft/validate')return Response.json({images:await ownedImages(storage,body.images)});
      if(!/^rec[\w-]+$/.test(body.recordId)||typeof body.requestId!=='string'||body.requestId.length>200)throw fail(400,'正式记录标识无效');
      weekKey(body.weekId);const images=await ownedImages(storage,body.images||[]),key='submitted:'+body.recordId+':'+await weeklyHash(body.requestId);
      const prior=await storage.get(key);if(!prior){await storage.put('owner',body.owner);await storage.put(key,{...body,images,savedAt:new Date().toISOString()});}
      await storage.put('submission-week:'+body.weekId,{recordId:body.recordId,requestId:body.requestId,status:body.submissionType==='历史补交'?'已补交':'已有正式提交'});
      if(!await storage.get('draft:'+body.weekId)){
        const draft={weekId:body.weekId,revision:1,savedAt:new Date().toISOString(),values:body.values,notes:[],images,scratch:'',hash:await weeklyHash({values:body.values,notes:[],images,scratch:''})};
        await storage.transaction(async tx=>{await tx.put('version:'+body.weekId+':00000001',draft);await tx.put('draft:'+body.weekId,draft);});
      }
      return Response.json({ok:true});
    }
    env=readScope(env,request);const actor=await actorFor(request,env),owner=request.headers.get('X-ER2-Draft-Owner')||actor.sub;
    if(owner!==actor.sub&&(path!=='/api/weekly-drafts/image'||request.method!=='GET'||!reviewsWeekly(actor,env)))throw fail(403,'草稿仅本人可见');
    const known=await storage.get('owner');if(known&&known!==owner)throw fail(403,'草稿所属账号不一致');
    if(path==='/api/weekly-drafts/image'&&request.method==='GET'){
      const id=url.searchParams.get('id');if(!/^img_[a-f0-9]{64}$/.test(id||''))throw fail(400,'图片标识无效');
      if(owner!==actor.sub){const record=url.searchParams.get('recordId'),requestIdValue=url.searchParams.get('submission');
        if(!record||!requestIdValue)throw fail(403,'仅已提交图片可供教授查看');
        if(request.headers.get('X-ER2-Published-Image')!==id)throw fail(403,'图片不属于该次正式提交');
      }
      const meta=await storage.get('image:'+id);if(!meta?.ready)throw fail(404,'图片不存在');const data=new Uint8Array(meta.size);let offset=0;
      for(let i=0;i<meta.chunks;i++){const part=await storage.get('bytes:'+id+':'+i);if(!part)throw fail(503,'图片读取不完整');data.set(new Uint8Array(part),offset);offset+=part.byteLength;}
      const headers=new Headers(json(request,env,{}).headers);headers.set('Content-Type',meta.mime);headers.set('Cache-Control','private, no-store');headers.set('Content-Disposition','inline');headers.set('X-Content-Type-Options','nosniff');return new Response(data,{headers});
    }
    if(request.method==='GET'&&path==='/api/weekly-drafts'){
      const page=await storage.list({prefix:'draft:',reverse:true,limit:52,...(url.searchParams.get('cursor')?{end:url.searchParams.get('cursor')}:{})});
      const weeks=await Promise.all([...page.values()].map(async d=>({weekId:d.weekId,revision:d.revision,savedAt:d.savedAt,status:(await storage.get('submission-week:'+d.weekId))?.status||'草稿'})));
      return json(request,env,{version:DRAFT_VERSION,currentWeek:shanghaiWeek(),weeks,cursor:page.size===52?[...page.keys()].at(-1):null});
    }
    if(request.method==='GET'&&path==='/api/weekly-drafts/week'){
      const weekId=weekKey(url.searchParams.get('weekId'));let editable=false;try{selectWeeklyTarget(actor,env,weekId);editable=true;}catch(_){}
      const draft=await storage.get('draft:'+weekId)||{weekId,revision:0,values:{},notes:[],images:[],savedAt:null};
      return json(request,env,{version:DRAFT_VERSION,draft,editable,currentWeek:shanghaiWeek(),submission:await storage.get('submission-week:'+weekId)||null});
    }
    if(request.method==='POST'&&path==='/api/weekly-drafts/image'){
      selectWeeklyTarget(actor,env,weekKey(url.searchParams.get('weekId')));
      if(Number(request.headers.get('Content-Length')||0)>IMAGE_LIMIT)throw fail(413,'图片过大');
      const reader=request.body?.getReader();if(!reader)throw fail(400,'未收到图片');const parts=[];let size=0;
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>IMAGE_LIMIT){await reader.cancel();throw fail(413,'图片过大');}parts.push(part.value);}
      const bytes=new Uint8Array(size);let position=0;for(const part of parts){bytes.set(part,position);position+=part.length;}
      const normalized=normalizeImage(bytes);
      const digest=await crypto.subtle.digest('SHA-256',normalized.bytes);const id='img_'+[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
      const existing=await storage.get('image:'+id);if(existing?.ready)return json(request,env,{image:existing});
      const count=[...(await storage.list({prefix:'image:',limit:1001})).keys()].length;if(count>=1000)throw fail(413,'图片存储已达初版上限，请联系管理员扩容；不会自动删除旧图片');
      const chunks=Math.ceil(normalized.bytes.length/65536),meta={id,mime:normalized.mime,size:normalized.bytes.length,width:normalized.width,height:normalized.height,chunks,ready:true};
      // Same-person draft mutations are serialized; ready is committed last.
      await storage.put('owner',owner);for(let i=0;i<chunks;i++)await storage.put('bytes:'+id+':'+i,normalized.bytes.slice(i*65536,(i+1)*65536));await storage.put('image:'+id,meta);
      return json(request,env,{image:meta});
    }
    if(request.method==='PUT'&&path==='/api/weekly-drafts/week'){
      const body=await parse(request),weekId=weekKey(body.weekId);selectWeeklyTarget(actor,env,weekId);requestId(body.requestId);
      const values={};for(const [key,max]of Object.entries({progress:5000,learning:3000,evidence:5000,blockers:3000,nextPlan:3000})){const value=body.values?.[key]??'';if(typeof value!=='string'||value.length>max)throw fail(400,'草稿正文格式或长度无效');values[key]=value;}
      if(!Array.isArray(body.notes)||body.notes.length>40)throw fail(400,'每周最多40条日常记录');const ids=new Set();
      const scratch=body.scratch??'';if(typeof scratch!=='string'||scratch.length>1000)throw fail(400,'随手记录过长');
      const notes=body.notes.map(n=>{if(!n||typeof n.id!=='string'||!/^[\w-]{8,100}$/.test(n.id)||ids.has(n.id)||typeof n.text!=='string'||n.text.length>1000||!['progress','blockers','idea'].includes(n.kind))throw fail(400,'日常记录格式无效');ids.add(n.id);return {id:n.id,text:n.text,kind:n.kind};});
      const images=await ownedImages(storage,body.images||[]);const hash=await weeklyHash({values,notes,images,scratch});const receiptKey='saved:'+weekId+':'+body.requestId;
      const receipt=await storage.get(receiptKey);if(receipt){if(receipt.hash!==hash)throw fail(409,'请求内容已变化，请重新保存');return json(request,env,{draft:await storage.get(receipt.versionKey),saved:true});}
      const prior=await storage.get('draft:'+weekId);if(body.baseRevision!==(prior?.revision||0))return json(request,env,{code:'DRAFT_CONFLICT',message:'另一设备已修改草稿。本机内容已保留，请先另存冲突副本再载入云端版本。',latest:prior},409);
      if(prior?.hash===hash)return json(request,env,{draft:prior,saved:true});
      const savedAt=new Date().toISOString(),revision=(prior?.revision||0)+1;
      const draft={weekId,revision,savedAt,hash,values,images,scratch,notes:notes.map(n=>({...n,createdAt:prior?.notes?.find(p=>p.id===n.id)?.createdAt||savedAt}))};
      const versionKey='version:'+weekId+':'+String(revision).padStart(8,'0');
      await storage.transaction(async tx=>{await tx.put('owner',owner);await tx.put(versionKey,draft);await tx.put('draft:'+weekId,draft);await tx.put(receiptKey,{hash,versionKey});});
      return json(request,env,{draft,saved:true,currentWeek:shanghaiWeek()});
    }
    throw fail(404,'草稿接口不存在');
  }catch(error){return draftError(request,env,error);}
}
