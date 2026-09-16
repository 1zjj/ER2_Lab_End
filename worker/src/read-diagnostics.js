import { permissionAuditContext } from './permission-audit.js';
import { listRecords, json } from './index.js';
import { strictBinding, authError } from './authorization.js';

export const DIAGNOSTIC_TABLES = ['MEMBERS_TABLE_ID','WEEKLY_TABLE_ID','PROJECTS_TABLE_ID','AUTH_PROJECTS_TABLE_ID','PROJECT_MEMBERS_TABLE_ID'];
export async function inspectTableReads(env, token, read = listRecords) {
  return Promise.all(DIAGNOSTIC_TABLES.map(async binding => {
    const start = Date.now();
    try {
      strictBinding(env, binding);
      const records = await read(env, token, binding, {budgetMs:8000});
      return {binding, ok:true, durationMs:Date.now()-start, records:records.length};
    } catch (e) {
      const code = String(e.upstreamCode || e.code || (e.status===503 ? 'BINDING_OR_SOURCE_UNAVAILABLE' : 'READ_FAILED'));
      return {binding, ok:false, durationMs:Date.now()-start, status:Number(e.status)||502,
        ...(Number.isInteger(e.upstreamStatus)?{upstreamStatus:e.upstreamStatus}:{}),
        code:/^[A-Z0-9_]{1,80}$/.test(code)?code:'READ_FAILED'};
    }
  }));
}
export async function routeReadDiagnostics(request, env) {
  const started = Date.now(), diagnosticId = crypto.randomUUID();
  try {
    if (request.method !== 'GET') throw authError(405,'此诊断仅支持读取');
    const {token,actor} = await permissionAuditContext(request,env);
    // No snapshot reads: this is a deliberate live-source diagnostic.
    env.__er2ReadOnly = false;
    const tables = await inspectTableReads(env,token);
    const final = await permissionAuditContext(request,env);
    if (actor.sub !== final.actor.sub) throw authError(403,'管理员身份已变更');
    return json(request,env,{diagnosticId,checkedAt:new Date().toISOString(),durationMs:Date.now()-started,
      readComplete:tables.every(t=>t.ok),tables,writesPerformed:false,
      note:'耗时包含标识解析、分页与重试；只核验读取，不代表原生访问或应用资格已验收。'});
  } catch(e) {
    return json(request,env,{diagnosticId,message:e.status<500?e.message:'管理员身份或诊断读取未完成，请重试',code:'READ_DIAGNOSTIC_FAILED'},e.status||503);
  }
}
