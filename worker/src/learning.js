import { requireSession, getTenantToken, listRecords, feishuRequest, stableMessageUuid, json } from './index.js';
import { strictBinding, authError } from './authorization.js';
import { LEARNING_CATALOG, LEARNING_VERSION } from './learning-catalog.js';
import { learningActor, learningRecipient, learningAccess, learningInput, learningRecordKey, eventKey, eventPrefix } from './learning-policy.js';
import { readScope } from './read-performance.js';

export const LEARNING_STORE_NAME = 'er2-learning-text-v1';
export const learningEnabled = env => env.LEARNING_RECORDS_ENABLED === 'true' && Boolean(env.LEARNING_RECORDS);
export async function learningRecipientsReady(env) {
  try {
    strictBinding(env, 'MEMBERS_TABLE_ID');
    const people = await listRecords(env, await getTenantToken(env), 'MEMBERS_TABLE_ID');
    learningRecipient(people, env, 'reviewer'); learningRecipient(people, env, 'professor');
    return true;
  } catch (_) { return false; }
}
async function allNotices(storage) {
  const entries = []; let cursor = '';
  while (true) {
    const page = [...(await storage.list({ prefix: 'notice:', ...(cursor ? { startAfter: cursor } : {}), limit: 1000 })).entries()];
    entries.push(...page);
    if (page.length < 1000) return entries;
    cursor = page.at(-1)[0];
  }
}
export async function learningContext(request, env) {
  const session = await requireSession(request, env);
  strictBinding(env, 'MEMBERS_TABLE_ID');
  const token = await getTenantToken(env);
  const people = await listRecords(env, token, 'MEMBERS_TABLE_ID');
  const actor = learningActor(people, session.sub);
  return { actor, people, token, access: learningAccess(actor, people, env) };
}
export async function routeLearning(request, env) {
  try {
    await requireSession(request, env);
    if (!learningEnabled(env)) throw authError(503, '逐课记录暂未开放，课程教材仍可从学习资料入口阅读');
    return await env.LEARNING_RECORDS.get(env.LEARNING_RECORDS.idFromName(LEARNING_STORE_NAME)).fetch(request);
  } catch (error) { return learningError(request, env, error); }
}
export function learningError(request, env, error) {
  const status = Number(error.status || 503);
  if (status >= 500) console.error('ER2_LEARNING_ERROR', error.code || error.name || 'Unavailable');
  return json(request, env, { code: error.code || 'LEARNING_UNAVAILABLE', message: status >= 500 ?
    '学习记录暂时无法处理，已填写内容请保留后重试；这不影响周报和入组说明。' : error.message }, status);
}
const fingerprint = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map(b => b.toString(16).padStart(2, '0')).join('');
const compactRecord = r => ({ subject: r.subject, personId: r.personId, name: r.name, trackId: r.trackId,
  lessonId: r.lessonId, submittedAt: r.submittedAt, updatedAt: r.updatedAt, count: r.count, lastKind: r.lastKind });
async function ownRecords(storage, sub, personId = '') {
  const records = [...(await storage.list({ prefix: `record:${sub}:`, limit: 1000 })).values()];
  if (personId && records.some(r => r.personId !== personId)) throw authError(403, '账号与历史学习记录身份不一致');
  return records.map(compactRecord);
}
function subjectFor(query, context, review = false) {
  const sub = query || context.actor.sub;
  if (!/^ou_[\w-]+$/.test(sub)) throw authError(400, '学习记录归属无效');
  if (review && !context.access.canReview) throw authError(403, '仅指定课程审核人可回复学习记录');
  if (sub !== context.actor.sub && !context.access.canReview && !context.access.canViewAll) throw authError(403, '仅本人、管理员和指定课程审核人可查看学习记录');
  return sub;
}

