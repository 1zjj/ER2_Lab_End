import { authority, isAdministrator, authError } from './authorization.js';
import { canonicalProjectData, projectDisplayProjection, PROJECT_MASTER_VERSION } from './project-master.js';
import { permissionAuditContext } from './permission-audit.js';
import { listRecords, json } from './index.js';

export async function routeProjectConsistency(request, env) {
  try {
    const { token, actor } = await permissionAuditContext(request, env);
    if (request.method !== 'GET') throw authError(405, '此入口只核对项目主数据与派生结果');
    const [master, mirrors, relations] = await Promise.all(['PROJECTS_TABLE_ID', 'AUTH_PROJECTS_TABLE_ID', 'PROJECT_MEMBERS_TABLE_ID'].map(key => listRecords(env, token, key)));
    const people = await listRecords(env, token, 'MEMBERS_TABLE_ID');
    if (!isAdministrator(authority(people, [], [], actor.sub))) throw authError(403, '管理员职责已撤销');
    const catalog = canonicalProjectData(master, mirrors, relations);
    const projection = projectDisplayProjection(people, catalog.projects, catalog.relations);
    return json(request, env, { version: PROJECT_MASTER_VERSION, checkedAt: new Date().toISOString(),
      source: 'PROJECTS_TABLE_ID', mirror: 'AUTH_PROJECTS_TABLE_ID', relationshipSource: 'PROJECT_MEMBERS_TABLE_ID',
      issues: catalog.issues, projects: projection,
      definitions: {master: master.map(r=>({recordId:r.record_id,fields:Object.fromEntries(['项目编号','统一项目编号','ProjectID','项目名称','项目阶段','项目状态','状态','保密等级','是否启用','项目主页','项目负责人','成员'].filter(k=>k in (r.fields||{})).map(k=>[k,r.fields[k]]))})), mirrors:mirrors.map(r=>({recordId:r.record_id,fields:r.fields}))},
      people:people.map(r=>({recordId:r.record_id,fields:Object.fromEntries(['姓名','人员编号','成员编号','飞书成员','人员状态','人员边界','成员类别','系统职责','访问到期日','是否启用'].filter(k=>k in (r.fields||{})).map(k=>[k,r.fields[k]]))})), relationships:relations,
      pendingRelationships: relations.filter(r => r.fields?.['授权状态'] === '有效' && r.fields?.['权限落实状态'] !== '已落实').length,
      writesPerformed: false, nativeAccessCertified: false });
  } catch (e) {
    return json(request, env, { message: e.status < 500 ? e.message : '项目一致性核对未完成，请检查四张表的绑定与读取权限', code: e.code || 'PROJECT_CONSISTENCY_FAILED' }, e.status || 503);
  }
}
