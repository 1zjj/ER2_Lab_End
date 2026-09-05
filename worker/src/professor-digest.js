/** Deterministic ER² professor digest. No model requests, inference or public storage. */
const API = 'https://open.feishu.cn/open-apis';
const encoder = new TextEncoder();
export const DIGEST_VERSION = 'verbatim-v1';
export const MAX_MESSAGE_BYTES = 24000; // Conservative, below Feishu's 30 KB request limit.

function text(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).join('');
  if (typeof value === 'object') return text(value.text ?? value.name ?? value.link ?? '');
  return String(value);
}
function get(record, ...keys) {
  for (const key of keys) if (record?.fields?.[key] != null) return record.fields[key];
  return '';
}
const read = (record, ...keys) => text(get(record, ...keys)).trim();
const identity = (record) => read(record, '飞书OpenID', '人员OpenID', 'OpenID', 'open_id');
function roles(record) {
  const raw = get(record, '角色');
  return (Array.isArray(raw) ? raw.map(text) : text(raw).split(/[、,，/]/)).filter(Boolean);
}
function timestamp(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' || /^\d+$/.test(text(value))) {
    const n = Number(value);
    return n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(text(value)) || 0;
}
function isEnabled(record) {
  const value = get(record, '是否启用', '启用');
  return value !== false && value !== 0 && !['false', '停用', '否'].includes(text(value).toLowerCase());
}
function isSubmitted(record) {
  return ['已提交', 'submitted'].includes(read(record, '提交状态').toLowerCase());
}
function hasIssue(value) {
  return Boolean(value) && !['无', '暂无', '没有', '无问题', '无阻塞', '暂无问题', '暂无阻塞', 'none', 'n/a']
    .includes(value.replace(/[。.!！\s]+$/u, '').toLowerCase());
}

