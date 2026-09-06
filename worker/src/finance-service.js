import legacy from './index.js';
import * as D from './finance-domain.js';
const API = 'https://open.feishu.cn/open-apis';
let tokenCache = { value: '', until: 0 };
const encode = s => encodeURIComponent(s);
const jsonBytes = v => new TextEncoder().encode(JSON.stringify(v)).length;
const txt = v => Array.isArray(v) ? v.map(txt).join('') : v && typeof v === 'object' ? String(v.text ?? v.name ?? '') : String(v ?? '');
export async function hash(value) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function financeReadiness(env) {
  const bases = ['FINANCE_CLAIMS_BASE_APP_TOKEN','FINANCE_BUDGET_BASE_APP_TOKEN','FINANCE_RESOURCE_BASE_APP_TOKEN'].map(k => env[k]);
  const tablesConfigured = bases.every(Boolean) && ['FINANCE_CLAIMS_TABLE_ID','FINANCE_BUDGET_TABLE_ID','FINANCE_RESOURCE_TABLE_ID'].every(k => env[k]) && new Set(bases).size === 3;
  const accessConfigured = D.ids(env.FINANCE_OPEN_IDS).length > 0 && D.ids(env.BUDGET_APPROVER_OPEN_IDS).length > 0;
  const scopeVerified = env.FINANCE_DESTINATION_VERIFIED === 'true' && env.FINANCE_ROOT_WIKI_TOKEN === 'LIYtwb1ZaiEZinkowkbczYx5nIe';
  return { version: D.VERSION, enabled: env.FINANCE_FEATURE_ENABLED === 'true', tablesConfigured: Boolean(tablesConfigured), accessConfigured, scopeVerified,
    coordinatorConfigured: Boolean(env.FINANCE_COORDINATOR), ready: Boolean(env.FINANCE_FEATURE_ENABLED === 'true' && tablesConfigured && accessConfigured && scopeVerified && env.FINANCE_COORDINATOR),
    notificationsEnabled: env.FINANCE_NOTIFICATIONS_ENABLED === 'true', remindersEnabled: env.FINANCE_REMINDERS_ENABLED === 'true' && Boolean(env.FINANCE_REMINDER_ANCHOR), aiEnabled: false };
}
async function api(env, path, body, method = body ? 'POST' : 'GET', token = '') {
  if (!token) {
    if (!tokenCache.value || tokenCache.until < Date.now()) {
      const r = await fetch(API + '/auth/v3/tenant_access_token/internal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }), signal: AbortSignal.timeout(10000) });
      const j = await r.json(); D.check(r.ok && j.code === 0 && j.tenant_access_token, 502, '飞书应用授权暂时不可用');
      tokenCache = { value: j.tenant_access_token, until: Date.now() + Math.max(60, (Number(j.expire) || 7200) - 120) * 1000 };
    }
    token = tokenCache.value;
  }
  let r;
  try { r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) }); }
  catch (_) { D.fail(502, '飞书接口连接异常，请稍后重试；不要重复新建申请'); }
  const j = await r.json().catch(() => ({}));
  D.check(r.ok && j.code === 0, 502, '飞书数据或权限接口暂时不可用（' + (j.code || r.status) + '）');
  return j.data || j;
}
export class FeishuFinanceStore {
  constructor(env, storage) { this.env = env; this.storage = storage; this.cache = new Map(); }
  path(kind) {
    const key = { claims: 'CLAIMS', budgets: 'BUDGET', resources: 'RESOURCE' }[kind];
    D.check(key, 500, '数据分区错误');
    const base = this.env['FINANCE_' + key + '_BASE_APP_TOKEN'], table = this.env['FINANCE_' + key + '_TABLE_ID'];
    D.check(base && table && base !== this.env.READ_ONLY_RESOURCE_APP_TOKEN, 503, '目标财务数据分区未安全配置');
    return '/bitable/v1/apps/' + encode(base) + '/tables/' + encode(table) + '/records';
  }
  async raw(kind) {
    if (this.cache.has(kind)) return this.cache.get(kind);
    const rows = [], seen = new Set(); let page = '';
    do {
      const d = await api(this.env, this.path(kind) + '?page_size=500' + (page ? '&page_token=' + encode(page) : ''));
      D.check(Array.isArray(d.items), 502, '数据列表不完整'); rows.push(...d.items);
      if (!d.has_more) break;
      page = d.page_token;
      D.check(page && !seen.has(page), 502, '数据翻页异常，已停止以避免遗漏'); seen.add(page);
    } while (page);
    this.cache.set(kind, rows); return rows;
  }
  decode(kind, r) {
    const f = r.fields || {};
    if (kind !== 'resources') {
      try { const data = JSON.parse(txt(f['记录JSON'])); D.check(data.id === txt(f['业务编号']), 502, '业务键不一致'); return data; }
      catch (_) { D.fail(502, '财务记录格式异常，请联系管理员；没有忽略或删除该记录'); }
    }
    const n = k => { const v = Number(f[k]); D.check(Number.isFinite(v) && v >= 0, 502, '资源金额格式异常'); return v; };
    return { id: txt(f['登记编号']), project: txt(f['所属项目']), name: txt(f['资源名称']), spec: txt(f['规格型号']), qty: n('数量'), unitCents: Math.round(n('采购价格（单价）') * 100), totalCents: Math.round(n('采购总额') * 100), approvedCents: Math.round(n('本次报销金额') * 100), currency: txt(f['币种']), purchaseDate: txt(f['采购日期']), registeredAt: txt(f['报销登记日期']), ownerName: txt(f['采购经办人']), reimbursed: txt(f['是否已报销']), progress: txt(f['采购进度']) };
  }
  async list(kind) { return (await this.raw(kind)).filter(r => txt(r.fields?.[kind === 'resources' ? '登记编号' : '业务编号'])).map(r => this.decode(kind, r)); }
  async get(kind, id) {
    const found = (await this.list(kind)).filter(r => r.id === id);
    D.check(found.length < 2, 409, '检测到重复业务编号，请财务核查'); return found[0] || null;
  }
  async save(kind, data) {
    D.check(kind === 'resources' || jsonBytes(data) <= 90000, 400, '单条记录过大，请联系管理员归档');
    const keyField = kind === 'resources' ? '登记编号' : '业务编号';
    const rows = await this.raw(kind), matches = rows.filter(r => txt(r.fields?.[keyField]) === data.id);
    D.check(matches.length < 2, 409, '检测到重复业务编号，已阻止重复登记');
    let fields;
    if (kind === 'resources') fields = { '登记编号': data.id, '所属项目': data.project, '资源名称': data.name, '规格型号': data.spec || '', '数量': data.qty, '采购价格（单价）': data.unitCents / 100, '采购总额': data.totalCents / 100, '本次报销金额': data.approvedCents / 100, '币种': data.currency, '采购日期': data.purchaseDate, '报销登记日期': data.registeredAt, '是否已报销': '是', '采购进度': '完成采购', '采购经办人': data.ownerName };
    else fields = { '业务编号': data.id, '记录JSON': JSON.stringify(data) };
    const uncertaintyKey = 'uncertain:' + kind + ':' + data.id;
    // A timed-out create must be reconciled, never blindly repeated. PUT is idempotent.
    if (!matches.length) D.check(!(await this.storage.get(uncertaintyKey)), 409, '上次新增结果不确定，已停止重复新增；请核对底表后解除待核查状态');
    const path = this.path(kind) + (matches.length ? '/' + encode(matches[0].record_id) : '');
    if (!matches.length) await this.storage.put(uncertaintyKey, { at: Date.now() });
    const d = await api(this.env, path, { fields }, matches.length ? 'PUT' : 'POST');
    const row = d.record;
    D.check(row?.record_id, 502, '飞书未返回记录编号，请核查登记结果');
    if (matches.length) rows.splice(rows.indexOf(matches[0]), 1, row); else rows.push(row);
    await this.storage.delete(uncertaintyKey);
    return data;
  }
}
function response(request, env, body, status = 200) {
  const origin = new URL(env.FRONTEND_URL || 'https://1zjj.github.io/ER2_Lab_End/').origin;
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-ID', 'Vary': 'Origin' } });
}
async function readBody(request) {
  D.check((request.headers.get('content-type') || '').includes('application/json'), 415, '请求格式必须为JSON');
  const t = await request.text(); D.check(new TextEncoder().encode(t).length <= 96000, 413, '请求过大，请不要上传票据');
  let b; try { b = JSON.parse(t); } catch (_) { D.fail(400, 'JSON格式错误'); }
  D.check(b && typeof b === 'object' && !Array.isArray(b), 400, '请求格式错误'); return b;
}
function budgetView(r) { return Object.fromEntries(['id','owner','ownerName','project','title','purpose','currency','items','extra','revision','status','createdAt','updatedAt','submittedAt','comment','snapshots','history'].map(k => [k,r[k]])); }
function claimView(r, finance) { return { ...D.studentClaim(r), ...(finance ? { archive: r.archive || '', reviewer: r.reviewer || '' } : {}) }; }
export async function activeProfile(request, env) {
  const r = await legacy.fetch(new Request(new URL('/api/me', request.url), { headers: { Authorization: request.headers.get('Authorization') || '' } }), env);
  if (!r.ok) { const j = await r.json(); D.fail(r.status, j.message || '需要飞书登录'); }
  const { profile } = await r.json(); D.check(profile?.sub, 401, '登录身份无效'); return profile;
}
async function activeMembers(env) {
  let base = env.MEMBERS_BASE_APP_TOKEN || env.FEISHU_BASE_APP_TOKEN;
  const wiki = env.MEMBERS_BASE_WIKI_TOKEN || env.FEISHU_BASE_WIKI_TOKEN;
  if (!base && wiki) base = (await api(env, '/wiki/v2/spaces/get_node?token=' + encode(wiki))).node?.obj_token;
  D.check(base && env.MEMBERS_TABLE_ID, 503, '人员数据绑定未配置');
  const result = []; let page = '', seen = new Set();
  do {
    const data = await api(env, `/bitable/v1/apps/${encode(base)}/tables/${encode(env.MEMBERS_TABLE_ID)}/records?page_size=500${page ? '&page_token=' + encode(page) : ''}`);
    for (const r of data.items || []) {
      const f = r.fields || {}, id = txt(f['飞书OpenID']);
      if (id && f['是否启用'] !== false && !['否','false','停用'].includes(txt(f['是否启用']).toLowerCase())) result.push({ sub: id, name: txt(f['姓名']), student: /学生|student/.test(txt(f['角色'])) });
    }
    if (!data.has_more) break;
    page = data.page_token; D.check(page && !seen.has(page), 502, '人员列表不完整'); seen.add(page);
  } while (page);
  return result;
}
async function sendNotice(env, storage, n, members) {
  if (env.FINANCE_NOTIFICATIONS_ENABLED !== 'true') return false;
  if (!members.some(m => m.sub === n.to)) return false;
  if (n.scope === 'teacher' && !D.ids(env.BUDGET_APPROVER_OPEN_IDS).includes(n.to)) return false;
  const key = 'sent:' + n.id + ':' + n.to;
  if (await storage.get(key)) return true;
  const link = new URL('finance/', env.FRONTEND_URL).href;
  await api(env, '/im/v1/messages?receive_id_type=open_id', { receive_id: n.to, msg_type: 'text', content: JSON.stringify({ text: '【ER² ' + n.title + '】\n' + n.body + '\n' + link }), uuid: (await hash(key)).slice(0,32) });
  await storage.put(key, Date.now()); return true;
}
export class FinanceService {
  constructor(env, storage, store = new FeishuFinanceStore(env, storage), clock = () => Date.now()) { this.env = env; this.storage = storage; this.store = store; this.clock = clock; }
  async dashboard(actor, role, month) {
    const cap = D.capabilities(actor, this.env);
    const available = ['student','finance','teacher'].filter(r => cap[r]);
    if (!role) role = available.includes('teacher') ? 'teacher' : available.includes('finance') ? 'finance' : available[0] || 'resources';
    D.check(role === 'resources' || cap[role], 403, '没有此视角权限');
    const [cr, br, rs] = await Promise.all([this.store.list('claims'), this.store.list('budgets'), this.store.list('resources')]);
    const claims = cr.filter(r => r.kind === 'claim');
    const budgets = D.visibleBudgets(br, actor, cap, role);
    const period = D.periodAt(this.clock(), this.env.FINANCE_REMINDER_ANCHOR);
    const reply = cr.find(r => r.kind === 'response' && r.owner === actor.sub && r.period === period.id);
    const messages = [...cr, ...br].flatMap(r => r.notifications || []).filter(n => n.to === actor.sub && (n.scope !== 'teacher' || (cap.teacher && br.some(r => r.status !== 'draft' && r.approvers?.includes(actor.sub) && r.notifications?.some(x => x.id === n.id)))))
      .map(({ id, title, body }) => ({ id, title, body })).slice(-50).reverse();
    return { version: D.VERSION, profile: { id: actor.sub, name: actor.name }, capabilities: cap, role, availableRoles: available,
      period: { ...period, response: reply?.answer || 'unanswered', scheduled: this.env.FINANCE_REMINDERS_ENABLED === 'true' },
      claims: role === 'finance' ? claims.map(r => claimView(r,true)) : role === 'student' ? claims.filter(r => r.owner === actor.sub).map(r => claimView(r,false)) : [],
      budgets: budgets.map(budgetView), resources: rs.map(D.publicResource), messages,
      monthly: ['finance','teacher'].includes(role) ? D.monthly(rs, month || D.dateOnly(this.clock()).slice(0,7)) : null,
      pendingClaims: ['finance','teacher'].includes(role) ? claims.filter(r => r.status !== 'done').length : null,
      contact: { name: this.env.FINANCE_CONTACT_NAME || '财务经办', instructions: '票据通过微信交给财务，并注明申请编号。无需在飞书重复上传。' },
      notificationsEnabled: this.env.FINANCE_NOTIFICATIONS_ENABLED === 'true' };
  }
  async mutate(actor, path, body, requestId) {
    const cap = D.capabilities(actor, this.env), at = this.clock();
    D.check(/^[a-zA-Z0-9_-]{16,100}$/.test(requestId || ''), 400, '缺少有效请求编号，请刷新后重试');
    const required = path === 'monthly/confirm' || /claims\/[^/]+\/(received|supplement|approve|retry)$/.test(path) ? 'finance' : /budgets\/[^/]+\/review$/.test(path) ? 'teacher' : 'student';
    D.check(cap[required], 403, '没有此项操作权限');
    const key = 'op:' + await hash(actor.sub + ':' + path + ':' + requestId), fingerprint = await hash(JSON.stringify(body));
    const previousOp = await this.storage.get(key);
    if (previousOp) D.check(previousOp.fingerprint === fingerprint, 409, '同一请求编号不能对应不同内容');
    if (previousOp?.done) return previousOp.result;
    await this.storage.put(key, { fingerprint, done:false });
    const op = { key, fingerprint }, processed = r => r?.operation?.key === key && r.operation.fingerprint === fingerprint;
    const save = async (kind,r) => { r.operation = op; return this.store.save(kind,r); };
    let result;
    if (path === 'claims') {
      const id = 'BX-' + D.dateOnly(at).slice(0,4) + '-' + (await hash(key)).slice(0,12).toUpperCase();
      const old = await this.store.get('claims',id);
      if (!old) await save('claims',D.newClaim(actor,cap,body,id,at));
      result = { ok:true,id };
    } else if (path === 'responses') {
      const p = D.periodAt(at,this.env.FINANCE_REMINDER_ANCHOR);
      D.check(p.enabled && body.period === p.id && ['yes','no'].includes(body.answer),400,'报销周期或回应无效');
      const id = 'R-' + (await hash(actor.sub + ':' + p.id)).slice(0,24);
      await save('claims',{id,kind:'response',owner:actor.sub,period:p.id,answer:body.answer,at:new Date(at).toISOString()}); result={ok:true};
    } else if (path === 'budgets' || /^budgets\/[^/]+\/save$/.test(path)) {
      const id = path === 'budgets' ? 'YS-' + D.dateOnly(at).slice(0,4) + '-' + (await hash(key)).slice(0,12).toUpperCase() : path.split('/')[1];
      const old=await this.store.get('budgets',id);
      if (!processed(old)) await save('budgets',D.editBudget(old,actor,cap,body,id,this.env,at));
      result={ok:true,id};
    } else if (/^budgets\/[^/]+\/review$/.test(path)) {
      const id=path.split('/')[1], old=await this.store.get('budgets',id);
      if (!processed(old)) await save('budgets',D.decideBudget(old,actor,cap,body,at)); result={ok:true,id};
    } else if (/^claims\/[^/]+\/(received|supplement|approve|retry|resubmit)$/.test(path)) {
      const [,id,action]=path.split('/'); let r=await this.store.get('claims',id);
      D.check(r?.kind==='claim',404,'报销记录不存在');
      if (action==='retry') { D.check(cap.finance && r.owner!==actor.sub,403,'没有登记重试权限'); D.check(['registering','done'].includes(r.status),409,'当前无需登记重试'); }
      else if (!processed(r)) r=await save('claims',D.changeClaim(r,actor,cap,action,body,at));
      if (['approve','retry'].includes(action) && r.status==='registering') {
        for (const resource of D.claimResources(r)) {
          const old=await this.store.get('resources',resource.id);
          if (old) D.check(JSON.stringify(D.publicResource(old))===JSON.stringify(D.publicResource(resource)),409,'资源已有不同内容，请财务核查，未覆盖原记录');
          else await this.store.save('resources',resource);
        }
        r=await save('claims',D.completeClaim(r,actor,at));
      }
      result={ok:true,id,status:r.status};
    } else if (path==='monthly/confirm') {
      D.check(body.month < D.dateOnly(at).slice(0,7),400,'请核对已经结束的月份');
      D.check(body.confirmed===true,400,'请确认已核对该月数据');
      const snapshot=D.monthly(await this.store.list('resources'),body.month), snapshotHash=await hash(JSON.stringify(snapshot));
      D.check(body.snapshotHash===snapshotHash,409,'该月数据已变化，请刷新核对');
      const id='MONTH-'+body.month+'-'+snapshotHash.slice(0,12);
      if (!(await this.store.get('claims',id))) {
        const r={id,kind:'month',month:body.month,confirmedBy:actor.sub,at:new Date(at).toISOString(),snapshot,notifications:[]};
        for (const to of D.ids(this.env.BUDGET_APPROVER_OPEN_IDS)) r.notifications.push({id:id+':'+to,to,scope:'teacher',title:'月度费用简报（财务已核对）',body:body.month+'\n'+Object.entries(snapshot.totals).map(([c,n])=>c+' '+(n/100).toFixed(2)).join('\n')+'\n按财务审核登记日期统计，不含预算估算。'});
        await save('claims',r);
      }
      result={ok:true,id};
    } else D.fail(404,'接口不存在');
    await this.storage.put(key,{fingerprint,done:true,result});
    return result;
  }
  async flush() {
    if (this.env.FINANCE_NOTIFICATIONS_ENABLED!=='true') return;
    const members=await activeMembers(this.env);
    const rows=[...await this.store.list('claims'),...await this.store.list('budgets')];
    let attempts=0;
    for (const r of rows) for (const n of r.notifications||[]) {
      if (await this.storage.get('sent:'+n.id+':'+n.to)) continue;
      if (++attempts>20) return;
      try { await sendNotice(this.env,this.storage,n,members); } catch (_) { /* Persisted outbox stays pending for the next tick. */ }
    }
  }
  async tick(at) {
    if (this.env.FINANCE_REMINDERS_ENABLED==='true' && this.env.FINANCE_NOTIFICATIONS_ENABLED==='true') {
      const p=D.periodAt(at,this.env.FINANCE_REMINDER_ANCHOR), today=D.dateOnly(at);
      if(p.enabled && [p.start,new Date(Date.parse(p.start+'T00:00:00Z')+3*86400000).toISOString().slice(0,10)].includes(today)) {
        const members=await activeMembers(this.env), rows=await this.store.list('claims');
        for(const m of members.filter(m=>m.student)) {
          const answered=rows.some(r=>r.kind==='response'&&r.owner===m.sub&&r.period===p.id);
          if(answered)continue;
          await sendNotice(this.env,this.storage,{id:'fortnight:'+p.id+':'+today+':'+m.sub,to:m.sub,scope:'owner',title:'本期报销提醒',body:'本期是否有新增报销？请在'+p.due+'前回应“有报销”或“本期暂无”。票据仍通过微信交财务；旧申请不需重复登记。'},members);
        }
      }
    }
    await this.flush();
  }
}
export class FinanceCoordinator {
  constructor(ctx,env) { this.ctx=ctx;this.env=env;this.tail=Promise.resolve(); }
  async fetch(request) {
    const work=this.tail.then(()=>this.handle(request));this.tail=work.catch(()=>{});return work;
  }
  async handle(request) {
    try {
      if(new URL(request.url).pathname==='/__internal/finance-tick') {
        if(!financeReadiness(this.env).ready)return response(request,this.env,{skipped:'not_ready'});
        const b=await request.json();const service=new FinanceService(this.env,this.ctx.storage);await service.tick(b.at);return response(request,this.env,{ok:true});
      }
      const actor=await activeProfile(request,this.env);
      D.check(financeReadiness(this.env).ready,503,'财务模块尚待数据与权限配置；当前未开放提交');
      const url=new URL(request.url), path=url.pathname.replace(/^\/api\/finance\/?/,'');
      const service=new FinanceService(this.env,this.ctx.storage);
      if(request.method==='GET'&&path==='dashboard') {
        const data=await service.dashboard(actor,url.searchParams.get('role'),url.searchParams.get('month'));
        if(data.monthly)data.monthly.snapshotHash=await hash(JSON.stringify(data.monthly));
        return response(request,this.env,data);
      }
      if(request.method==='POST') {
        const body=await readBody(request), result=await service.mutate(actor,path,body,request.headers.get('X-Request-ID'));
        this.ctx.waitUntil(service.flush().catch(()=>{}));
        return response(request,this.env,result);
      }
      D.fail(404,'财务接口不存在');
    } catch(error) { return response(request,this.env,{message:error.status?error.message:'财务服务暂时不可用',requestId:request.headers.get('X-Request-ID')||''},error.status||500); }
  }
}
export async function financeFetch(request,env) {
  if(request.method==='OPTIONS')return response(request,env,null,204);
  if(!env.FINANCE_COORDINATOR)return response(request,env,{message:'财务模块尚待数据与权限配置；当前未开放提交'},503);
  return env.FINANCE_COORDINATOR.get(env.FINANCE_COORDINATOR.idFromName('er2-finance-v1')).fetch(request);
}
export async function financeTick(at,env) {
  if(!financeReadiness(env).ready)return;
  return env.FINANCE_COORDINATOR.get(env.FINANCE_COORDINATOR.idFromName('er2-finance-v1')).fetch(new Request('https://internal/__internal/finance-tick',{method:'POST',body:JSON.stringify({at})}));
}
