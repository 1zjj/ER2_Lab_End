const FEISHU_API = 'https://open.feishu.cn/open-apis';
const FEISHU_AUTHORIZE = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
const wikiTokenCache = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return corsResponse(request, env, null, 204);

    try {
      if (url.pathname === '/health') {
        const authConfigured = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.SESSION_SECRET);
        const membersBinding = resolveTableBinding(env, 'MEMBERS_TABLE_ID');
        const weeklyBinding = resolveTableBinding(env, 'WEEKLY_TABLE_ID');
        const dataConfigured = Boolean(
          (membersBinding.appToken || membersBinding.wikiToken) && membersBinding.tableId &&
          (weeklyBinding.appToken || weeklyBinding.wikiToken) && weeklyBinding.tableId
        );
        return json(request, env, {
          ok: true,
          service: 'er2-lab-api',
          configured: authConfigured && dataConfigured,
          authConfigured,
          dataConfigured
        });
      }
      if (url.pathname === '/auth/launch') return await launchAuth(request, env);
      if (url.pathname === '/auth/callback') return await authCallback(request, env);

      const session = await requireSession(request, env);
      if (url.pathname === '/api/me' && request.method === 'GET') return json(request, env, { profile: session });
      if (url.pathname === '/api/dashboard' && request.method === 'GET') return dashboard(request, env, session);
      if (url.pathname === '/api/reports' && request.method === 'POST') return saveReport(request, env, session);
      if (url.pathname === '/api/teacher/review' && request.method === 'POST') return saveTeacherReview(request, env, session);
      return json(request, env, { message: '接口不存在' }, 404);
    } catch (error) {
      const status = Number(error.status || 500);
      const message = status >= 500 ? '服务暂时不可用，请稍后重试' : error.message;
      if (status >= 500) console.error(error);
      return json(request, env, { message }, status);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledTask(controller.scheduledTime, env));
  }
};

async function launchAuth(request, env) {
  requireConfig(env, ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'SESSION_SECRET', 'FRONTEND_URL', 'FEISHU_REDIRECT_URI']);
  const url = new URL(request.url);
  const requestedReturn = url.searchParams.get('returnTo') || env.FRONTEND_URL;
  const returnTo = allowedReturnTo(requestedReturn, env.FRONTEND_URL);
  const state = await signToken({ purpose: 'oauth', returnTo, exp: epoch() + 600 }, env.SESSION_SECRET);
  const authorizeUrl = new URL(FEISHU_AUTHORIZE);
  authorizeUrl.searchParams.set('app_id', env.FEISHU_APP_ID);
  authorizeUrl.searchParams.set('redirect_uri', env.FEISHU_REDIRECT_URI);
  authorizeUrl.searchParams.set('state', state);
  return Response.redirect(authorizeUrl.toString(), 302);
}

async function authCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateToken = url.searchParams.get('state');
  if (!code || !stateToken) throw httpError(400, '飞书授权参数不完整');
  const state = await verifyToken(stateToken, env.SESSION_SECRET);
  if (state.purpose !== 'oauth') throw httpError(400, '授权状态无效');

  const oauth = await feishuRequest('/authen/v2/oauth/token', {
    method: 'POST',
    body: {
      grant_type: 'authorization_code',
      client_id: env.FEISHU_APP_ID,
      client_secret: env.FEISHU_APP_SECRET,
      code,
      redirect_uri: env.FEISHU_REDIRECT_URI
    },
    rawAuth: true
  });
  const userToken = oauth.access_token || oauth.data?.access_token;
  if (!userToken) throw httpError(401, '未能取得飞书用户令牌');
  const userResult = await feishuRequest('/authen/v1/user_info', { bearer: userToken, rawAuth: true });
  const user = userResult.data || userResult;
  const openId = user.open_id;
  if (!openId) throw httpError(401, '未能识别飞书用户');

  const tenantToken = await getTenantToken(env);
  const members = await listRecords(env, tenantToken, 'MEMBERS_TABLE_ID');
  let memberRecord = members.find((record) => String(field(record, '飞书OpenID', 'OpenID', 'open_id')) === String(openId));
  if (!memberRecord && members.length === 0 && env.BOOTSTRAP_FIRST_USER === 'true') {
    const bootstrapFields = {
      '姓名': user.name || user.en_name || 'ER²管理员',
      '飞书OpenID': openId,
      '角色': ['学生', '教师', '管理者'],
      '项目编号': '',
      '课程方向': '',
      '是否启用': true
    };
    const created = await createRecord(env, tenantToken, 'MEMBERS_TABLE_ID', bootstrapFields);
    memberRecord = created.data?.record || { fields: bootstrapFields };
  }
  if (!memberRecord || field(memberRecord, '是否启用', '启用') === false) {
    throw httpError(403, '你的账号尚未加入ER² Lab人员表，请联系管理员');
  }
  const member = normalizeMember(memberRecord, user);
  const sessionToken = await signToken({
    purpose: 'session',
    sub: openId,
    name: member.name,
    roles: member.roles,
    teacherOpenId: member.teacherOpenId,
    projectCode: member.projectCode,
    track: member.track,
    exp: epoch() + 8 * 3600
  }, env.SESSION_SECRET);
  const returnTo = allowedReturnTo(state.returnTo, env.FRONTEND_URL);
  return Response.redirect(returnTo.split('#')[0] + '#session=' + encodeURIComponent(sessionToken), 302);
}

