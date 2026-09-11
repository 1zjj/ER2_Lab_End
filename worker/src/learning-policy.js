import { authority, identity, personNumber, authError, isAdministrator, memberFeatures } from './authorization.js';
import { LEARNING_CATALOG } from './learning-catalog.js';

export function learningActor(people, sub) {
  // Common teaching material does not consume project grants. Only the existing
  // authoritative member identity/status rules are reused; no fields are written.
  const actor = authority(people, [], [], sub);
  if (!memberFeatures(actor).learningRead) throw authError(403, '当前账号没有学习资料访问权限');
  return actor;
}
export function learningRecipient(people, env, kind) {
  const reviewer = kind === 'reviewer';
  const id = env[reviewer ? 'LEARNING_REVIEWER_PERSON_ID' : 'LEARNING_PROFESSOR_PERSON_ID'];
  const matches = people.filter(p => personNumber(p) === id);
  if (!/^P-\d{3,}$/.test(id || '') || matches.length !== 1) throw authError(503, '课程接收人尚未正确配置');
  const actor = learningActor(people, identity(matches[0]));
  // Pin the approved people, not generic manager/professor/weekly duties.
  if (reviewer ? actor.name !== '朱俊杰' || !actor.duties.includes('课程审核') : actor.name !== '陈铮一' || actor.memberRecord.fields['成员类别'] !== 'PI')
    throw authError(503, '课程接收人身份或职责不匹配');
  return actor;
}
export function learningAccess(actor, people, env) {
  let reviewer;
  try { reviewer = learningRecipient(people, env, 'reviewer'); } catch (_) {}
  return { canRead: memberFeatures(actor).learningRead, canSubmit: memberFeatures(actor).learningSubmit,
    canReview: reviewer?.sub === actor.sub, canViewAll: isAdministrator(actor) };
}
export function learningLesson(trackId, lessonId) {
  const track = LEARNING_CATALOG.tracks.find(t => t.id === trackId && t.available);
  const lesson = track?.lessons.find(l => l.id === lessonId);
  if (!lesson) throw authError(400, '课程编号无效或尚未开放');
  return { track, lesson };
}
export function learningInput(body, kind) {
  const allowed = kind === 'submit' ? ['requestId', 'trackId', 'lessonId', 'gains', 'questions', 'suggestions'] :
    ['requestId', 'trackId', 'lessonId', 'subject', 'text'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k)))
    throw authError(400, '提交包含不支持的字段');
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId || '')) throw authError(400, '请求标识无效');
  learningLesson(body.trackId, body.lessonId);
  const result = { requestId: body.requestId, trackId: body.trackId, lessonId: body.lessonId };
  for (const key of kind === 'submit' ? ['gains', 'questions', 'suggestions'] : ['text']) {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || value.length > 10000 || ((key === 'gains' || key === 'text') && !value.trim()))
      throw authError(400, key === 'gains' ? '请填写学习与收获（最多 10000 字）' : '请填写有效文字，每项最多 10000 字');
    result[key] = value.trim();
  }
  if (body.subject !== undefined) {
    if (typeof body.subject !== 'string' || !/^ou_[\w-]+$/.test(body.subject)) throw authError(400, '学习记录归属无效');
    result.subject = body.subject;
  }
  return result;
}
export const learningRecordKey = (sub, track, lesson) => `record:${sub}:${track}:${lesson}`;
export const eventPrefix = key => 'event:' + key + ':';
export const eventKey = (key, seq) => eventPrefix(key) + String(seq).padStart(10, '0');