async function readLearning(request, env, storage, context) {
  const { actor, access } = context;
  const url = new URL(request.url), path = url.pathname;
  if (request.method === 'GET' && path === '/api/learning') {
    return json(request, env, { version: LEARNING_VERSION, catalog: LEARNING_CATALOG, access,
      records: access.canSubmit ? await ownRecords(storage, actor.sub, actor.personId) : [],
      storage: 'workbench_learning_records', completionRequiresReply: false });
  }
  if (request.method === 'GET' && path === '/api/learning/inbox') {
    if (!access.canReview && !access.canViewAll) throw authError(403, '没有全量学习记录查看权限');
    const cursor = url.searchParams.get('cursor') || '';
    if (cursor && !/^record:ou_[\w-]+:[ABC]:\d{2}$/.test(cursor)) throw authError(400, '分页标识无效');
    const list = await storage.list({ prefix: 'record:', ...(cursor ? { startAfter: cursor } : {}), limit: 51 });
    const entries = [...list.entries()], page = entries.slice(0, 50);
    return json(request, env, { records: page.map(([, r]) => compactRecord(r)), next: entries.length > 50 ? page.at(-1)[0] : '',
      notificationIssues: (await allNotices(storage)).map(([, n]) => n)
        .filter(n => n.status === 'needs_review').map(n => ({ kind: n.kind, name: n.name, lessonId: n.lessonId, createdAt: n.createdAt })) });
  }
  if (request.method === 'GET' && path === '/api/learning/record') {
    const subject = subjectFor(url.searchParams.get('subject'), context);
    // Validate track/lesson without requiring a submission body.
    const { trackId, lessonId } = learningInput({ trackId: url.searchParams.get('track'), lessonId: url.searchParams.get('lesson'),
      requestId: 'read-validation-1', text: 'read' }, 'append');
    const key = learningRecordKey(subject, trackId, lessonId);
    const record = await storage.get(key);
    if (!record) return json(request, env, { record: null, events: [], next: 0 });
    if (subject === actor.sub && record.personId !== actor.personId) throw authError(403, '账号与历史学习记录身份不一致');
    const before = Number(url.searchParams.get('before') || record.count + 1);
    if (!Number.isSafeInteger(before) || before < 1 || before > record.count + 1) throw authError(400, '历史分页无效');
    const rows = await storage.list({ prefix: eventPrefix(key), end: eventKey(key, before), reverse: true, limit: 31 });
    const entries = [...rows.values()], page = entries.slice(0, 30);
    return json(request, env, { record: compactRecord(record), events: page.reverse(), next: entries.length > 30 ? page[0].seq : 0 });
  }
  throw authError(404, '学习接口不存在');
}

export async function executeLearning(request, env, storage, contextProvider = learningContext) {
  env = readScope(env, request);
  const context = await contextProvider(request, env);
  if (request.method === 'GET') return storage.transaction(tx => readLearning(request, env, tx, context));
  const { actor, access } = context;
  const path = new URL(request.url).pathname;
  const kind = ({ '/api/learning/submit': 'submit', '/api/learning/append': 'append', '/api/learning/reply': 'reply' })[path];
  if (request.method !== 'POST' || !kind) throw authError(404, '学习接口不存在');
  const raw = await request.text();
  if (raw.length > 100000) throw authError(413, '学习记录过长');
  let body;
  try { body = learningInput(JSON.parse(raw), kind); } catch (e) { if (e instanceof SyntaxError) throw authError(400, '提交格式无效'); throw e; }
  if (kind !== 'reply' && !access.canSubmit) throw authError(403, '当前账号不能提交学生学习记录');
  const subject = kind === 'reply' ? subjectFor(body.subject, context, true) : actor.sub;
  if (kind === 'append' && body.subject && body.subject !== actor.sub) throw authError(403, '只能补充本人的学习记录');
  const key = learningRecordKey(subject, body.trackId, body.lessonId);
  const requestKey = 'request:' + actor.sub + ':' + body.requestId;
  const hash = await fingerprint(JSON.stringify({ kind, subject, ...body }));
  const now = new Date().toISOString();
  const saved = await storage.transaction(async tx => {
    const prior = await tx.get(requestKey);
    if (prior) {
      if (prior.hash !== hash) throw authError(409, '同一请求标识不能用于不同内容，请保留原稿并重新打开记录');
      const record = await tx.get(key);
      if (subject === actor.sub && record?.personId !== actor.personId) throw authError(403, '账号与历史学习记录身份不一致');
      return prior;
    }
    const rateKey = 'rate:' + actor.sub;
    let rate = await tx.get(rateKey);
    if (!rate || Date.now() - rate.since >= 60000) rate = { since: Date.now(), count: 0 };
    if (rate.count >= 60) throw authError(429, '学习记录提交过于频繁，请一分钟后重试');
    await tx.put(rateKey, { ...rate, count: rate.count + 1 });
    let record = await tx.get(key);
    if (kind === 'submit' && record) throw authError(409, '本课已经提交，请查看原记录并使用补充说明');
    if (kind !== 'submit' && !record) throw authError(404, '本课尚未提交');
    if (!record) record = { subject, personId: actor.personId, name: actor.name, trackId: body.trackId, lessonId: body.lessonId, submittedAt: now, count: 0 };
    if (kind !== 'reply' && record.personId !== actor.personId) throw authError(403, '账号与历史学习记录身份不一致，请联系管理员');
    const seq = record.count + 1;
    const event = { seq, kind, author: actor.name, createdAt: now,
      ...(kind === 'submit' ? { gains: body.gains, questions: body.questions, suggestions: body.suggestions } : { text: body.text }) };
    record = { ...record, count: seq, updatedAt: now, lastKind: kind };
    const eventId = eventKey(key, seq);
    await tx.put(eventId, event);
    await tx.put(key, record);
    const receipt = { hash, key, seq, eventId, savedAt: now };
    await tx.put(requestKey, receipt);
    const noticeKind = kind === 'reply' ? 'reply' : 'reviewer';
    await tx.put('notice:' + eventId, { id: eventId, kind: noticeKind, subject, personId: record.personId, name: record.name,
      trackId: record.trackId, lessonId: record.lessonId, status: 'pending', attempts: 0, createdAt: now });
    if (kind === 'submit') {
      const required = LEARNING_CATALOG.tracks.find(t => t.id === body.trackId).lessons;
      const records = await tx.get(required.map(l => learningRecordKey(subject, body.trackId, l.id)));
      if (records.size === required.length) {
        const completionId = 'complete:' + subject + ':' + body.trackId;
        if (!await tx.get(completionId)) {
          await tx.put(completionId, { completedAt: now, lessons: required.map(l => l.id), personId: actor.personId });
          await tx.put('notice:' + completionId, { id: completionId, kind: 'completion', subject, personId: actor.personId,
            name: actor.name, trackId: body.trackId, status: 'pending', attempts: 0, createdAt: now });
        }
      }
    }
    await storage.setAlarm(Date.now() + 1500);
    return receipt;
  });
  // Read back from durable storage. Delivery of notifications is not a save prerequisite.
  const persisted = await storage.get(saved.eventId);
  if (!persisted || persisted.seq !== saved.seq) throw authError(503, '保存结果尚未确认');
  return json(request, env, { saved: true, savedAt: saved.savedAt, event: persisted,
    records: await ownRecords(storage, subject, subject === actor.sub ? actor.personId : '') });
}

