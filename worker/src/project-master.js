import { authority, identity, personNumber, text } from './authorization.js';

export const PROJECT_MASTER_VERSION = 'project-master-v1';
const idPattern = /^PRJ-\d{3,}$/;
const refs = value => {
  if (value == null) return [];
  if (!Array.isArray(value) && Array.isArray(value.link_record_ids)) return value.link_record_ids.map(String);
  return (Array.isArray(value) ? value : [value]).flatMap(v => typeof v === 'string' ? [v] : v?.record_id ? [String(v.record_id)] : Array.isArray(v?.record_ids) ? v.record_ids.map(String) : []);
};

export function canonicalProjectId(record) {
  // Legacy P01/P02/P03 remain business labels and never authorize access.
  const ids = ['统一项目编号', 'ProjectID'].map(k => text(record?.fields?.[k])).filter(Boolean);
  return ids.length && ids.every(id => idPattern.test(id)) && new Set(ids).size === 1 ? ids[0] : '';
}

export function projectState(record) {
  const states = ['项目阶段', '项目状态', '状态'].map(k => text(record?.fields?.[k])).filter(Boolean);
  return states.length && new Set(states).size === 1 ? states[0] : '';
}

// 90.2 owns every project definition. 90.1 only translates existing linked
// record IDs. Its title, status and confidentiality can never replace 90.2.
export function canonicalProjectData(master, mirrors, relations) {
  const groups = new Map(), mirrorGroups = new Map(), aliases = new Map(), issues = [];
  for (const p of master) {
    const id = canonicalProjectId(p);
    if (!id) { issues.push({ code: 'MASTER_ID_INVALID', recordId: p.record_id }); continue; }
    groups.set(id, [...(groups.get(id) || []), p]);
  }
  for (const p of mirrors) {
    const id = text(p.fields?.['项目编号']);
    if (idPattern.test(id)) mirrorGroups.set(id, [...(mirrorGroups.get(id) || []), p]);
  }
  const projects = [];
  for (const [id, records] of groups) {
    if (records.length !== 1) { issues.push({ code: 'MASTER_ID_DUPLICATE', projectId: id }); continue; }
    const p = records[0], links = mirrorGroups.get(id) || [], state = projectState(p);
    const privacy = text(p.fields?.['保密等级']);
    let blocked = !state || !text(p.fields?.['项目名称']) || !privacy || p.fields?.['是否启用'] === false;
    if (blocked) issues.push({ code: 'MASTER_DEFINITION_INVALID', projectId: id });
    if (links.length > 1) { blocked = true; issues.push({ code: 'MIRROR_ID_DUPLICATE', projectId: id }); }
    if (links.length === 1) {
      const mirror = links[0];
      if (projectState(mirror) !== state || text(mirror.fields?.['保密等级']) !== privacy) {
        blocked = true; issues.push({ code: 'MIRROR_POLICY_DRIFT', projectId: id });
      }
      // A rename cannot replace the canonical title or increase any permission.
      if (text(mirror.fields?.['项目名称']) !== text(p.fields?.['项目名称'])) issues.push({ code: 'MIRROR_TITLE_DRIFT', projectId: id });
      aliases.set(mirror.record_id, p.record_id);
    }
    aliases.set(p.record_id, p.record_id);
    projects.push({ record_id: p.record_id, definitionBlocked: blocked, fields: {
      '项目编号': id, '项目名称': text(p.fields?.['项目名称']), '项目阶段': state, '保密等级': privacy,
      '项目主页': p.fields?.['项目主页']
    } });
  }
  for (const [id] of mirrorGroups) if (!groups.has(id)) issues.push({ code: 'ORPHAN_MIRROR', projectId: id });
  const translated = relations.map(r => {
    const linked = refs(r.fields?.['关联项目']);
    const ids = linked.map(id => aliases.get(id));
    // Preserve invalid associations as invalid. Do not turn a partial match into
    // a single valid association, and do not use labels as a fallback.
    const mapped = linked.map((id, index) => ids[index] || 'unresolved:' + id);
    return { ...r, fields: { ...r.fields, '关联项目': { link_record_ids: mapped } } };
  });
  return { projects, relations: translated, issues };
}

// These are display projections only. Global admin privileges never fabricate
// a business membership or a project owner. Call after the target version has
// been applied and verified, using the same relations used for authorization.
export function projectDisplayProjection(people, projects, relations, now = Date.now()) {
  const output = new Map(projects.map(p => [text(p.fields['项目编号']), { projectId: text(p.fields['项目编号']), recordId: p.record_id, owners: [], members: [], issues: [] }]));
  for (const person of people) {
    let actor;
    try { actor = authority(people, projects, relations, identity(person), now); } catch (_) { continue; }
    for (const [id, grant] of Object.entries(actor.grants)) {
      const item = output.get(id), relation = relations.find(r => r.record_id === grant.relationId);
      if (!item || !relation) continue;
      const participant = { personId: personNumber(person), openId: actor.sub, name: actor.name };
      item.members.push(participant);
      if (text(relation.fields?.['项目角色']) === '负责人') item.owners.push(participant);
    }
  }
  return [...output.values()].map(item => {
    item.members.sort((a, b) => a.personId.localeCompare(b.personId));
    if (item.owners.length > 1) { item.issues.push('MULTIPLE_ACTIVE_OWNERS'); item.owners = []; }
    return { ...item, ownerLabel: item.owners[0]?.name || '待指定', fields: {
      '项目负责人': item.owners.map(p => ({ id: p.openId })),
      '成员': item.members.map(p => ({ id: p.openId }))
    } };
  });
}