async function dashboard(request, env, session) {
  const requestedRole = new URL(request.url).searchParams.get('role');
  const role = session.roles.includes(requestedRole) ? requestedRole : session.roles[0];
  if (!role) throw httpError(403, '账号没有可用角色');
  const tenantToken = await getTenantToken(env);
  const [memberRecords, reportRecords, projectRecords, courseRecords, taskRecords, linkRecords] = await Promise.all([
    listRecords(env, tenantToken, 'MEMBERS_TABLE_ID'),
    listRecords(env, tenantToken, 'WEEKLY_TABLE_ID'),
    listRecords(env, tenantToken, 'PROJECTS_TABLE_ID'),
    listRecords(env, tenantToken, 'COURSES_TABLE_ID'),
    listRecords(env, tenantToken, 'TASKS_TABLE_ID'),
    listRecords(env, tenantToken, 'LINKS_TABLE_ID')
  ]);
  const currentWeek = weekInfo(new Date());
  const members = memberRecords.map((record) => normalizeMember(record));
  const profile = {
    name: session.name,
    track: session.track || '',
    roles: session.roles
  };
  const student = buildStudent(session, currentWeek, reportRecords, projectRecords, courseRecords, taskRecords, linkRecords);
  const teacher = buildTeacher(session, currentWeek, members, reportRecords);
  const manager = buildManager(members, projectRecords, courseRecords, env);
  return json(request, env, { profile, week: currentWeek, student, teacher, manager });
}

function buildStudent(session, week, reports, projects, courses, tasks, links) {
  const mine = (record) => String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(session.sub);
  const currentReport = reports.find((record) => mine(record) && String(field(record, '周次', 'WeekID')) === week.id);
  const project = projects.find((record) => String(field(record, '项目编号', '项目代码')) === String(session.projectCode)) || {};
  const projectFields = project.fields || {};
  const myCourses = courses.filter(mine);
  const completed = myCourses.filter((record) => ['已完成', '完成', true].includes(field(record, '状态', '完成状态'))).length;
  const total = Number(field(project, '课程总数')) || Math.max(myCourses.length, 5);
  const activeTasks = tasks.filter((record) => mine(record) && !['完成', '已完成'].includes(field(record, '状态'))).slice(0, 5);
  const roleLinks = links.filter((record) => {
    const audiences = arrayValue(field(record, '可见角色', '角色'));
    return !audiences.length || audiences.includes('student') || audiences.includes('学生');
  });
  const recentReports = reports
    .filter(mine)
    .sort((a, b) => String(field(b, '提交时间')).localeCompare(String(field(a, '提交时间'))))
    .slice(0, 4);
  const rawProgress = Number(field(project, '进度', '完成度')) || 0;
  const projectProgress = rawProgress > 0 && rawProgress <= 1 ? Math.round(rawProgress * 100) : Math.round(rawProgress);
  return {
    report: {
      status: currentReport ? 'submitted' : 'pending',
      label: currentReport ? '已提交' : '未提交'
    },
    course: {
      title: session.track || '培养课程',
      progress: Math.round((completed / Math.max(total, 1)) * 100),
      completed,
      total,
      next: field(myCourses.find((record) => !['完成', '已完成'].includes(field(record, '状态', '完成状态'))) || {}, '课程名称', 'Lesson') || '查看学习中心'
    },
    project: {
      code: session.projectCode || field(project, '项目编号', '项目代码') || '—',
      title: field(project, '项目名称', '名称') || '暂未分配项目',
      milestone: field(project, '当前里程碑', '里程碑') || '请在飞书项目页维护',
      progress: Math.max(0, Math.min(100, projectProgress)),
      blocker: field(project, '最近阻塞', '阻塞') || '暂无记录',
      url: field(project, '飞书链接', '项目链接') || ''
    },
    tasks: activeTasks.length ? activeTasks.map((record) => ({
      title: field(record, '任务名称', '任务') || '未命名任务',
      detail: field(record, '任务说明', '说明') || '',
      type: field(record, '类型') || '任务'
    })) : [{ title: '提交本周工作记录', detail: '记录进展、证据、阻塞和下一步', type: '周报' }],
    links: roleLinks.map((record) => ({
      title: field(record, '标题', '名称') || '飞书入口',
      url: field(record, '链接', 'URL') || ''
    })),
    submissions: recentReports.map((record) => ({
      title: '第' + (field(record, '周序号') || field(record, '周次') || '') + '周工作记录',
      date: field(record, '提交时间') || '',
      status: field(record, '审核状态') || '已提交'
    }))
  };
}

