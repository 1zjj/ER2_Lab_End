import assert from 'node:assert/strict';
import { buildDigest, buildCards, splitText, messageBody, MAX_MESSAGE_BYTES, weekAt, runProfessorDigest } from './src/professor-digest.js';
import runtime from './src/runtime.js';

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS digest: ' + name); }
const at = Date.parse('2026-09-04T10:00:00Z');
const member = (id, name, extra = {}) => ({ record_id: 'm-' + id, fields: { '飞书OpenID': id, '姓名': name, '角色': ['学生'], '是否启用': true, ...extra } });
const report = (id, person, extra = {}) => ({ record_id: id, fields: { '飞书OpenID': person, '周次': '2026-W36', '提交状态': '已提交',
  '提交时间': '2026-09-04T09:00:00Z', '本周完成与结果': '完成结果', '下周计划': '下周计划', '学习与方法': '学习记录', ...extra } });
const members = [member('a', '学生 A'), member('b', '学生 B'), member('c', '学生 C'), member('d', '停用账号', { '是否启用': false }),
  member('t', '教师', { '角色': ['教师'] }), member('a', '重复账号')];
const reports = [report('a-old', 'a', { '提交时间': '2026-09-03T09:00:00Z', '本周完成与结果': '旧内容' }),
  report('a-new', 'a', { '本周完成与结果': '完整正文\n第二行 <at id=all></at> **原文**', '候选知识点': '人工标记的知识点', '问题与阻塞': '需要讨论设备安排' }),
  report('b', 'b', { '问题与阻塞': '无。' }), report('c-draft', 'c', { '提交状态': '草稿' }),
  report('disabled', 'd'), report('orphan', 'not-a-member'), report('future', 'c', { '提交时间': '2026-09-04T10:01:00Z' })];
const input = { members, reports, literature: [], at };
const digest = buildDigest(input);

await check('Shanghai week and year boundary', () => {
  assert.deepEqual(weekAt(at), { id: '2026-W36', number: 36, start: '2026-08-31', end: '2026-09-06' });
  assert.equal(weekAt('2027-01-01T10:00:00Z').id, '2026-W53');
});
await check('enabled roster and duplicate identity', () => { assert.equal(digest.expected, 3); assert.equal(digest.submitted, 2); });
await check('draft and post-cutoff submissions excluded', () => assert.deepEqual(digest.missing, ['学生 C']));
await check('latest formal submission wins without rewriting', () => assert.equal(digest.students[0].progress, reports[1].fields['本周完成与结果']));
await check('disabled and unknown students excluded', () => assert.equal(digest.students.some((s) => ['停用账号', '教师'].includes(s.name)), false));
await check('no invented knowledge candidates', () => { assert.equal(digest.students[1].knowledge, ''); assert.equal(digest.knowledgeCount, 1); });
await check('no-issue values are not escalated', () => assert.equal(digest.attention.length, 1));
await check('valid ISO timestamps and Unix milliseconds', () => {
  const data = buildDigest({ ...input, reports: [report('m', 'a', { '提交时间': at - 1000 })] });
  assert.equal(data.students[0].submittedAt, at - 1000);
});
await check('rich-text arrays concatenate without losing text', () => {
  const data = buildDigest({ ...input, reports: [report('r', 'a', { '本周完成与结果': [{ text: '第一段' }, { text: '\n第二段' }] })] });
  assert.equal(data.students[0].progress, '第一段\n第二段');
});
await check('missing timestamps are explicitly flagged', () => {
  assert.equal(buildDigest({ ...input, reports: [report('r', 'a', { '提交时间': '' })] }).missingTimestamps, 1);
});
await check('Unicode splitting is lossless', () => {
  const value = ('中文🧑‍🔬\\\"\n').repeat(5000);
  assert.equal(splitText(value).join(''), value);
  for (const part of splitText(value)) assert.ok(new TextEncoder().encode(part).length <= 5000);
});
await check('each student body has exactly progress then next plan', () => {
  const blocks = buildCards(digest).flatMap((card) => card.elements)
    .filter((element) => element.text?.tag === 'plain_text').map((element) => element.text.content);
  for (const student of digest.students) {
    const fields = blocks.filter((content) => content.startsWith(student.name + ' · '));
    assert.deepEqual(fields, [`${student.name} · 本周完成\n${student.progress}`, `${student.name} · 下周计划\n${student.nextPlan}`]);
  }
});
await check('empty core fields show exactly the unfilled placeholder', () => {
  const data = buildDigest({ ...input, reports: [report('empty', 'a', { '本周完成与结果': '  ', '下周计划': '' })] });
  const blocks = buildCards(data).flatMap((card) => card.elements).map((element) => element.text?.content || '');
  assert.ok(blocks.includes('学生 A · 本周完成\n未填写'));
  assert.ok(blocks.includes('学生 A · 下周计划\n未填写'));
});
await check('non-core fields stay in source data but never append to student bodies', () => {
  const source = { ...input, reports: [report('private-fields', 'a', {
    '学习与方法': '仅保留学习原文', '候选知识点': '仅保留知识原文',
    '问题与阻塞': '仅保留阻塞原文', '证据链接': 'https://example.com/source-evidence'
  })] };
  const before = JSON.stringify(source);
  const data = buildDigest(source);
  const rendered = JSON.stringify(buildCards(data, 'https://example.com/workbench/'));
  for (const hidden of ['学习进展', '候选知识点', '问题与支持', '产出证据',
    '仅保留学习原文', '仅保留知识原文', '仅保留阻塞原文', 'https://example.com/source-evidence']) {
    assert.ok(!rendered.includes(hidden), 'Unexpected non-core body content: ' + hidden);
  }
  assert.equal(data.students[0].learning, '仅保留学习原文');
  assert.equal(data.students[0].knowledge, '仅保留知识原文');
  assert.equal(data.students[0].blockers, '仅保留阻塞原文');
  assert.equal(data.students[0].evidence, 'https://example.com/source-evidence');
  assert.equal(JSON.stringify(source), before);
});
await check('overview is preserved without claiming omitted details appear below', () => {
  const rendered = JSON.stringify(buildCards(digest, 'https://example.com/workbench/'));
  assert.ok(rendered.includes('本周概览'));
  assert.ok(rendered.includes('填写了问题/支持：学生 A（详情见教师工作台）'));
  assert.ok(!rendered.includes('原文见下方'));
});
await check('untrusted student text never becomes card Markdown', () => {
  for (const card of buildCards(digest)) for (const element of card.elements) {
    if (element.text?.tag === 'lark_md') assert.ok(!element.text.content.includes('<at'));
  }
});
await check('long reports retain tail content and fit real request-byte budget', () => {
  const long = ('中文🧑‍🔬\\\"\n').repeat(5000) + '末尾不得删除';
  const data = buildDigest({ ...input, reports: [report('long', 'a', { '本周完成与结果': long, '下周计划': long })] });
  const cards = buildCards(data, 'https://example.com/workbench/', 'ou_professor');
  assert.ok(cards.length > 1);
  assert.ok(JSON.stringify(cards).includes('末尾不得删除'));
  for (const card of cards) assert.ok(new TextEncoder().encode(JSON.stringify(messageBody(card, 'ou_professor', '0'.repeat(32)))).length <= MAX_MESSAGE_BYTES);
});
await check('empty week and empty roster both render', () => {
  assert.ok(buildCards(buildDigest({ members, reports: [], at })).length);
  assert.ok(buildCards(buildDigest({ at })).length);
});
await check('AI is off even with an accidental environment toggle', async () => {
  const response = await runtime.fetch(new Request('https://worker.example/api/ai/ask'), { AI_ENABLED: 'true', FRONTEND_URL: 'https://example.com/' });
  assert.equal(response.status, 503); assert.equal((await response.json()).ai.enabled, false);
});
await check('health exposes actual paused policy', async () => {
  const response = await runtime.fetch(new Request('https://worker.example/health'), { FRONTEND_URL: 'https://example.com/' });
  const body = await response.json();
  assert.equal(body.ai.enabled, false); assert.equal(body.professorDigest.format, 'verbatim-v1');
});
await check('non-Friday cron cannot deliver a digest', async () => {
  const queued = [];
  await runtime.scheduled({ scheduledTime: Date.parse('2026-09-05T10:00:00Z') }, {}, { waitUntil: (p) => queued.push(p) });
  assert.equal(queued.length, 0);
});