export async function deliverLearningNotices(env, storage, services = {}) {
  const now = Date.now();
  const rows = await allNotices(storage);
  const pending = rows.filter(([, n]) => n.status === 'pending' && (!n.nextAttempt || n.nextAttempt <= now)).slice(0, 20);
  for (const [key, notice] of pending) {
    if (notice.firstAttempt && now - notice.firstAttempt > 50 * 60000) {
      await storage.put(key, { ...notice, status: 'needs_review' }); continue;
    }
    const attempted = { ...notice, attempts: notice.attempts + 1, firstAttempt: notice.firstAttempt || now };
    await storage.put(key, attempted);
    try {
      const token = await (services.getTenantToken || getTenantToken)(env);
      const people = await (services.listRecords || listRecords)(env, token, 'MEMBERS_TABLE_ID');
      const student = learningActor(people, notice.subject);
      if (student.personId !== notice.personId) throw authError(403, '学习记录人员身份已变更');
      const recipient = notice.kind === 'reply' ? student : learningRecipient(people, env, notice.kind === 'completion' ? 'professor' : 'reviewer');
      // Revalidate designated reviewer for delayed replies as well.
      if (notice.kind === 'reply') learningRecipient(people, env, 'reviewer');
      const destination = new URL(env.FRONTEND_URL);
      destination.searchParams.set('page', notice.kind === 'reply' ? 'learning' : 'learning-inbox');
      const link = destination.href;
      const message = notice.kind === 'completion' ? `${student.name}同学已完成Track ${notice.trackId}的学习` :
        notice.kind === 'reply' ? `朱俊杰已回复你的 Track ${notice.trackId} Lesson ${notice.lessonId} 学习记录。请登录工作台查看：${link}` :
          `${student.name}提交了 Track ${notice.trackId} Lesson ${notice.lessonId} 学习记录或补充说明。请登录工作台查看并回复：${link}`;
      const result = await (services.feishuRequest || feishuRequest)('/im/v1/messages?receive_id_type=open_id', { method: 'POST', bearer: token,
        body: { receive_id: recipient.sub, msg_type: 'text', content: JSON.stringify({ text: message }), uuid: await stableMessageUuid('learning:' + notice.id) } });
      if (result.code !== 0 || !result.data?.message_id) throw new Error('Message delivery not confirmed');
      await storage.transaction(async tx => {
        await tx.put('delivery:' + notice.id, { ...attempted, status: 'sent', sentAt: new Date().toISOString() });
        // Remove only the queue marker; preserve the delivery receipt and business event.
        await tx.delete(key);
      });
    } catch (_) {
      // Feishu deduplicates UUIDs for one hour. Never blindly retry outside it.
      await storage.put(key, { ...attempted, status: attempted.attempts >= 8 ? 'needs_review' : 'pending',
        nextAttempt: now + Math.min(300000, 15000 * 2 ** attempted.attempts) });
    }
  }
  const remaining = (await allNotices(storage)).map(([, n]) => n).filter(n => n.status === 'pending');
  if (remaining.length) await storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...remaining.map(n => n.nextAttempt || Date.now() + 1000))));
}