function buildTeacher(session, week, members, reports) {
  const managed = members.filter((member) => session.roles.includes('manager') || String(member.teacherOpenId) === String(session.sub));
  const currentReports = reports.filter((record) => String(field(record, '周次', 'WeekID')) === week.id);
  const students = managed.filter((member) => member.roles.includes('student')).map((member) => {
    const report = currentReports.find((record) => String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(member.openId));
    const blocker = report ? field(report, '问题与阻塞', '阻塞') : '';
    return {
      id: member.openId,
      name: member.name,
      project: member.projectCode || '暂未分配项目',
      status: report ? '已提交' : '未提交',
      blocker: blocker || (report ? '无' : '等待本周记录'),
      tone: report ? (blocker ? 'red' : 'green') : 'orange'
    };
  });
  return {
    stats: {
      submitted: students.filter((student) => student.status === '已提交').length,
      missing: students.filter((student) => student.status !== '已提交').length,
      blocked: students.filter((student) => student.tone === 'red').length
    },
    students,
    commonIssues: students.filter((student) => student.blocker && student.blocker !== '无' && student.status === '已提交')
      .map((student) => student.name + '：' + student.blocker).slice(0, 5)
  };
}

function buildManager(members, projects, courses, env) {
  return {
    stats: {
      members: members.filter((member) => member.enabled !== false).length,
      projects: projects.filter((record) => !['归档', '已结束'].includes(field(record, '状态'))).length,
      courses: new Set(courses.map((record) => field(record, '课程名称', 'Lesson')).filter(Boolean)).size
    },
    automations: [
      { name: '未交周报提醒', trigger: '周五 11:00', target: '未交学生', status: env.PROFESSOR_OPEN_ID ? '已配置' : '待配置' },
      { name: '提交状态更新', trigger: '学生提交后', target: '周报记录', status: '页面已支持' },
      { name: '教授周报摘要', trigger: '周五 18:00', target: '教授', status: env.PROFESSOR_OPEN_ID ? '已配置' : '待配置' }
    ]
  };
}