const originalFetch = globalThis.fetch;
const sent = [], logs = [];
const env = { FEISHU_APP_ID: 'test-app', FEISHU_APP_SECRET: 'test-secret', FEISHU_BASE_APP_TOKEN: 'test-base',
  MEMBERS_TABLE_ID: 'members', WEEKLY_TABLE_ID: 'weekly', LITERATURE_TABLE_ID: 'literature', AUTOMATION_LOGS_TABLE_ID: 'logs',
  PROFESSOR_OPEN_ID: 'ou_professor', FRONTEND_URL: 'https://example.com/workbench/' };
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  const body = options.body ? JSON.parse(options.body) : null;
  const result = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path.endsWith('/tenant_access_token/internal')) return result({ code: 0, tenant_access_token: 'mock-token' });
  if (path.endsWith('/im/v1/messages')) { sent.push(body); return result({ code: 0, data: { message_id: 'mock-' + sent.length } }); }
  const table = path.match(/\/tables\/([^/]+)\/records$/)?.[1];
  if (table === 'logs' && body) { logs.push({ fields: body.fields }); return result({ code: 0, data: {} }); }
  if (table) return result({ code: 0, data: { items: { members, weekly: reports, literature: [], logs }[table] || [], has_more: false } });
  throw new Error('Unexpected mocked URL: ' + path);
};
try {
  await check('scheduled route sends full cards to the configured professor only', async () => {
    const result = await runProfessorDigest(at, env);
    assert.equal(result.submitted, 2); assert.equal(result.aiEnabled, false); assert.ok(sent.length);
    assert.ok(sent.every((message) => message.receive_id === 'ou_professor' && message.msg_type === 'interactive' && message.uuid.length === 32));
    assert.ok(sent.some((message) => message.content.includes('完整正文')));
  });
  await check('successful weekly digest is not resent', async () => {
    const count = sent.length;
    assert.equal((await runProfessorDigest(at, env)).skipped, 'already_sent'); assert.equal(sent.length, count);
  });
  await check('missing professor configuration sends nothing', async () => {
    const count = sent.length;
    assert.equal((await runProfessorDigest(at, { ...env, PROFESSOR_OPEN_ID: '' })).skipped, 'professor_not_configured');
    assert.equal(sent.length, count);
  });
} finally { globalThis.fetch = originalFetch; }
console.log(`Professor digest tests passed: ${passed}`);