export function weekAt(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  const monday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1);
  const sunday = new Date(+monday + 6 * 86400000);
  const thursday = new Date(+monday + 3 * 86400000);
  const year = thursday.getUTCFullYear();
  const number = Math.ceil(((+thursday - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return { id: `${year}-W${String(number).padStart(2, '0')}`, number,
    start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

export function buildDigest({ members = [], reports = [], literature = [], at }) {
  if (!Number.isFinite(+new Date(at))) throw new Error('A valid digest cutoff is required');
  const cutoff = +new Date(at);
  const week = weekAt(cutoff);
  const seen = new Set();
  const roster = members.filter((record) => {
    const id = identity(record);
    const memberRoles = roles(record);
    const student = !memberRoles.length || memberRoles.some((role) => role.includes('学生') || role === 'student');
    if (!id || seen.has(id) || !isEnabled(record) || !student) return false;
    seen.add(id);
    return true;
  });
  const eligibleIds = new Set(roster.map(identity));
  const latest = new Map();
  for (const record of reports) {
    const id = identity(record);
    if (!eligibleIds.has(id) || read(record, '周次', 'WeekID') !== week.id || !isSubmitted(record)) continue;
    const submittedAt = timestamp(get(record, '提交时间'));
    if (submittedAt > cutoff) continue;
    const previous = latest.get(id);
    if (!previous || submittedAt > previous.time || (submittedAt === previous.time &&
        String(record.record_id || '') > String(previous.record.record_id || ''))) {
      latest.set(id, { record, time: submittedAt });
    }
  }
  const students = [], missing = [];
  for (const member of roster) {
    const id = identity(member);
    const name = read(member, '姓名', '人员姓名') || '未命名学生';
    const found = latest.get(id);
    if (!found) { missing.push(name); continue; }
    const record = found.record;
    students.push({ name, project: read(member, '项目编号', '项目代码'),
      progress: read(record, '本周完成与结果', '本周完成'),
      nextPlan: read(record, '下周计划'), learning: read(record, '学习与方法', '学习进展'),
      knowledge: read(record, '候选知识点'), blockers: read(record, '问题与阻塞', '阻塞'),
      evidence: read(record, '证据链接'), submittedAt: found.time,
      recordId: record.record_id || '' });
  }
  const reading = literature.filter((record) => read(record, '周次', 'WeekID') === week.id &&
    isSubmitted(record) && timestamp(get(record, '提交时间')) <= cutoff);
  return { version: DIGEST_VERSION, aiEnabled: false, week, cutoff,
    expected: roster.length, submitted: students.length, missing, students,
    attention: students.filter((student) => hasIssue(student.blockers)).map(({ name, blockers }) => ({ name, blockers })),
    knowledgeCount: students.filter((student) => hasIssue(student.knowledge)).length,
    literatureCount: reading.length,
    literatureContributors: new Set(reading.map((record) => read(record, '提交人OpenID')).filter(Boolean)).size,
    missingTimestamps: students.filter((student) => !student.submittedAt).length };
}

// Split on Unicode code points; concatenating the parts preserves the entire original text.
export function splitText(value, maxBytes = 5000) {
  const parts = []; let current = '', bytes = 0;
  for (const point of value) {
    const size = encoder.encode(point).length;
    if (bytes + size > maxBytes && current) { parts.push(current); current = ''; bytes = 0; }
    current += point; bytes += size;
  }
  if (current || !parts.length) parts.push(current);
  return parts;
}
const plain = (content) => ({ tag: 'div', text: { tag: 'plain_text', content } });
const heading = (content) => ({ tag: 'div', text: { tag: 'lark_md', content: `**${content}**` } });
const rule = () => ({ tag: 'hr' });
function localTime(at) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
}
function blocksFor(digest) {
  const blocks = [plain(`${digest.week.start} — ${digest.week.end} · 第 ${digest.week.number} 周\n统计截止：${localTime(digest.cutoff)}（北京时间）`),
    heading('本周概览'), plain(`已提交 ${digest.submitted} / ${digest.expected} 人　｜　未提交 ${digest.missing.length} 人\n填写问题/支持 ${digest.attention.length} 人　｜　知识候选 ${digest.knowledgeCount} 人\n文献阅读 ${digest.literatureCount} 篇 / ${digest.literatureContributors} 人`)];
  if (digest.missing.length || digest.attention.length || digest.missingTimestamps) {
    blocks.push(rule(), heading('需关注'));
    const notices = [];
    if (digest.missing.length) notices.push('未提交：' + digest.missing.join('、'));
    // Only report who filled this field; do not invent severity, priorities or decisions.
    if (digest.attention.length) notices.push('填写了问题/支持：' + digest.attention.map((item) => item.name).join('、') + '（原文见下方）');
    if (digest.missingTimestamps) notices.push(`${digest.missingTimestamps} 份记录缺少有效提交时间，请核对。`);
    for (const notice of notices) for (const part of splitText(notice)) blocks.push(plain(part));
  }
  for (let index = 0; index < digest.students.length; index++) {
    const student = digest.students[index];
    blocks.push(rule(), plain(`${String(index + 1).padStart(2, '0')}　${student.name}${student.project ? ' · ' + student.project : ''}`));
    const fields = [['本周完成', student.progress || '未填写'], ['下周计划', student.nextPlan || '未填写'],
      ['学习进展', student.learning || '未填写'], ['候选知识点', student.knowledge || '未填写（不自动生成）']];
    if (hasIssue(student.blockers)) fields.push(['问题与支持', student.blockers]);
    if (student.evidence) fields.push(['产出证据', student.evidence]);
    for (const [label, value] of fields) {
      splitText(value).forEach((part, i) => blocks.push(plain(`${student.name} · ${label}${i ? `（续 ${i + 1}）` : ''}\n${part}`)));
    }
  }
  if (!digest.students.length) blocks.push(rule(), plain(digest.expected ? '截至统计时间，暂无正式提交的学生周报。' : '本周没有启用中的应交学生。'));
  return blocks;
}
function makeCard(digest, elements, index, total, frontendUrl) {
  const footer = [{ tag: 'note', elements: [{ tag: 'plain_text', content: '按固定模板拼接学生原文 · 不作 AI 总结或评价' }] }];
  try {
    const url = new URL(frontendUrl);
    if (url.protocol === 'https:') {
      url.searchParams.set('view', 'teacher'); url.hash = '';
      footer.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '打开教师工作台' }, url: url.href, type: 'default' }] });
    }
  } catch (_) { /* A missing portal link must not prevent delivery of the full report. */ }
  return { config: { wide_screen_mode: true }, header: { template: 'blue', title: { tag: 'plain_text',
    content: `ER² Lab 周报汇总 · 第 ${digest.week.number} 周${total > 1 ? `（${index}/${total}）` : ''}` } }, elements: [...elements, ...footer] };
}
export function messageBody(card, recipient, uuid) {
  return { receive_id: recipient, msg_type: 'interactive', content: JSON.stringify(card), uuid };
}
export function buildCards(digest, frontendUrl = '', recipient = 'x'.repeat(128)) {
  const pages = []; let current = [];
  for (const block of blocksFor(digest)) {
    const proposed = [...current, block];
    const probe = makeCard(digest, proposed, 9999, 9999, frontendUrl);
    const bytes = encoder.encode(JSON.stringify(messageBody(probe, recipient, 'x'.repeat(32)))).length;
    if (bytes > MAX_MESSAGE_BYTES || proposed.length > 40) {
      if (!current.length) throw new Error('One digest block exceeds the message budget');
      pages.push(current); current = [block];
    } else current = proposed;
  }
  if (current.length) pages.push(current);
  return pages.map((elements, i) => {
    const card = makeCard(digest, elements, i + 1, pages.length, frontendUrl);
    if (encoder.encode(JSON.stringify(messageBody(card, recipient, 'x'.repeat(32)))).length > MAX_MESSAGE_BYTES)
      throw new Error('A digest card exceeds the safe message budget');
    return card;
  });
}