async function saveReport(request, env, session) {
  if (!session.roles.includes('student')) throw httpError(403, '只有学生账号可以提交本人周报');
  const body = await request.json();
  validateText(body.progress, '本周完成与结果', 1, 5000);
  validateText(body.nextPlan, '下周计划', 1, 3000);
  validateText(body.learning, '学习与方法', 0, 3000);
  validateText(body.blockers, '问题与阻塞', 0, 3000);
  if (body.evidence && !/^https:\/\//i.test(body.evidence)) throw httpError(400, '证据链接必须使用HTTPS地址');

  const currentWeek = weekInfo(new Date());
  if (body.weekId && body.weekId !== currentWeek.id) throw httpError(400, '只能提交当前周记录');
  const tenantToken = await getTenantToken(env);
  const records = await listRecords(env, tenantToken, 'WEEKLY_TABLE_ID');
  const existing = records.find((record) =>
    String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(session.sub) &&
    String(field(record, '周次', 'WeekID')) === currentWeek.id
  );
  const fields = {
    '飞书OpenID': session.sub,
    '姓名': session.name,
    '周次': currentWeek.id,
    '周序号': currentWeek.number,
    '周起始': currentWeek.start,
    '周结束': currentWeek.end,
    '本周完成与结果': clean(body.progress),
    '学习与方法': clean(body.learning),
    '证据链接': clean(body.evidence),
    '问题与阻塞': clean(body.blockers),
    '下周计划': clean(body.nextPlan),
    '提交状态': '已提交',
    '提交时间': new Date().toISOString()
  };
  if (existing) await updateRecord(env, tenantToken, 'WEEKLY_TABLE_ID', existing.record_id, fields);
  else await createRecord(env, tenantToken, 'WEEKLY_TABLE_ID', fields);
  return json(request, env, { ok: true, weekId: currentWeek.id, updated: Boolean(existing) });
}

async function saveTeacherReview(request, env, session) {
  if (!session.roles.some((role) => role === 'teacher' || role === 'manager')) throw httpError(403, '没有教师反馈权限');
  const body = await request.json();
  validateText(body.recordId, '记录ID', 1, 100);
  validateText(body.comment, '教师反馈', 1, 3000);
  const tenantToken = await getTenantToken(env);
  const reports = await listRecords(env, tenantToken, 'WEEKLY_TABLE_ID');
  const targetReport = reports.find((record) => record.record_id === body.recordId);
  if (!targetReport) throw httpError(404, '周报记录不存在');
  if (!session.roles.includes('manager')) {
    const targetOpenId = String(field(targetReport, '飞书OpenID', '人员OpenID', 'OpenID'));
    const members = await listRecords(env, tenantToken, 'MEMBERS_TABLE_ID');
    const targetMember = members.map((record) => normalizeMember(record)).find((member) => String(member.openId) === targetOpenId);
    if (!targetMember || String(targetMember.teacherOpenId) !== String(session.sub)) {
      throw httpError(403, '只能反馈自己负责学生的周报');
    }
  }
  await updateRecord(env, tenantToken, 'WEEKLY_TABLE_ID', body.recordId, {
    '教师反馈': clean(body.comment),
    '审核状态': '已反馈',
    '反馈教师OpenID': session.sub,
    '反馈时间': new Date().toISOString()
  });
  return json(request, env, { ok: true });
}

async function runScheduledTask(scheduledTime, env) {
  requireConfig(env, ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'MEMBERS_TABLE_ID', 'WEEKLY_TABLE_ID']);
  const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date(scheduledTime)));
  const tenantToken = await getTenantToken(env);
  const [memberRecords, reports] = await Promise.all([
    listRecords(env, tenantToken, 'MEMBERS_TABLE_ID'),
    listRecords(env, tenantToken, 'WEEKLY_TABLE_ID')
  ]);
  const members = memberRecords.map((record) => normalizeMember(record)).filter((member) => member.enabled && member.roles.includes('student'));
  const week = weekInfo(new Date(scheduledTime));
  const currentReports = reports.filter((record) => String(field(record, '周次', 'WeekID')) === week.id);

  if (localHour === 11) {
    const missing = members.filter((member) => !currentReports.some((record) => String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(member.openId)));
    await Promise.all(missing.map((member) => sendText(env, tenantToken, member.openId,
      'ER² Lab提醒：你本周的工作记录尚未提交，请在今天18:00前进入工作台完成。')));
    await writeAutomationLog(env, tenantToken, '未交周报提醒', '成功', missing.length + '人');
  }

  if (localHour === 18 && env.PROFESSOR_OPEN_ID) {
    const submitted = currentReports.length;
    const missingNames = members.filter((member) => !currentReports.some((record) => String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(member.openId))).map((member) => member.name);
    const blockers = currentReports.map((record) => field(record, '问题与阻塞', '阻塞')).filter(Boolean);
    const summary = [
      'ER² Lab ' + week.label + ' 周报汇总',
      '已提交：' + submitted + '/' + members.length,
      '未提交：' + (missingNames.join('、') || '无'),
      '主要阻塞：' + (blockers.slice(0, 5).join('；') || '无')
    ].join('\n');
    await sendText(env, tenantToken, env.PROFESSOR_OPEN_ID, summary);
    await writeAutomationLog(env, tenantToken, '教授周报摘要', '成功', submitted + '/' + members.length);
  }
}

