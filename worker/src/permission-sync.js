import { authError } from './authorization.js';
import { permissionAuditContext } from './permission-audit.js';
import { PermissionReconciler } from './permission-reconciler.js';
import { nativePermissionAdapter } from './permission-native.js';
import { json } from './index.js';

export function permissionEngine(storage, env) {
  return new PermissionReconciler(storage, nativePermissionAdapter(env, storage));
}
export async function routePermissionSync(request, env) {
  try {
    await permissionAuditContext(request,env);
    if(!env.WEEKLY_WRITES)throw authError(503,'持久化权限任务尚未配置');
    // Separate durable object: permission scans never queue behind a student's
    // report or literature submission and cannot touch their stored journals.
    const id=env.WEEKLY_WRITES.idFromName('er2-native-permission-sync-v1:'+env.MEMBERS_BASE_WIKI_TOKEN);
    return env.WEEKLY_WRITES.get(id).fetch(request);
  }catch(e){return json(request,env,{message:e.status<500?e.message:'权限任务暂时不可用',code:e.code||'PERMISSION_SYNC_FAILED'},e.status||503);}
}
export async function executePermissionSync(request,env,storage) {
  try{
    await permissionAuditContext(request,env);
    const engine=permissionEngine(storage,env);
    if(request.method==='GET')return json(request,env,await engine.status());
    if(request.method!=='POST')throw authError(405,'不支持的权限任务操作');
    const body=await request.json();
    if(!body||Object.keys(body).some(k=>!['action','version'].includes(k)))throw authError(400,'权限任务字段无效');
    if(body.action==='inspect'){
      await storage.put('permission:inspect',true);
      await storage.setAlarm(Date.now()+1000);
      return json(request,env,await engine.record({state:'inspection_queued',appliedVersion:null}),202);
    }
    if(body.action==='disable')return json(request,env,await engine.disable());
    if(body.action==='enable'){
      const previous=await engine.status();
      if(previous.state!=='inspected'||previous.issues?.length||!body.version||body.version!==previous.targetVersion)
        throw authError(409,'须先完成当前版本的资源核对');
      return json(request,env,await engine.enable());
    }
    throw authError(400,'权限任务操作无效');
  }catch(e){return json(request,env,{message:e.status<500?e.message:'权限任务未完成',code:e.code||'PERMISSION_SYNC_FAILED'},e.status||503);}
}
export async function permissionAlarm(storage,env) {
  const engine=permissionEngine(storage,env);
  if(await storage.get('permission:inspect')){
    await storage.setAlarm(Date.now()+60000);
    try{await engine.inspect();await storage.delete('permission:inspect');}
    catch(e){await engine.record({state:'inspection_failed',issues:[{code:e.code||'INVENTORY_READ_FAILED',status:e.status||503}]});}
    if(!(await storage.get('permission:enabled'))&&!(await storage.get('permission:inspect')))await storage.deleteAlarm();
    return;
  }
  return engine.step();
}