async function request(path, token, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(API + path, { method,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok || (typeof result.code === 'number' && result.code !== 0))
    throw new Error(`Feishu digest API failed: HTTP ${response.status}, code ${result.code ?? 'unknown'}`);
  return result;
}
function binding(env, key) {
  return { appToken: env[key.replace(/_TABLE_ID$/, '_BASE_APP_TOKEN')] || env.FEISHU_BASE_APP_TOKEN || '',
    wikiToken: env[key.replace(/_TABLE_ID$/, '_BASE_WIKI_TOKEN')] || env.FEISHU_BASE_WIKI_TOKEN || '',
    tableId: env[key] || (key === 'LITERATURE_TABLE_ID' ? 'tblyHLZpybGVU364' : '') };
}
async function tablePath(env, token, key, required = false) {
  const item = binding(env, key);
  if (!item.tableId || (!item.appToken && !item.wikiToken)) {
    if (required) throw new Error('Digest table binding is missing: ' + key);
    return '';
  }
  let appToken = item.appToken;
  if (!appToken) {
    const result = await request('/wiki/v2/spaces/get_node?token=' + encodeURIComponent(item.wikiToken), token);
    appToken = result.data?.node?.obj_token;
    if (!appToken) throw new Error('Cannot resolve digest table: ' + key);
  }
  return `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(item.tableId)}/records`;
}
async function list(path, token) {
  if (!path) return [];
  const all = [], seenPages = new Set(); let page = '';
  do {
    const result = await request(path + '?page_size=500' + (page ? '&page_token=' + encodeURIComponent(page) : ''), token);
    if (!Array.isArray(result.data?.items)) throw new Error('Invalid Feishu record list');
    all.push(...result.data.items);
    if (!result.data.has_more) break;
    page = result.data.page_token;
    if (!page || seenPages.has(page)) throw new Error('Incomplete Feishu pagination');
    seenPages.add(page);
  } while (page);
  return all;
}
async function stableId(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runProfessorDigest(at, env) {
  if (!env.PROFESSOR_OPEN_ID) return { skipped: 'professor_not_configured' };
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) throw new Error('Feishu app credentials are not configured');
  const auth = await request('/auth/v3/tenant_access_token/internal', '', { app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET });
  const token = auth.tenant_access_token || auth.data?.tenant_access_token;
  if (!token) throw new Error('No Feishu tenant token');
  const [memberPath, weeklyPath, literaturePath, logPath] = await Promise.all([
    tablePath(env, token, 'MEMBERS_TABLE_ID', true), tablePath(env, token, 'WEEKLY_TABLE_ID', true),
    tablePath(env, token, 'LITERATURE_TABLE_ID'), tablePath(env, token, 'AUTOMATION_LOGS_TABLE_ID')]);
  const logs = await list(logPath, token);
  const runKey = weekAt(at).id + '-professor-summary'; // Preserve the legacy weekly deduplication key.
  const success = (key) => logs.some((record) => read(record, '运行键') === key && read(record, '执行结果') === '成功');
  if (success(runKey)) return { skipped: 'already_sent' };
  const log = async (key, result, detail) => {
    if (logPath) await request(logPath, token, { fields: { '运行键': key, '任务名称': '教授周报汇总（原文拼接）',
      '执行时间': new Date().toISOString(), '执行结果': result, '执行说明': detail } });
  };
  const [members, reports, literature] = await Promise.all([list(memberPath, token), list(weeklyPath, token), list(literaturePath, token)]);
  const digest = buildDigest({ members, reports, literature, at });
  const cards = buildCards(digest, env.FRONTEND_URL, env.PROFESSOR_OPEN_ID);
  const snapshotId = await stableId(JSON.stringify(cards));
  const prefix = `${runKey}-${DIGEST_VERSION}-`;
  if (logs.some((record) => read(record, '运行键').startsWith(prefix) && read(record, '执行结果') === '成功' &&
      !read(record, '执行说明').startsWith(snapshotId + ':'))) {
    throw new Error('A partial digest already exists with different source data; review it before resending');
  }
  try {
    for (let i = 0; i < cards.length; i++) {
      const partKey = `${prefix}${i + 1}`;
      if (success(partKey)) continue;
      const uuid = await stableId(`${partKey}:${env.PROFESSOR_OPEN_ID}:${snapshotId}`);
      await request('/im/v1/messages?receive_id_type=open_id', token, messageBody(cards[i], env.PROFESSOR_OPEN_ID, uuid));
      await log(partKey, '成功', `${snapshotId}:${i + 1}/${cards.length}`);
    }
    await log(runKey, '成功', `${digest.submitted}/${digest.expected}人；${cards.length}条；${DIGEST_VERSION}；AI未调用`);
    return { submitted: digest.submitted, expected: digest.expected, parts: cards.length, aiEnabled: false };
  } catch (error) {
    try { await log(runKey, '失败', error.message); } catch (_) { /* Keep the original delivery error. */ }
    throw error;
  }
}