async function getTenantToken(env) {
  requireConfig(env, ['FEISHU_APP_ID', 'FEISHU_APP_SECRET']);
  const result = await feishuRequest('/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    body: { app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET },
    rawAuth: true
  });
  const token = result.tenant_access_token || result.data?.tenant_access_token;
  if (!token) throw httpError(502, '未能取得飞书应用令牌');
  return token;
}

function resolveTableBinding(env, tableBinding) {
  const tokenBinding = String(tableBinding).replace(/_TABLE_ID$/, '_BASE_APP_TOKEN');
  const wikiBinding = String(tableBinding).replace(/_TABLE_ID$/, '_BASE_WIKI_TOKEN');
  return {
    appToken: env[tokenBinding] || env.FEISHU_BASE_APP_TOKEN || '',
    wikiToken: env[wikiBinding] || env.FEISHU_BASE_WIKI_TOKEN || '',
    tableId: env[tableBinding] || ''
  };
}

async function resolveBitableAppToken(binding, token) {
  if (binding.appToken) return binding.appToken;
  if (!binding.wikiToken) return '';
  if (wikiTokenCache.has(binding.wikiToken)) return wikiTokenCache.get(binding.wikiToken);
  const result = await feishuRequest('/wiki/v2/spaces/get_node?token=' + encodeURIComponent(binding.wikiToken), { bearer: token });
  const appToken = result.data?.node?.obj_token || '';
  if (!appToken) throw httpError(502, '未能解析飞书知识库中的多维表格标识');
  wikiTokenCache.set(binding.wikiToken, appToken);
  return appToken;
}

async function listRecords(env, token, tableBinding) {
  const binding = resolveTableBinding(env, tableBinding);
  if ((!binding.appToken && !binding.wikiToken) || !binding.tableId) return [];
  const appToken = await resolveBitableAppToken(binding, token);
  const tableId = binding.tableId;
  let pageToken = '';
  const records = [];
  do {
    const suffix = pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '';
    const result = await feishuRequest('/bitable/v1/apps/' + appToken + '/tables/' + tableId + '/records?page_size=500' + suffix, { bearer: token });
    records.push(...(result.data?.items || []));
    pageToken = result.data?.has_more ? result.data?.page_token : '';
  } while (pageToken);
  return records;
}

async function createRecord(env, token, tableBinding, fields) {
  const binding = resolveTableBinding(env, tableBinding);
  const appToken = await resolveBitableAppToken(binding, token);
  const tableId = binding.tableId;
  if (!appToken || !tableId) throw httpError(500, '目标数据表尚未配置：' + tableBinding);
  return feishuRequest('/bitable/v1/apps/' + appToken + '/tables/' + tableId + '/records', {
    method: 'POST',
    bearer: token,
    body: { fields }
  });
}

async function updateRecord(env, token, tableBinding, recordId, fields) {
  const binding = resolveTableBinding(env, tableBinding);
  const appToken = await resolveBitableAppToken(binding, token);
  const tableId = binding.tableId;
  if (!appToken || !tableId) throw httpError(500, '目标数据表尚未配置：' + tableBinding);
  return feishuRequest('/bitable/v1/apps/' + appToken + '/tables/' + tableId + '/records/' + recordId, {
    method: 'PUT',
    bearer: token,
    body: { fields }
  });
}

async function sendText(env, token, openId, text) {
  if (!openId) return;
  await feishuRequest('/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    bearer: token,
    body: { receive_id: openId, msg_type: 'text', content: JSON.stringify({ text }) }
  });
}

async function writeAutomationLog(env, token, name, result, detail) {
  if (!env.AUTOMATION_LOGS_TABLE_ID) return;
  await createRecord(env, token, 'AUTOMATION_LOGS_TABLE_ID', {
    '任务名称': name,
    '执行时间': new Date().toISOString(),
    '执行结果': result,
    '执行说明': detail
  });
}

async function feishuRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (options.bearer) headers.Authorization = 'Bearer ' + options.bearer;
  const response = await fetch(FEISHU_API + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || (typeof result.code === 'number' && result.code !== 0)) {
    console.error('Feishu API error', path, response.status, result.code, result.msg);
    throw httpError(502, '飞书数据接口返回异常');
  }
  return result;
}

