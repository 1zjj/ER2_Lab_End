import { authority, identity, personNumber, authError, isInternalMember, isAdministrator } from './authorization.js';

export const FINANCE_VERSION = 'finance-v1';
export const FINANCE_STORE = 'er2-finance-v1';
export const SOURCE = Object.freeze({ wiki: 'U9VXwIUq7iO9TakZXjEc2lNEnVl', table: 'tblyGLLKqkzRg2Mg' });
export const EQUIPMENT = Object.freeze({ wiki: 'GDmVw7XkCiZ2vUkifI2cEEihnIc', table: 'tbl5zQIOvKMBYVHc' });
export const FINANCE_WIKI = 'EzDCwps7LivyqOk7UsJcVSutnCh';
export const DEVICE_FIELDS = ['文本','类型','采购进度','数量','图片','主要参数','采购价格（单价）','存放地点','父记录','采购日期','已报销','联络人','采购经办人'];
export const STATUS = Object.freeze({ draft:'草稿', submitted:'待财务审核', returned:'退回修改', approved:'已确认，入库处理中', sync_error:'入库待处理', completed:'已完成', sent:'已提交采购申请' });
export const F = Object.freeze({
  purchase: { name:'工作台采购申请', fields:{'申请编号':1,'申请人':11,'人员编号':1,'购买内容':1,'预计金额':2,'用途':1,'资料说明':1,'资料附件':17,'提交时间':5,'系统状态':1,'来源ID':1} },
  claim: { name:'工作台报销单', fields:{'报销编号':1,'申报人':11,'人员编号':1,'合计金额':2,'处理状态':1,'资料说明':1,'资料附件':17,'提交时间':5,'审核人':11,'审核时间':5,'退回原因':1,'来源ID':1} },
  line: { name:'工作台报销明细', fields:{'明细编号':1,'报销编号':1,'名称':1,'数量':2,'采购价格（单价）':2,'采购日期':5,'联络人':1,'金额':2,'设备记录ID':1,'来源ID':1} },
  log: { name:'工作台财务操作记录', fields:{'操作编号':1,'单据编号':1,'操作人':11,'时间':5,'操作':1,'说明':1,'来源ID':1} }
});

