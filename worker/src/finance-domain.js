/** ER2 finance domain. No UI roles, client names or client status fields are trusted. */
export const VERSION = 'finance-v1';
export const CLAIM_STATUS = { receive: '待收材料', review: '待审核', supplement: '待补充', registering: '审核通过，登记待重试', done: '已报销' };
export const BUDGET_STATUS = { draft: '草稿', pending: '待老师审批', supplement: '待补充', allow: '已允许', deny: '不允许' };
const DAY = 86400000;
export function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
export function check(value, status, message) { if (!value) fail(status, message); }
export function text(value, label, min = 0, max = 500) {
  check(value == null || typeof value === 'string', 400, label + '必须为文字');
  const s = String(value ?? '').trim();
  check(s.length >= min && s.length <= max, 400, label + '长度不正确');
  return s;
}
export function ids(value) { return String(value || '').split(/[\s,，、]+/).filter(Boolean); }
export function capabilities(profile, env) {
  const roles = profile.roles || [];
  return { student: roles.includes('student'),
    finance: ids(env.FINANCE_OPEN_IDS).includes(profile.sub),
    teacher: ids(env.BUDGET_APPROVER_OPEN_IDS).includes(profile.sub) };
}
export function dateOnly(at = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function validDate(value, label, maximum = '') {
  const s = text(value, label, 10, 10), t = Date.parse(s + 'T00:00:00Z');
  check(/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s && (!maximum || s <= maximum), 400, label + '不是有效日期');
  return s;
}
export function periodAt(at, anchor) {
  if (!anchor) return { enabled: false, id: '', start: '', due: '', next: '' };
  validDate(anchor, '提醒起始日期');
  const today = dateOnly(at), base = Date.parse(anchor + 'T00:00:00Z');
  const n = Math.floor((Date.parse(today + 'T00:00:00Z') - base) / (14 * DAY));
  if (n < 0) return { enabled: false, id: '', start: '', due: '', next: anchor };
  const start = base + n * 14 * DAY, d = x => new Date(x).toISOString().slice(0, 10);
  return { enabled: true, id: d(start), start: d(start), due: d(start + 4 * DAY), next: d(start + 14 * DAY) };
}
export function cents(value, label = '金额') {
  check(value !== null && value !== '' && ['number', 'string'].includes(typeof value), 400, '请填写' + label);
  const s = String(value).trim();
  check(/^\d+(\.\d{1,2})?$/.test(s), 400, label + '最多两位小数');
  const [whole, fraction = ''] = s.split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  check(Number.isSafeInteger(n) && n >= 0 && n <= 1000000000, 400, label + '超出允许范围');
  return n;
}
export function currency(value) { check(['CNY', 'USD', 'HKD', 'AUD', 'EUR', 'JPY'].includes(value), 400, '请选择有效币种'); return value; }
export function lines(values, kind, at) {
  check(Array.isArray(values) && values.length > 0 && values.length <= 20, 400, '每份申请需要1至20条明细');
  const normalized = values.map((v, i) => {
    check(v && typeof v === 'object', 400, '明细格式错误');
    const qty = Number(v.qty);
    check(Number.isInteger(qty) && qty > 0 && qty <= 100000, 400, '数量必须为1至100000的整数');
    const unitCents = cents(v.unitPrice, kind === 'budget' ? '市场参考单价' : '采购单价');
    const totalCents = qty * unitCents;
    check(Number.isSafeInteger(totalCents) && totalCents <= 1000000000, 400, '单条金额过大');
    const line = { id: 'L' + String(i + 1).padStart(2, '0'), name: text(v.name, '资源名称', 1, 120), spec: text(v.spec, '规格', 0, 120), qty, unitCents, totalCents };
    if (kind === 'budget') line.feature = text(v.feature, '对应功能', 1, 500);
    else {
      line.purchaseDate = validDate(v.purchaseDate, '采购日期', dateOnly(at));
      line.approvedCents = v.approved === '' || v.approved == null ? totalCents : cents(v.approved, '核准报销金额');
      line.differenceReason = text(v.differenceReason, '差异说明', line.approvedCents === totalCents ? 0 : 1, 500);
    }
    return line;
  });
  check(normalized.reduce((a, x) => a + (kind === 'budget' ? x.totalCents : x.approvedCents), 0) > 0, 400, '申请总额必须大于0');
  return normalized;
}
export function publicResource(r) {
  return Object.fromEntries(['id','project','name','spec','qty','unitCents','totalCents','approvedCents','purchaseDate','registeredAt','currency','ownerName','reimbursed','progress'].map(k => [k, r[k]]));
}
export function studentClaim(r) {
  const result = Object.fromEntries(['id','owner','ownerName','project','title','currency','status','revision','createdAt','updatedAt','registeredAt','note','items','history'].map(k => [k, r[k]]));
  return result;
}
export function visibleBudgets(rows, actor, cap, role) {
  if (role === 'teacher' && cap.teacher) return rows.filter(r => r.status !== 'draft' && r.approvers?.includes(actor.sub));
  if (role === 'student' && cap.student) return rows.filter(r => r.owner === actor.sub);
  return [];
}
export function monthly(resources, month) {
  check(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), 400, '月份格式错误');
  const rows = resources.filter(r => String(r.registeredAt).slice(0, 7) === month);
  const totals = {}, projects = {};
  for (const r of rows) {
    totals[r.currency] = (totals[r.currency] || 0) + r.approvedCents;
    const key = r.project + '\u0000' + r.currency;
    const p = projects[key] ||= { project: r.project, currency: r.currency, cents: 0, count: 0 };
    p.cents += r.approvedCents; p.count++;
  }
  return { month, totals, projects: Object.values(projects), resources: rows.map(publicResource), label: '报销登记金额（按财务审核登记日期）' };
}
function authorize(actor, cap, kind) { check(actor?.sub && cap[kind], 403, '没有此项操作权限'); }
function own(record, actor) { check(record?.owner === actor.sub, 404, '记录不存在或不可见'); }
function revision(record, expected) { check(Number.isInteger(expected) && expected === record.revision, 409, '记录已更新，请刷新后再处理'); }
function event(record, actor, action, at) {
  record.history ||= [];
  record.history.push({ actorName: actor.name, action, at: new Date(at).toISOString() });
  check(record.history.length <= 200, 409, '历史记录已达到本单上限，请联系管理员归档，不会删除历史');
}
function notice(record, to, scope, title, body) {
  record.notifications ||= [];
  record.notifications.push({ id: `${record.id}:${record.revision}:${scope}:${record.notifications.length}`, to, scope, title, body });
}
export function newClaim(actor, cap, body, id, at) {
  authorize(actor, cap, 'student');
  const r = { id, kind: 'claim', owner: actor.sub, ownerName: actor.name, project: text(body.project, '所属项目', 1, 120), title: text(body.title, '费用说明', 1, 300), currency: currency(body.currency || 'CNY'), status: 'receive', revision: 1, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(), items: [], note: '请通过微信向财务提交材料，并注明本单编号。', archive: '', notifications: [] };
  event(r, actor, '登记报销需求', at);
  return r;
}
export function editBudget(previous, actor, cap, body, id, env, at) {
  authorize(actor, cap, 'student');
  const old = previous ? structuredClone(previous) : null;
  if (old) { own(old, actor); revision(old, body.revision); check(['draft','supplement'].includes(old.status), 409, '仅草稿或待补充的申请可以修改'); }
  check(['draft','submit'].includes(body.action), 400, '预算操作无效');
  const approvers = ids(env.BUDGET_APPROVER_OPEN_IDS).filter(x => x !== actor.sub);
  check(body.action !== 'submit' || approvers.length > 0, 503, '尚未配置可审核此申请的老师');
  const r = { ...(old || { id, kind: 'budget', owner: actor.sub, ownerName: actor.name, createdAt: new Date(at).toISOString(), history: [], notifications: [], snapshots: [] }),
    project: text(body.project, '所属项目', 1, 120), title: text(body.title, '申请标题', 1, 120), purpose: text(body.purpose, '申请目的', 1, 1200), currency: currency(body.currency || 'CNY'), items: lines(body.items, 'budget', at), extra: text(body.extra, '补充说明', 0, 3000), revision: (old?.revision || 0) + 1, status: body.action === 'submit' ? 'pending' : 'draft', updatedAt: new Date(at).toISOString(), comment: '', approvers };
  if (old && old.status === 'supplement') {
    r.snapshots.push({ revision: old.revision, items: old.items, purpose: old.purpose, extra: old.extra, comment: old.comment, at: old.updatedAt });
  }
  event(r, actor, body.action === 'submit' ? '提交预算申请' : '保存本人草稿', at);
  if (body.action === 'submit') {
    r.submittedAt = r.updatedAt;
    for (const to of approvers) notice(r, to, 'teacher', '新的项目预算待审批', `${r.id}｜${r.project}｜请登录报销与预算窗口审阅。`);
  }
  check(new TextEncoder().encode(JSON.stringify(r)).length <= 80000, 409, '申请与版本历史已较大，请联系管理员归档；历史不会被覆盖');
  return r;
}
export function decideBudget(previous, actor, cap, body, at) {
  authorize(actor, cap, 'teacher');
  check(previous && previous.status !== 'draft' && previous.approvers?.includes(actor.sub), 404, '申请不存在或不可见');
  check(previous.owner !== actor.sub, 403, '不能审核本人申请');
  revision(previous, body.revision);
  check(previous.status === 'pending', 409, '该申请已处理或尚未提交');
  check(['allow','deny','supplement'].includes(body.decision), 400, '请选择有效处理结果');
  const r = structuredClone(previous);
  r.status = body.decision; r.comment = text(body.comment, '处理说明', 0, 3000); r.revision++; r.updatedAt = new Date(at).toISOString();
  event(r, actor, BUDGET_STATUS[r.status] + (r.comment ? '：' + r.comment : '（未填写说明）'), at);
  notice(r, r.owner, 'owner', '项目预算申请已有回复', `${r.id}｜${BUDGET_STATUS[r.status]}\n${r.comment || '老师未填写补充说明。'}`);
  return r; // Deliberately no resource, claim or purchase side effects.
}
export function changeClaim(previous, actor, cap, action, body, at) {
  check(previous, 404, '报销记录不存在');
  if (action === 'resubmit') {
    authorize(actor, cap, 'student'); own(previous, actor); revision(previous, body.revision);
    check(previous.status === 'supplement', 409, '当前不需要补充');
    const r = structuredClone(previous); r.status = 'receive'; r.note = '学生反馈已通过微信补充，待财务确认收件。'; r.revision++; r.updatedAt = new Date(at).toISOString(); event(r, actor, '反馈微信补件已发送', at); return r;
  }
  authorize(actor, cap, 'finance');
  check(previous.owner !== actor.sub, 403, '本人报销必须交由其他已授权财务审核');
  revision(previous, body.revision);
  const r = structuredClone(previous);
  if (action === 'received') {
    check(['receive','supplement'].includes(r.status), 409, '当前不能重复确认收件');
    r.status = 'review'; r.note = '微信材料已收齐，等待财务核对。';
  } else if (action === 'supplement') {
    check(['receive','review','supplement'].includes(r.status), 409, '已审核记录不能退回补件');
    r.status = 'supplement'; r.note = text(body.note, '缺项说明', 1, 1500);
  } else if (action === 'approve') {
    check(r.status === 'review', 409, '请先确认微信材料已收齐');
    check(body.finalConfirmed === true, 400, '请确认这是财务最终审核');
    r.items = lines(body.items, 'claim', at);
    r.archive = text(body.archive, '归档位置说明', 0, 1000);
    r.status = 'registering'; r.registeredAt = dateOnly(at); r.reviewer = actor.sub;
    r.note = '财务审核通过，正在登记正式资源清单。';
  } else fail(400, '不支持的报销操作');
  r.revision++; r.updatedAt = new Date(at).toISOString(); event(r, actor, action === 'approve' ? '财务最终审核通过' : CLAIM_STATUS[r.status], at);
  if (action === 'supplement') notice(r, r.owner, 'owner', '报销需要补充', `${r.id}\n${r.note}`);
  return r;
}
export function claimResources(r) {
  check(['registering','done'].includes(r.status), 409, '尚未通过最终审核');
  return r.items.map(line => ({ id: `${r.id}-${line.id}`, project: r.project, name: line.name, spec: line.spec, qty: line.qty, unitCents: line.unitCents, totalCents: line.totalCents, approvedCents: line.approvedCents, purchaseDate: line.purchaseDate, registeredAt: r.registeredAt, currency: r.currency, ownerName: r.ownerName, reimbursed: '是', progress: '完成采购' }));
}
export function completeClaim(previous, actor, at) {
  check(previous.status === 'registering', 409, '无需重复登记');
  const r = structuredClone(previous); r.status = 'done'; r.note = '已通过财务审核并登记资源清单。'; r.revision++; r.updatedAt = new Date(at).toISOString(); event(r, actor, '正式资源清单登记成功', at);
  notice(r, r.owner, 'owner', '报销已完成登记', `${r.id}｜已报销；正式资源清单可查看。本状态不代表系统核验了银行到账。`);
  return r;
}