function normalizeMember(record, oauthUser = {}) {
  const roles = arrayValue(field(record, '角色')).map((role) => {
    const value = String(role).toLowerCase();
    if (value.includes('管理')) return 'manager';
    if (value.includes('教师') || value.includes('教授')) return 'teacher';
    if (value.includes('学生')) return 'student';
    return ['student', 'teacher', 'manager'].includes(value) ? value : '';
  }).filter(Boolean);
  return {
    openId: field(record, '飞书OpenID', 'OpenID', 'open_id') || oauthUser.open_id || '',
    name: field(record, '姓名', '人员姓名') || oauthUser.name || oauthUser.en_name || 'ER²成员',
    roles: roles.length ? [...new Set(roles)] : ['student'],
    teacherOpenId: field(record, '负责教师OpenID', '教师OpenID') || '',
    projectCode: field(record, '项目编号', '项目代码') || '',
    track: field(record, '课程方向', '培养方向') || '',
    enabled: field(record, '是否启用', '启用') !== false
  };
}

function field(record, ...names) {
  const fields = record?.fields || {};
  for (const name of names) {
    let value = fields[name];
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 1) value = value[0];
    if (value && typeof value === 'object') {
      if ('text' in value) value = value.text;
      else if ('name' in value) value = value.name;
      else if ('link' in value) value = value.link;
    }
    return value;
  }
  return '';
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' ? [item] : [item?.name || item?.text || '']).filter(Boolean);
  if (typeof value === 'string') return value.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
  return value ? [String(value)] : [];
}

function weekInfo(date) {
  const shanghai = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const day = shanghai.getDay() || 7;
  const monday = new Date(shanghai);
  monday.setDate(shanghai.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const target = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
  const targetDay = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - targetDay);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const number = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  const year = target.getUTCFullYear();
  const dateLabel = (value) => value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  return {
    id: year + '-W' + String(number).padStart(2, '0'),
    number,
    start: dateLabel(monday),
    end: dateLabel(sunday),
    label: dateLabel(monday) + '—' + dateLabel(sunday) + ' · 第' + number + '周',
    dueLabel: '周五 18:00 截止'
  };
}

async function requireSession(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) throw httpError(401, '需要飞书登录');
  const session = await verifyToken(header.slice(7), env.SESSION_SECRET);
  if (session.purpose !== 'session' || !session.sub) throw httpError(401, '登录状态无效');
  return session;
}

async function signToken(payload, secret) {
  if (!secret) throw httpError(500, 'SESSION_SECRET未配置');
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return encoded + '.' + base64Url(new Uint8Array(signature));
}

async function verifyToken(token, secret) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) throw httpError(401, '登录状态无效');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(signature), new TextEncoder().encode(encoded));
  if (!valid) throw httpError(401, '登录状态无效');
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
  if (!payload.exp || payload.exp < epoch()) throw httpError(401, '登录状态已过期');
  return payload;
}

function base64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function allowedReturnTo(value, frontendUrl) {
  try {
    const candidate = new URL(value);
    const allowed = new URL(frontendUrl);
    return candidate.origin === allowed.origin && candidate.pathname.startsWith(allowed.pathname) ? candidate.href : allowed.href;
  } catch (_) {
    return frontendUrl;
  }
}

function corsResponse(request, env, body, status) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowedOrigin = new URL(env.FRONTEND_URL || 'https://1zjj.github.io/ER2_Lab_End/').origin;
  const origin = requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin;
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Vary': 'Origin'
    }
  });
}

function json(request, env, value, status = 200) {
  const response = corsResponse(request, env, JSON.stringify(value), status);
  response.headers.set('Content-Type', 'application/json; charset=utf-8');
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

function requireConfig(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw httpError(500, '服务配置尚未完成：' + missing.join(', '));
}

function validateText(value, label, min, max) {
  const length = String(value || '').trim().length;
  if (length < min) throw httpError(400, '请填写' + label);
  if (length > max) throw httpError(400, label + '不能超过' + max + '字');
}

function clean(value) {
  return String(value || '').trim();
}

function epoch() {
  return Math.floor(Date.now() / 1000);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
