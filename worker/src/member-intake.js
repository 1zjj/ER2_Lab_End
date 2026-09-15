import { isAdministrator, identity, personNumber, text, authError } from './authorization.js';

// Planning only. Never write people, grants, invitations or application availability.
export function checkMemberIntake(actor, input, people) {
  if (!isAdministrator(actor)) throw authError(403, '仅管理员可检查成员入组资料');
  const keys = ['name','account','boundary','category','organization','start','end','weekly','weeklyStart','learning','literatureRead','literatureShare','literatureRequired','projects','notes'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))) throw authError(400, '入组字段不受支持');
  if (keys.some(k => typeof input[k] !== 'string' || input[k].length > (k === 'notes' ? 1000 : 300))) throw authError(400, '请完整填写入组表单');
  const plan = Object.fromEntries(keys.map(k => [k, input[k].trim()]));
  const choices = { boundary:['团队内','团队外'],category:['博士','硕士','本科生','联合培养','临时','PI','RA'],organization:['已加入','未加入','待确认'],weekly:['需要','不需要'],learning:['阅读','阅读与提交','不开放'],literatureRead:['允许','不允许'],literatureShare:['允许','不允许'],literatureRequired:['不考核','每周3篇'] };
  if (Object.entries(choices).some(([k,v]) => !v.includes(plan[k]))) throw authError(400, '请检查分类与功能选项');
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
  if (!plan.name || !plan.account || !validDate(plan.start) || plan.end && (!validDate(plan.end) || plan.end < plan.start)) throw authError(400, '姓名、账号或有效日期不完整');
  if (plan.weekly === '需要' && (!validDate(plan.weeklyStart) || new Date(plan.weeklyStart).getUTCDay() !== 1)) throw authError(400, '周报起始周请填写该周周一日期');
  if (plan.literatureShare === '允许' && plan.literatureRead !== '允许' || plan.literatureRequired !== '不考核' && plan.literatureShare !== '允许') throw authError(400, '文献考核需允许分享，分享需允许阅读');
  if (plan.projects && !/^PRJ-\d{3,}(\s*[,，]\s*PRJ-\d{3,})*$/.test(plan.projects)) throw authError(400, '项目请填写 PRJ 编号，以逗号分隔，或留空');
  const matches = people.filter(p => identity(p) === plan.account);
  const sameName = people.some(p => text(p.fields?.['姓名']) === plan.name);
  const account = /^ou_[\w-]+$/.test(plan.account) && matches.length === 1 && text(matches[0].fields?.['姓名']) === plan.name;
  return { mode:'planning-only', saved:false, accessGranted:false, plan, checks:[
    {label:'人员账号',status:account ? '已匹配现有记录' : '待核验',detail:account ? `${personNumber(matches[0])}：不会新增或覆盖该记录` : '姓名或显示名不能作为唯一身份；须核验应用对应 OpenID'},
    {label:'重复人员',status:matches.length > 1 ? '存在冲突' : sameName || matches.length ? '已有人员，需复核' : '待核验',detail:'本检查不生成正式人员编号，不自动创建人员'},
    {label:'飞书组织',status:'待核验',detail:`填报状态：${plan.organization}，不代表已通过组织通讯录验证`},
    {label:'应用使用资格',status:'待核验',detail:'未读取或修改应用可用范围，不能视为已开通'},
    {label:'功能配置',status:'仅生成方案',detail:'不改变任何现有成员功能、任务要求或管理职责'},
    {label:'知识库与项目',status:plan.projects ? '待逐项授权核验' : '不分配项目；公共资料待核验',detail:'不会授予系统后台、历史归档、财务审核或他人周报权限'},
    {label:'首次登录',status:'未验证',detail:'需要目标成员本人登录验收'}
  ] };
}