export function financeActor(people, sub) { return authority(people, [], [], sub); }
export function recipient(people, personId, duty = '') {
  const rows=people.filter(r=>personNumber(r)===personId);
  if(rows.length!==1) throw authError(503,'财务相关人员编号缺失或重复');
  const a=financeActor(people,identity(rows[0]));
  if(a.memberRecord.fields['人员边界']!=='团队内' || (duty && !a.duties.includes(duty))) throw authError(503,'财务相关人员职责尚未配置');
  return a;
}
export function financeAccess(actor, people, env) {
  const reviewerId=env.FINANCE_REVIEWER_PERSON_ID || 'P-004';
  let reviewer=null; try {reviewer=recipient(people,reviewerId,'财务');} catch (_) {}
  const delegates=String(env.FINANCE_DELEGATE_PERSON_IDS || '').split(',').filter(Boolean);
  const internal=isInternalMember(actor), admin=isAdministrator(actor);
  const delegate=internal && delegates.includes(actor.personId) && actor.duties.includes('管理员');
  return { canSubmit:internal, canReview:internal && (actor.sub===reviewer?.sub || delegate), canConfigure:admin, canViewAll:admin,
    isDelegate:delegate, reviewerReady:Boolean(reviewer), reviewerId, reviewerName:reviewer?.name || '',
    canSummary:internal && actor.personId===(env.FINANCE_PROFESSOR_PERSON_ID || 'P-001') };
}
export function requireReview(actor, access, doc) {
  if(!access.canReview) throw authError(403,'没有财务审核权限');
  if(doc.owner!==actor.sub&&doc.personId!==actor.personId) return;
  throw authError(403,'不能审核本人提交的报销单，请由代审人员处理');
}
export const editable = doc => ['draft','returned'].includes(doc.status);
export function canView(actor, access, doc) { return doc.owner===actor.sub || access.canViewAll || access.canReview && doc.kind==='claim' && doc.status!=='draft'; }
export function assertView(actor,access,doc) {
  if(!doc || !canView(actor,access,doc)) throw authError(404,'单据不存在或无权访问');
  if(doc.owner===actor.sub && doc.personId!==actor.personId) throw authError(403,'账号与原申报人身份不一致');
}
export function requestId(id) { if(!/^[a-zA-Z0-9_-]{16,80}$/.test(id || '')) throw authError(400,'请求标识无效'); return id; }
const short=(v,max,label,required=true)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw authError(400,label);return v.trim();};
export function validDate(s,now=Date.now()) {
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const date=new Date(s+'T00:00:00+08:00');
  return Number.isFinite(+date) && new Date(+date+8*3600000).toISOString().slice(0,10)===s && +date<=now && +date>=Date.parse('1990-01-01');
}
export function amountCents(value) {
  const s=String(value ?? '');
  if(!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(s))throw authError(400,'请填写有效单价，最多两位小数');
  const n=Math.round(Number(s)*100);if(!Number.isSafeInteger(n))throw authError(400,'金额超出范围');return n;
}
export function validateDocument(body, strict=true, now=Date.now()) {
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['id','revision','kind','lines','content','estimate','purpose','materials','attachmentIds','requestId','submit','purchaseId'].includes(k)))throw authError(400,'不能修改系统身份、状态或其他未支持字段');
  requestId(body.requestId);
  if(!['claim','purchase'].includes(body.kind))throw authError(400,'申请类型无效');
  const d={kind:body.kind, materials:short(body.materials||'',5000,'资料说明最多5000字',false), attachmentIds:body.attachmentIds || []};
  if(!Array.isArray(d.attachmentIds)||d.attachmentIds.length>20||d.attachmentIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(id))||new Set(d.attachmentIds).size!==d.attachmentIds.length)throw authError(400,'附件列表无效');
  if(d.kind==='purchase') {
    d.content=short(body.content||'',3000,'请填写准备购买的内容',strict);
    d.purpose=short(body.purpose||'',1500,'请填写用途或项目',strict);
    d.estimate=body.estimate===''||body.estimate==null?null:amountCents(body.estimate);
    if(strict&&d.estimate===null)throw authError(400,'请填写预计金额');
    d.totalCents=d.estimate||0;
  } else {
    if(!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>50)throw authError(400,'请登记1至50项购买明细');
    d.lines=body.lines.map((line,i)=>{
      if(!line||Object.keys(line).some(k=>!['name','quantity','unitPrice','purchaseDate','contact'].includes(k)))throw authError(400,'购买明细包含未支持的字段');
      const name=short(line.name||'',300,`第${i+1}项缺少名称`,strict);
      const quantity=String(line.quantity??'');
      if((strict||quantity!=='')&&(!/^(0|[1-9]\d{0,6})(\.\d{1,3})?$/.test(quantity)||Number(quantity)<=0))throw authError(400,`第${i+1}项数量必须为正数`);
      const cents=line.unitPrice===''||line.unitPrice==null?null:amountCents(line.unitPrice);
      if(strict&&cents===null)throw authError(400,`第${i+1}项缺少单价`);
      const purchaseDate=line.purchaseDate||'';
      if((strict||purchaseDate)&&!validDate(purchaseDate,now))throw authError(400,`第${i+1}项请填写有效的实际采购日期`);
      const contact=short(line.contact??'',500,`第${i+1}项联络人须为文本，最多500字`,false);
      if(strict&&!contact)throw authError(400,`第${i+1}项请填写联络人`);
      return {name,quantity,unitPrice:cents===null?'':(cents/100).toFixed(2),purchaseDate,contact,amountCents:Math.round(Number(quantity||0)*(cents||0))};
    });
    d.totalCents=d.lines.reduce((s,l)=>s+l.amountCents,0);
    if(!Number.isSafeInteger(d.totalCents)||d.totalCents>1e12)throw authError(400,'整单金额超出范围');
    d.purchaseId=body.purchaseId||'';
    if(d.purchaseId&&!/^PUR-\d{4}-\d{6}$/.test(d.purchaseId))throw authError(400,'关联采购申请编号无效');
  }
  return d;
}
export function devicePayload(line,owner,fields) {
  const byName=new Map(fields.map(f=>[f.field_name,f]));
  const cast=(name,value)=>{
    const f=byName.get(name);if(!f)throw authError(503,'设备字段尚未准备完成：'+name);
    if(f.type===1)return String(value);
    if(f.type===2)return Number(value);
    if(f.type===5)return Date.parse(value+'T00:00:00+08:00');
    if(f.type===7)return value==='是';
    if(f.type===3){if(!f.property?.options?.some(o=>o.name===value))throw authError(503,'设备选项尚未准备完成：'+name);return value;}
    throw authError(503,'设备字段类型不兼容：'+name);
  };
  const user=byName.get('采购经办人');if(user?.type!==11)throw authError(503,'采购经办人必须为飞书成员字段');
  const contact=short(line.contact??'',500,'联络人须为文本，最多500字',false);
  if(contact&&byName.get('联络人')?.type!==1)throw authError(503,'设备联络人必须为文本字段');
  return {'文本':cast('文本',line.name),'数量':cast('数量',line.quantity),'采购价格（单价）':cast('采购价格（单价）',line.unitPrice),
    '采购日期':cast('采购日期',line.purchaseDate),'采购进度':cast('采购进度','完成采购'),'已报销':cast('已报销','是'),'采购经办人':[{id:owner}],
    ...(contact?{'联络人':contact}:{})};
}
// Keep the existing device views readable without changing their definitions.
export function legacyDeviceName(name,fields) {
  return fields.some(f=>f.field_name==='设备名称'&&f.type===1)?{'设备名称':name}:{};
}
export function monthlySummary(docs,month) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw authError(400,'月份无效');
  const result={month,totalCents:0,pendingCents:0,people:{},items:[],syncIssues:0};
  for(const d of docs){if(d.kind!=='claim'||d.status==='draft')continue;
    const confirmed=['approved','sync_error','completed'].includes(d.status);
    for(const l of d.lines||[]){if(l.purchaseDate.slice(0,7)!==month)continue;
      if(!confirmed){result.pendingCents+=l.amountCents;continue;}
      result.totalCents+=l.amountCents;result.people[d.ownerName]=(result.people[d.ownerName]||0)+l.amountCents;
      result.items.push({document:d.id,name:l.name,quantity:l.quantity,amountCents:l.amountCents,owner:d.ownerName});
    }
    if(confirmed&&d.status!=='completed'&&d.lines.some(l=>l.purchaseDate.slice(0,7)===month))result.syncIssues++;
  }return result;
}
