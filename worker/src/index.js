const FEISHU_API = 'https://open.feishu.cn/open-apis';
const FEISHU_AUTHORIZE = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
const wikiTokenCache = new Map();
const requestIds = new WeakMap();
const writeRateBuckets = new Map();
const courseConfirmationLocks = new Map();
let tenantTokenCache = { token: '', expiresAt: 0 };
const LITERATURE_TABLE_FALLBACK = 'tblyHLZpybGVU364';
const TRACK_A_ID = 'track-a';
const TRACK_A_TITLE = 'Track A｜感知与语义导航';
const ONBOARDING_TRACK = '入组准备';
const ONBOARDING_LESSON = 'ONBOARDING';
const ONBOARDING_STEPS = ['feishu-access', 'lab-rules', 'environment', 'track-a', 'test-submit'];
const TRACK_A_LESSONS = [
  { id: '01', title: '仿真与系统结构', prompt: '仿真系统由哪些模块组成？课程环境如何启动？' },
  { id: '02', title: 'ROS 数据流', prompt: 'ROS 节点、Topic 和消息如何构成数据流？' },
  { id: '03', title: '机器人本体与 TF', prompt: '机器人本体、URDF/Xacro 与 TF 分别有什么作用？' },
  { id: '04', title: '传感器原始数据', prompt: '传感器原始数据如何产生并进入 ROS？' },
  { id: '05', title: 'FAST-LIO2', prompt: 'FAST-LIO2 使用哪些输入，产生什么输出？' },
  { id: '06', title: '地图与 Costmap', prompt: '地图、障碍物和 Costmap 之间是什么关系？' },
  { id: '07', title: '全局规划', prompt: '全局规划如何生成可行路径？' },
  { id: '08', title: '局部规划与控制', prompt: '局部规划与控制如何完成跟踪和避障？' },
  { id: '09', title: '语义导航', prompt: '语义信息如何参与地图构建和导航决策？' },
  { id: '10', title: '综合实验与课程总结', prompt: '如何将感知、定位、建图、规划和控制组成完整闭环？' }
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    requestIds.set(request, request.headers.get('X-Request-ID') || crypto.randomUUID());
    if (request.method === 'OPTIONS') return corsResponse(request, env, null, 204);

    try {
      if (url.pathname === '/health') {
        const authConfigured = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.SESSION_SECRET);
        const membersBinding = resolveTableBinding(env, 'MEMBERS_TABLE_ID');
        const weeklyBinding = resolveTableBinding(env, 'WEEKLY_TABLE_ID');
        const literatureBinding = resolveTableBinding(env, 'LITERATURE_TABLE_ID');
        const coursesBinding = resolveTableBinding(env, 'COURSES_TABLE_ID');
        const coreDataConfigured = Boolean(
          (membersBinding.appToken || membersBinding.wikiToken) && membersBinding.tableId &&
          (weeklyBinding.appToken || weeklyBinding.wikiToken) && weeklyBinding.tableId
        );
        const literatureConfigured = Boolean((literatureBinding.appToken || literatureBinding.wikiToken) && literatureBinding.tableId);
        const courseDataConfigured = Boolean((coursesBinding.appToken || coursesBinding.wikiToken) && coursesBinding.tableId);
        const courseAccessConfigured = Boolean(env.COURSE_REVIEWER_OPEN_ID && env.PROFESSOR_OPEN_ID);
        const courseConfigured = courseDataConfigured && courseAccessConfigured;
        return json(request, env, {
          ok: true,
          service: 'er2-lab-api',
          configured: authConfigured && coreDataConfigured && literatureConfigured && courseConfigured,
          authConfigured,
          dataConfigured: coreDataConfigured,
          literatureConfigured,
          courseConfigured,
          courseDataConfigured,
          courseAccessConfigured
        });
      }
      if (url.pathname === '/auth/launch') return await launchAuth(request, env);
      if (url.pathname === '/auth/callback') return await authCallback(request, env);

      let session = await requireSession(request, env);
      if (url.pathname.startsWith('/api/')) session = await requireActiveMember(env, session);
      if (request.method === 'POST' && url.pathname.startsWith('/api/')) enforceWriteRateLimit(session.sub);
      if (url.pathname === '/api/me' && request.method === 'GET') return json(request, env, { profile: session });
      if (url.pathname === '/api/dashboard' && request.method === 'GET') return await dashboard(request, env, session);
      if (url.pathname === '/api/reports' && request.method === 'POST') return await saveReport(request, env, session);
      if (url.pathname === '/api/literature' && request.method === 'GET') return await getLiterature(request, env, session);
      if (url.pathname === '/api/literature' && request.method === 'POST') return await saveLiterature(request, env, session);
      if (url.pathname === '/api/teacher/review' && request.method === 'POST') return await saveTeacherReview(request, env, session);
      if (url.pathname === '/api/courses/submit' && request.method === 'POST') return await saveCourseSubmission(request, env, session);
      if (url.pathname === '/api/courses/confirm' && request.method === 'POST') return await confirmCourseSubmission(request, env, session);
      if (url.pathname === '/api/onboarding' && request.method === 'POST') return await saveOnboarding(request, env, session);
      return json(request, env, { message: '接口不存在' }, 404);
    } catch (error) {
      const status = Number(error.status || 500);
      const message = status >= 500 ? '服务暂时不可用，请稍后重试' : error.message;
      if (status >= 500) console.error(error);
      return json(request, env, { message, requestId: requestIds.get(request) || '' }, status);
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
  // Registration is an explicit administrative operation, never an OAuth side effect.
  // Ignore retained bootstrap flags: display names are not authorization identities.
  const memberRecord = uniqueMemberRecord(members, openId);
  if (!memberRecord || !memberIsEnabled(memberRecord)) {
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
  const [memberRecords, reportRecords, projectRecords, courseRecords, taskRecords, linkRecords, literatureRecords] = await Promise.all([
    listRecords(env, tenantToken, 'MEMBERS_TABLE_ID'),
    listRecords(env, tenantToken, 'WEEKLY_TABLE_ID'),
    listRecords(env, tenantToken, 'PROJECTS_TABLE_ID'),
    listRecords(env, tenantToken, 'COURSES_TABLE_ID'),
    listRecords(env, tenantToken, 'TASKS_TABLE_ID'),
    listRecords(env, tenantToken, 'LINKS_TABLE_ID'),
    listRecords(env, tenantToken, 'LITERATURE_TABLE_ID')
  ]);
  const currentWeek = weekInfo(new Date());
  const members = memberRecords.map((record) => normalizeMember(record));
  const profile = {
    name: session.name,
    track: session.track || '',
    roles: session.roles
  };
  const student = buildStudent(session, currentWeek, reportRecords, projectRecords, courseRecords, taskRecords, linkRecords);
  const teacher = buildTeacher(session, currentWeek, members, reportRecords, courseRecords, env);
  const manager = session.roles.includes('manager')
    ? buildManager(members, projectRecords, courseRecords, env)
    : { stats: {}, automations: [] };
  const literature = buildLiterature(session, currentWeek, literatureRecords);
  const catalog = buildCatalog(session, linkRecords);
  return json(request, env, { profile, week: currentWeek, student, teacher, manager, literature, catalog });
}

function buildLiterature(session, week, records) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const items = records.map((record) => {
    const rawDate = field(record, '阅读日期') || '';
    const submittedAt = field(record, '提交时间') || '';
    return {
      id: record.record_id,
      title: field(record, '论文标题') || '未命名文献',
      submitter: field(record, '提交人姓名') || 'ER²成员',
      role: field(record, '提交人角色') || '成员',
      weekId: field(record, '周次') || '',
      date: formatRecordDate(rawDate || submittedAt),
      authors: field(record, '作者') || '',
      venue: field(record, '会议或期刊') || '',
      year: field(record, '发表年份') || '',
      doi: field(record, 'DOI或arXiv') || '',
      paperUrl: field(record, '论文链接') || '',
      direction: field(record, '研究方向') || '',
      type: field(record, '阅读类型') || '',
      contribution: field(record, '一句话贡献') || '',
      coreProblem: field(record, '核心问题') || '',
      method: field(record, '方法摘要') || '',
      review: field(record, '个人评价') || '',
      projectRelation: field(record, '与项目关系') || '',
      noteUrl: field(record, '阅读笔记链接') || '',
      attachmentUrl: field(record, '论文附件链接') || '',
      submittedAt,
      timestamp: parseRecordTime(submittedAt || rawDate)
    };
  }).filter((item) => item.timestamp >= cutoff)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30)
    .map(({ timestamp, ...item }) => item);
  const mineCount = records.filter((record) =>
    String(field(record, '提交人OpenID')) === String(session.sub) &&
    String(field(record, '周次')) === week.id
  ).length;
  return {
    weekId: week.id,
    mineCount,
    minimum: 3,
    completed: mineCount >= 3,
    items
  };
}

function parseRecordTime(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const text = clean(value);
  if (!text) return 0;
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRecordDate(value) {
  const timestamp = parseRecordTime(value);
  return timestamp ? shanghaiDate(new Date(timestamp)) : clean(value);
}

async function getLiterature(request, env, session) {
  const tenantToken = await getTenantToken(env);
  const records = await listRecords(env, tenantToken, 'LITERATURE_TABLE_ID');
  return json(request, env, { literature: buildLiterature(session, weekInfo(new Date()), records) });
}

async function saveLiterature(request, env, session) {
  const body = await readJson(request);
  const businessRequestId = requestBusinessId(request, body, 'literature');
  validateText(body.title, '论文标题', 1, 500);
  validateText(body.contribution, '一句话贡献', 1, 1200);
  validateText(body.authors, '作者', 0, 1000);
  validateText(body.venue, '会议或期刊', 0, 500);
  validateText(body.doi, 'DOI或arXiv', 0, 300);
  validateText(body.direction, '研究方向', 0, 300);
  validateText(body.type, '阅读类型', 0, 100);
  validateText(body.coreProblem, '核心问题', 0, 3000);
  validateText(body.method, '方法摘要', 0, 5000);
  validateText(body.review, '个人评价', 0, 3000);
  validateText(body.projectRelation, '与项目关系', 0, 3000);
  validateHttps(body.noteUrl, '阅读笔记链接', true);
  validateHttps(body.paperUrl, '论文链接', false);
  validateHttps(body.attachmentUrl, '论文附件链接', false);

  const currentWeek = weekInfo(new Date());
  if (body.weekId && body.weekId !== currentWeek.id) throw httpError(400, '只能提交当前周阅读记录');
  const year = body.year === '' || body.year == null ? '' : Number(body.year);
  if (year !== '' && (!Number.isInteger(year) || year < 1800 || year > 2200)) throw httpError(400, '发表年份不正确');
  const tenantToken = await getTenantToken(env);
  const existingRecords = await listRecords(env, tenantToken, 'LITERATURE_TABLE_ID');
  const duplicate = existingRecords.find((record) =>
    clean(field(record, '请求ID')) === businessRequestId || (
      String(field(record, '提交人OpenID')) === String(session.sub) &&
      String(field(record, '周次')) === currentWeek.id &&
      clean(field(record, '论文标题')).toLowerCase() === clean(body.title).toLowerCase() &&
      clean(field(record, '阅读笔记链接')) === clean(body.noteUrl)
    )
  );
  if (duplicate) {
    return json(request, env, {
      ok: true,
      deduplicated: true,
      recordId: duplicate.record_id,
      literature: buildLiterature(session, currentWeek, existingRecords)
    });
  }
  const fields = {
    '论文标题': clean(body.title),
    '请求ID': businessRequestId,
    '提交人OpenID': session.sub,
    '提交人姓名': session.name,
    '提交人角色': session.roles.map(roleLabel).join(' / '),
    '周次': currentWeek.id,
    '周序号': currentWeek.number,
    '阅读日期': clean(body.readDate) || shanghaiDate(new Date()),
    '作者': clean(body.authors),
    '会议或期刊': clean(body.venue),
    '发表年份': year,
    'DOI或arXiv': clean(body.doi),
    '论文链接': clean(body.paperUrl),
    '研究方向': clean(body.direction),
    '阅读类型': clean(body.type),
    '一句话贡献': clean(body.contribution),
    '核心问题': clean(body.coreProblem),
    '方法摘要': clean(body.method),
    '个人评价': clean(body.review),
    '与项目关系': clean(body.projectRelation),
    '阅读笔记链接': clean(body.noteUrl),
    '论文附件链接': clean(body.attachmentUrl),
    '提交状态': '已提交',
    '提交时间': new Date().toISOString()
  };
  if (year === '') delete fields['发表年份'];
  const created = await createRecord(env, tenantToken, 'LITERATURE_TABLE_ID', fields);
  const records = [created.data?.record || { record_id: created.data?.record?.record_id || '', fields }, ...existingRecords];
  return json(request, env, {
    ok: true,
    recordId: created.data?.record?.record_id || '',
    literature: buildLiterature(session, currentWeek, records)
  }, 201);
}

function roleLabel(role) {
  return ({ student: '学生', teacher: '教师', manager: '管理员' })[role] || '成员';
}

function shanghaiDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function reportValues(record) {
  return {
    progress: clean(field(record, '本周完成与结果')),
    learning: clean(field(record, '学习与方法')),
    evidence: clean(field(record, '证据链接')),
    blockers: clean(field(record, '问题与阻塞', '阻塞')),
    nextPlan: clean(field(record, '下周计划'))
  };
}

function normalizeReport(record) {
  return {
    recordId: record.record_id || '',
    weekId: clean(field(record, '周次', 'WeekID')),
    weekNumber: field(record, '周序号') || '',
    submittedAt: formatRecordDate(field(record, '提交时间')),
    status: clean(field(record, '审核状态')) || '已提交',
    feedback: clean(field(record, '教师反馈')),
    feedbackAt: formatRecordDate(field(record, '反馈时间')),
    values: reportValues(record)
  };
}

function courseLessonId(record) {
  const raw = clean(field(record, 'Lesson', '课程编号', '课程序号'));
  const match = raw.match(/(?:lesson\s*)?(\d{1,2})/i);
  if (!match) return '';
  const id = String(Number(match[1])).padStart(2, '0');
  return TRACK_A_LESSONS.some((lesson) => lesson.id === id) ? id : '';
}

function courseStatus(record) {
  const raw = clean(field(record, '状态', '完成状态', '确认状态'));
  if (['朱俊杰已确认', '已确认', '已完成', '完成'].includes(raw)) return 'confirmed';
  if (['需要补充', '需补充'].includes(raw)) return 'supplement';
  if (['等待朱俊杰确认', '已提交', '等待确认'].includes(raw)) return 'submitted';
  if (['学习中', '进行中'].includes(raw)) return 'learning';
  return 'pending';
}

function courseStatusLabel(status) {
  return ({
    confirmed: '朱俊杰已确认',
    supplement: '需要补充',
    submitted: '等待朱俊杰确认',
    learning: '学习中',
    pending: '未开始'
  })[status] || '未开始';
}

function normalizeCourseSubmission(record) {
  const id = courseLessonId(record);
  const lesson = TRACK_A_LESSONS.find((item) => item.id === id) || {};
  const status = courseStatus(record);
  return {
    recordId: record.record_id || '',
    lessonId: id,
    lessonTitle: lesson.title || clean(field(record, '课程名称')),
    prompt: lesson.prompt || '',
    status,
    statusLabel: courseStatusLabel(status),
    coreLearning: clean(field(record, '核心收获')),
    problems: clean(field(record, '问题与处理')),
    courseSummary: clean(field(record, '课程总结')),
    other: clean(field(record, '其他')),
    submittedAt: formatRecordDate(field(record, '提交时间')),
    confirmationComment: clean(field(record, '确认说明', '补充说明')),
    confirmedAt: formatRecordDate(field(record, '确认时间')),
    canEdit: status !== 'confirmed'
  };
}

function buildTrackAStudentCourse(session, records) {
  const mine = records.filter((record) =>
    String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(session.sub) && courseLessonId(record)
  );
  const byLesson = new Map(mine.map((record) => [courseLessonId(record), normalizeCourseSubmission(record)]));
  const lessons = TRACK_A_LESSONS.map((lesson) => byLesson.get(lesson.id) || {
    recordId: '',
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    prompt: lesson.prompt,
    status: 'pending',
    statusLabel: '未开始',
    coreLearning: '',
    problems: '',
    courseSummary: '',
    other: '',
    submittedAt: '',
    confirmationComment: '',
    confirmedAt: '',
    canEdit: true
  });
  const completed = lessons.filter((lesson) => lesson.status === 'confirmed').length;
  const submitted = lessons.filter((lesson) => ['submitted', 'supplement', 'confirmed'].includes(lesson.status)).length;
  const next = lessons.find((lesson) => lesson.status !== 'confirmed') || lessons[lessons.length - 1];
  return {
    id: TRACK_A_ID,
    title: TRACK_A_TITLE,
    enabled: true,
    completed,
    submitted,
    total: TRACK_A_LESSONS.length,
    progress: Math.round((completed / TRACK_A_LESSONS.length) * 100),
    next: 'Lesson ' + next.lessonId + ' · ' + next.lessonTitle,
    lessons,
    otherTracks: [
      { id: 'track-0', title: 'Track 0｜通用、安全与设备', status: '待规划' },
      { id: 'track-b', title: 'Track B｜操作与装配', status: '待建设' },
      { id: 'track-c', title: 'Track C｜规划与多智能体', status: '待建设' }
    ]
  };
}

function isCourseReviewer(session, env) {
  return Boolean(env.COURSE_REVIEWER_OPEN_ID) && String(session.sub) === String(env.COURSE_REVIEWER_OPEN_ID);
}

function isCourseProfessor(session, env) {
  return Boolean(env.PROFESSOR_OPEN_ID) && String(session.sub) === String(env.PROFESSOR_OPEN_ID);
}

function buildCourseReview(session, members, records, env) {
  const reviewer = isCourseReviewer(session, env);
  const professor = isCourseProfessor(session, env);
  if (!reviewer && !professor) return { visible: false, canConfirm: false, pending: 0, submissions: [] };
  const names = new Map(members.map((member) => [String(member.openId), member.name]));
  const submissions = records.filter((record) => courseLessonId(record)).map((record) => {
    const studentOpenId = String(field(record, '飞书OpenID', '人员OpenID', 'OpenID'));
    return {
      ...normalizeCourseSubmission(record),
      studentOpenId,
      studentName: clean(field(record, '姓名', '学生姓名')) || names.get(studentOpenId) || 'ER²学生'
    };
  }).sort((a, b) => {
    const priority = { submitted: 0, supplement: 1, confirmed: 2, pending: 3 };
    return (priority[a.status] - priority[b.status]) || a.studentName.localeCompare(b.studentName, 'zh-CN') || a.lessonId.localeCompare(b.lessonId);
  });
  return {
    visible: true,
    canConfirm: reviewer,
    viewerLabel: reviewer ? '朱俊杰确认页' : '陈铮一教授只读页',
    pending: submissions.filter((item) => item.status === 'submitted').length,
    submissions
  };
}

function buildCatalog(session, links) {
  const roleLabels = new Set(session.roles.flatMap((role) => [role, roleLabel(role)]));
  return links.filter((record) => {
    const enabled = field(record, '是否启用', '启用');
    if (enabled === false) return false;
    const audiences = arrayValue(field(record, '可见角色', '角色'));
    return !audiences.length || audiences.some((role) => roleLabels.has(String(role)));
  }).sort((a, b) => Number(field(a, '排序')) - Number(field(b, '排序')))
    .map((record) => ({
      title: clean(field(record, '标题', '名称')) || '飞书入口',
      subtitle: clean(field(record, '副标题', '说明')),
      category: clean(field(record, '分类', '类别')) || '入口',
      keywords: arrayValue(field(record, '关键词', '关键字')),
      url: clean(field(record, '链接', 'URL'))
    })).filter((item) => item.url);
}

function onboardingRecordFor(session, records) {
  return records.find((record) =>
    String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(session.sub) &&
    (clean(field(record, 'Lesson', '课程编号', '课程序号')).toUpperCase() === ONBOARDING_LESSON ||
      clean(field(record, 'Track')) === ONBOARDING_TRACK)
  );
}

function onboardingStepsFrom(record) {
  if (!record) return [];
  const raw = field(record, '其他', '入组完成项');
  let values = [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      values = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      values = raw.split(/[|,，、]/);
    }
  } else {
    values = arrayValue(raw);
  }
  return [...new Set(values.map(clean).filter((value) => ONBOARDING_STEPS.includes(value)))];
}

function buildOnboarding(session, records) {
  const completedSteps = onboardingStepsFrom(onboardingRecordFor(session, records));
  return {
    version: 1,
    completedSteps,
    completedCount: completedSteps.length,
    total: ONBOARDING_STEPS.length,
    completed: completedSteps.length === ONBOARDING_STEPS.length
  };
}

function buildStudent(session, week, reports, projects, courses, tasks, links) {
  const mine = (record) => String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(session.sub);
  const currentReport = reports.find((record) => mine(record) && String(field(record, '周次', 'WeekID')) === week.id);
  const project = session.projectCode
    ? projects.find((record) => String(field(record, '项目编号', '项目代码')) === String(session.projectCode)) || {}
    : {};
  const projectFields = project.fields || {};
  const trackACourse = buildTrackAStudentCourse(session, courses);
  const activeTasks = tasks.filter((record) => mine(record) && !['完成', '已完成'].includes(field(record, '状态'))).slice(0, 5);
  const roleLinks = links.filter((record) => {
    const audiences = arrayValue(field(record, '可见角色', '角色'));
    return !audiences.length || audiences.includes('student') || audiences.includes('学生');
  });
  const recentReports = reports
    .filter(mine)
    .sort((a, b) => parseRecordTime(field(b, '提交时间')) - parseRecordTime(field(a, '提交时间')))
    .slice(0, 12);
  const rawProgress = Number(field(project, '进度', '完成度')) || 0;
  const projectProgress = rawProgress > 0 && rawProgress <= 1 ? Math.round(rawProgress * 100) : Math.round(rawProgress);
  return {
    onboarding: buildOnboarding(session, courses),
    report: {
      status: currentReport ? 'submitted' : 'pending',
      label: currentReport ? '已提交' : '未提交',
      values: currentReport ? reportValues(currentReport) : {},
      submittedAt: currentReport ? formatRecordDate(field(currentReport, '提交时间')) : '',
      feedback: currentReport ? clean(field(currentReport, '教师反馈')) : ''
    },
    course: trackACourse,
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
    history: recentReports.map(normalizeReport)
  };
}

function buildTeacher(session, week, members, reports, courses, env) {
  const managed = members.filter((member) => session.roles.includes('manager') ||
    (session.roles.includes('teacher') && String(member.teacherOpenId) === String(session.sub)));
  const currentReports = reports.filter((record) => String(field(record, '周次', 'WeekID')) === week.id);
  const students = managed.filter((member) => member.roles.includes('student')).map((member) => {
    const memberReports = reports.filter((record) => String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(member.openId));
    const report = currentReports.find((record) => String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(member.openId));
    const blocker = report ? field(report, '问题与阻塞', '阻塞') : '';
    return {
      id: member.openId,
      name: member.name,
      project: member.projectCode || '暂未分配项目',
      track: member.track || '',
      status: report ? '已提交' : '未提交',
      blocker: blocker || (report ? '无' : '等待本周记录'),
      tone: report ? (blocker ? 'red' : 'green') : 'orange',
      currentReport: report ? normalizeReport(report) : null,
      history: memberReports
        .sort((a, b) => parseRecordTime(field(b, '提交时间')) - parseRecordTime(field(a, '提交时间')))
        .slice(0, 8).map(normalizeReport)
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
      .map((student) => student.name + '：' + student.blocker).slice(0, 5),
    courseReview: buildCourseReview(session, members, courses, env)
  };
}

function buildManager(members, projects, courses, env) {
  return {
    stats: {
      members: members.filter((member) => member.enabled !== false).length,
      projects: projects.filter((record) => !['归档', '已结束'].includes(field(record, '状态'))).length,
      courses: 1
    },
    automations: [
      { name: '未交周报提醒', trigger: '周五 11:00', target: '未交学生', status: env.PROFESSOR_OPEN_ID ? '已配置' : '待配置' },
      { name: '提交状态更新', trigger: '学生提交后', target: '周报记录', status: '页面已支持' },
      { name: '教授周报摘要', trigger: '周五 18:00', target: '教授', status: env.PROFESSOR_OPEN_ID ? '已配置' : '待配置' }
    ]
  };
}

async function saveOnboarding(request, env, session) {
  if (!session.roles.includes('student')) throw httpError(403, '只有学生账号可以更新本人的入组进度');
  const body = await readJson(request);
  if (!Array.isArray(body.completedSteps)) throw httpError(400, '入组完成项格式无效');
  const completedSteps = [...new Set(body.completedSteps.map(clean))];
  if (completedSteps.some((value) => !ONBOARDING_STEPS.includes(value))) throw httpError(400, '包含未知的入组完成项');

  const tenantToken = await getTenantToken(env);
  const records = await listRecords(env, tenantToken, 'COURSES_TABLE_ID');
  const existing = onboardingRecordFor(session, records);
  const completed = completedSteps.length === ONBOARDING_STEPS.length;
  const fields = {
    '请求ID': requestBusinessId(request, body, 'onboarding'),
    '飞书OpenID': session.sub,
    '姓名': session.name,
    'Track': ONBOARDING_TRACK,
    '课程名称': '新生入组准备',
    'Lesson': ONBOARDING_LESSON,
    '其他': JSON.stringify(completedSteps),
    '状态': completed ? '已完成' : '进行中',
    '提交时间': new Date().toISOString()
  };
  if (existing) await updateRecord(env, tenantToken, 'COURSES_TABLE_ID', existing.record_id, fields);
  else await createRecord(env, tenantToken, 'COURSES_TABLE_ID', fields);
  return json(request, env, {
    ok: true,
    onboarding: {
      version: 1,
      completedSteps,
      completedCount: completedSteps.length,
      total: ONBOARDING_STEPS.length,
      completed
    }
  });
}

async function saveCourseSubmission(request, env, session) {
  if (!session.roles.includes('student')) throw httpError(403, '只有学生账号可以提交本人的课程记录');
  const body = await readJson(request);
  const lessonId = String(Number(clean(body.lessonId))).padStart(2, '0');
  const lesson = TRACK_A_LESSONS.find((item) => item.id === lessonId);
  if (!lesson) throw httpError(400, '课程编号无效');
  validateText(body.coreLearning, '核心收获', 1, 3000);
  validateText(body.problems, '问题与处理', 1, 3000);
  validateText(body.other, '其他', 0, 3000);
  if (lessonId === '10') validateText(body.courseSummary, '课程总结', 1, 3000);
  else if (clean(body.courseSummary)) throw httpError(400, '只有Lesson 10需要填写课程总结');

  const businessRequestId = requestBusinessId(request, body, 'course-' + lessonId);
  const tenantToken = await getTenantToken(env);
  const records = await listRecords(env, tenantToken, 'COURSES_TABLE_ID');
  const existing = records.find((record) =>
    String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(session.sub) && courseLessonId(record) === lessonId
  );
  if (existing && clean(field(existing, '请求ID')) === businessRequestId) {
    return json(request, env, { ok: true, updated: true, deduplicated: true });
  }
  if (existing && courseStatus(existing) === 'confirmed') throw httpError(409, '本课已经由朱俊杰确认，如需修改请先联系管理员');

  const fields = {
    '请求ID': businessRequestId,
    '飞书OpenID': session.sub,
    '姓名': session.name,
    'Track': TRACK_A_TITLE,
    '课程名称': 'Lesson ' + lesson.id + '｜' + lesson.title,
    'Lesson': lesson.id,
    '核心收获': clean(body.coreLearning),
    '问题与处理': clean(body.problems),
    '课程总结': lessonId === '10' ? clean(body.courseSummary) : '',
    '其他': clean(body.other),
    '状态': '等待朱俊杰确认',
    '提交时间': new Date().toISOString()
  };
  if (existing) await updateRecord(env, tenantToken, 'COURSES_TABLE_ID', existing.record_id, fields);
  else await createRecord(env, tenantToken, 'COURSES_TABLE_ID', fields);
  return json(request, env, { ok: true, updated: Boolean(existing) });
}

async function confirmCourseSubmission(request, env, session) {
  if (!isCourseReviewer(session, env)) throw httpError(403, '只有管理员朱俊杰可以确认课程记录');
  const body = await readJson(request);
  validateText(body.recordId, '记录ID', 1, 100);
  if (!['confirm', 'supplement'].includes(body.action)) throw httpError(400, '确认操作无效');
  validateText(body.comment, '确认说明', body.action === 'supplement' ? 1 : 0, 3000);

  const tenantToken = await getTenantToken(env);
  const initialRecords = await listRecords(env, tenantToken, 'COURSES_TABLE_ID');
  const initialTarget = initialRecords.find((record) => record.record_id === body.recordId && courseLessonId(record));
  if (!initialTarget) throw httpError(404, '课程提交记录不存在');
  const studentOpenId = String(field(initialTarget, '飞书OpenID', '人员OpenID', 'OpenID'));
  if (!studentOpenId) throw httpError(409, '课程记录缺少学生身份，无法确认');

  return withCourseConfirmationLock(studentOpenId, async () => {
    const records = await listRecords(env, tenantToken, 'COURSES_TABLE_ID');
    const target = records.find((record) => record.record_id === body.recordId && courseLessonId(record));
    if (!target) throw httpError(404, '课程提交记录不存在');
    const currentStatus = courseStatus(target);
    if (currentStatus === 'confirmed') {
      if (body.action === 'supplement') throw httpError(409, '本课已经确认；如需退回，请先由管理员在飞书后台解除确认');
      const completion = completionState(records, target);
      return json(request, env, { ok: true, status: '朱俊杰已确认', completion, deduplicated: true });
    }

    const status = body.action === 'confirm' ? '朱俊杰已确认' : '需要补充';
    const confirmedAt = new Date().toISOString();
    await updateRecord(env, tenantToken, 'COURSES_TABLE_ID', target.record_id, {
      '状态': status,
      '确认说明': clean(body.comment),
      '确认人': session.name,
      '确认人OpenID': session.sub,
      '确认时间': confirmedAt
    });

    let completion = { completed: false, notified: false };
    if (body.action === 'confirm') {
      target.fields = { ...(target.fields || {}), '状态': status, '确认时间': confirmedAt };
      completion = await completeTrackAIfReady(env, tenantToken, records, target);
    }
    return json(request, env, { ok: true, status, completion });
  });
}

async function withCourseConfirmationLock(studentOpenId, task) {
  const key = String(studentOpenId);
  const previous = courseConfirmationLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  courseConfirmationLocks.set(key, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (courseConfirmationLocks.get(key) === tail) courseConfirmationLocks.delete(key);
  }
}

function completionState(records, target) {
  const studentOpenId = String(field(target, '飞书OpenID', '人员OpenID', 'OpenID'));
  const studentRecords = records.filter((record) =>
    String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === studentOpenId && courseLessonId(record)
  );
  const confirmedIds = new Set(studentRecords.filter((record) => courseStatus(record) === 'confirmed').map(courseLessonId));
  const completed = TRACK_A_LESSONS.every((lesson) => confirmedIds.has(lesson.id));
  const finalRecord = studentRecords.find((record) => courseLessonId(record) === '10');
  const notificationStatus = clean(field(finalRecord, '结业通知状态'));
  return {
    completed,
    notified: notificationStatus === '已发送',
    notificationStatus
  };
}

async function completeTrackAIfReady(env, tenantToken, records, target) {
  const studentOpenId = String(field(target, '飞书OpenID', '人员OpenID', 'OpenID'));
  const studentName = clean(field(target, '姓名', '学生姓名')) || 'ER²学生';
  const studentRecords = records.filter((record) =>
    String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === studentOpenId && courseLessonId(record)
  );
  const confirmedIds = new Set(studentRecords.filter((record) => courseStatus(record) === 'confirmed').map(courseLessonId));
  if (!TRACK_A_LESSONS.every((lesson) => confirmedIds.has(lesson.id))) return { completed: false, notified: false };

  const finalRecord = studentRecords.find((record) => courseLessonId(record) === '10');
  if (!finalRecord) return { completed: false, notified: false };
  const notificationStatus = clean(field(finalRecord, '结业通知状态'));
  if (['已发送', '发送中', '发送失败'].includes(notificationStatus)) {
    return { completed: true, notified: notificationStatus === '已发送', notificationStatus };
  }

  const completedAt = new Date().toISOString();
  const notificationAttemptId = await stableMessageUuid('track-a-completion:' + studentOpenId);
  await updateRecord(env, tenantToken, 'COURSES_TABLE_ID', finalRecord.record_id, {
    '结业状态': '已完成',
    '课程完成时间': completedAt,
    '结业通知状态': env.PROFESSOR_OPEN_ID ? '发送中' : '待配置',
    '结业通知尝试ID': notificationAttemptId
  });
  if (!env.PROFESSOR_OPEN_ID) return { completed: true, notified: false, warning: '教授接收账号尚未配置' };

  const latestRecords = await listRecords(env, tenantToken, 'COURSES_TABLE_ID');
  const latestFinalRecord = latestRecords.find((record) => record.record_id === finalRecord.record_id);
  if (clean(field(latestFinalRecord, '结业通知尝试ID')) !== notificationAttemptId || clean(field(latestFinalRecord, '结业通知状态')) !== '发送中') {
    return { completed: true, notified: clean(field(latestFinalRecord, '结业通知状态')) === '已发送', notificationStatus: clean(field(latestFinalRecord, '结业通知状态')) };
  }

  const message = [
    '【ER² Lab 培训完成通知】',
    studentName + '同学已完成“感知与语义导航”课程培训。',
    'Lesson 01–10 均已完成并由朱俊杰确认。',
    '完成日期：' + formatRecordDate(completedAt)
  ].join('\n');
  try {
    const result = await sendText(env, tenantToken, env.PROFESSOR_OPEN_ID, message, notificationAttemptId);
    await updateRecord(env, tenantToken, 'COURSES_TABLE_ID', finalRecord.record_id, {
      '结业通知状态': '已发送',
      '结业通知时间': new Date().toISOString(),
      '结业通知消息ID': clean(result?.data?.message_id || result?.message_id)
    });
    return { completed: true, notified: true };
  } catch (error) {
    await updateRecord(env, tenantToken, 'COURSES_TABLE_ID', finalRecord.record_id, {
      '结业通知状态': '发送失败'
    });
    throw error;
  }
}

async function saveReport(request, env, session) {
  if (!session.roles.includes('student')) throw httpError(403, '只有学生账号可以提交本人周报');
  const body = await readJson(request);
  const businessRequestId = requestBusinessId(request, body, 'weekly');
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
    '请求ID': businessRequestId,
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
  const body = await readJson(request);
  const businessRequestId = requestBusinessId(request, body, 'review');
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
  if (clean(field(targetReport, '反馈请求ID')) === businessRequestId) {
    return json(request, env, { ok: true, deduplicated: true });
  }
  await updateRecord(env, tenantToken, 'WEEKLY_TABLE_ID', body.recordId, {
    '教师反馈': clean(body.comment),
    '反馈请求ID': businessRequestId,
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
  const [memberRecords, reports, literatureRecords] = await Promise.all([
    listRecords(env, tenantToken, 'MEMBERS_TABLE_ID'),
    listRecords(env, tenantToken, 'WEEKLY_TABLE_ID'),
    listRecords(env, tenantToken, 'LITERATURE_TABLE_ID')
  ]);
  const members = memberRecords.map((record) => normalizeMember(record)).filter((member) => member.enabled && member.roles.includes('student'));
  const week = weekInfo(new Date(scheduledTime));
  const currentReports = reports.filter((record) => String(field(record, '周次', 'WeekID')) === week.id);
  const currentLiterature = literatureRecords.filter((record) => String(field(record, '周次')) === week.id);

  if (localHour === 11) {
    const runKey = week.id + '-weekly-reminder';
    if (await automationAlreadyRan(env, tenantToken, runKey)) return;
    const missing = members.filter((member) => !currentReports.some((record) => String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(member.openId)));
    const results = await Promise.allSettled(missing.map((member) => sendText(env, tenantToken, member.openId,
      'ER² Lab提醒：你本周的工作记录尚未提交，请在今天18:00前进入工作台完成。')));
    const failed = results.filter((result) => result.status === 'rejected').length;
    await writeAutomationLog(env, tenantToken, runKey, '未交周报提醒', failed ? '部分失败' : '成功', missing.length + '人，失败' + failed + '人');
  }

  if (localHour === 18 && env.PROFESSOR_OPEN_ID) {
    const runKey = week.id + '-professor-summary';
    if (await automationAlreadyRan(env, tenantToken, runKey)) return;
    const submitted = currentReports.length;
    const missingNames = members.filter((member) => !currentReports.some((record) => String(field(record, '飞书OpenID', '人员OpenID', 'OpenID')) === String(member.openId))).map((member) => member.name);
    const blockers = currentReports.map((record) => field(record, '问题与阻塞', '阻塞')).filter(Boolean);
    const literatureContributors = new Set(currentLiterature.map((record) => field(record, '提交人OpenID')).filter(Boolean)).size;
    const summary = [
      'ER² Lab ' + week.label + ' 周报汇总',
      '已提交：' + submitted + '/' + members.length,
      '未提交：' + (missingNames.join('、') || '无'),
      '文献阅读：' + currentLiterature.length + '篇 / ' + literatureContributors + '人',
      '主要阻塞：' + (blockers.slice(0, 5).join('；') || '无')
    ].join('\n');
    try {
      await sendText(env, tenantToken, env.PROFESSOR_OPEN_ID, summary);
      await writeAutomationLog(env, tenantToken, runKey, '教授周报摘要', '成功', submitted + '/' + members.length);
    } catch (error) {
      await writeAutomationLog(env, tenantToken, runKey, '教授周报摘要', '失败', error.message || '发送失败');
      throw error;
    }
  }
}

async function getTenantToken(env) {
  requireConfig(env, ['FEISHU_APP_ID', 'FEISHU_APP_SECRET']);
  if (tenantTokenCache.token && tenantTokenCache.expiresAt > Date.now() + 60_000) return tenantTokenCache.token;
  const result = await feishuRequest('/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    body: { app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET },
    rawAuth: true,
    retryPost: true
  });
  const token = result.tenant_access_token || result.data?.tenant_access_token;
  if (!token) throw httpError(502, '未能取得飞书应用令牌');
  const expiresIn = Number(result.expire || result.data?.expire || 7200);
  tenantTokenCache = { token, expiresAt: Date.now() + Math.max(300, expiresIn) * 1000 };
  return token;
}

function resolveTableBinding(env, tableBinding) {
  const tokenBinding = String(tableBinding).replace(/_TABLE_ID$/, '_BASE_APP_TOKEN');
  const wikiBinding = String(tableBinding).replace(/_TABLE_ID$/, '_BASE_WIKI_TOKEN');
  return {
    appToken: env[tokenBinding] || env.FEISHU_BASE_APP_TOKEN || '',
    wikiToken: env[wikiBinding] || env.FEISHU_BASE_WIKI_TOKEN || '',
    tableId: env[tableBinding] || (tableBinding === 'LITERATURE_TABLE_ID' ? LITERATURE_TABLE_FALLBACK : '')
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

async function sendText(env, token, openId, text, uuid = '') {
  if (!openId) return;
  return feishuRequest('/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    bearer: token,
    body: {
      receive_id: openId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
      ...(uuid ? { uuid } : {})
    }
  });
}

async function stableMessageUuid(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function automationAlreadyRan(env, token, runKey) {
  const binding = resolveTableBinding(env, 'AUTOMATION_LOGS_TABLE_ID');
  if ((!binding.appToken && !binding.wikiToken) || !binding.tableId) return false;
  const records = await listRecords(env, token, 'AUTOMATION_LOGS_TABLE_ID');
  return records.some((record) => clean(field(record, '运行键')) === runKey && clean(field(record, '执行结果')) === '成功');
}

async function writeAutomationLog(env, token, runKey, name, result, detail) {
  if (!env.AUTOMATION_LOGS_TABLE_ID) return;
  await createRecord(env, token, 'AUTOMATION_LOGS_TABLE_ID', {
    '运行键': runKey,
    '任务名称': name,
    '执行时间': new Date().toISOString(),
    '执行结果': result,
    '执行说明': detail
  });
}

async function feishuRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (options.bearer) headers.Authorization = 'Bearer ' + options.bearer;
  const method = options.method || 'GET';
  const maxAttempts = ['GET', 'PUT'].includes(method) || options.retryPost === true ? 3 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(FEISHU_API + path, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(10_000)
      });
    } catch (error) {
      if (attempt + 1 < maxAttempts) {
        await delay(250 * (attempt + 1));
        continue;
      }
      console.error('Feishu API network error', path, error?.name || 'Error');
      throw httpError(502, '飞书数据接口暂时无响应');
    }
    const result = await response.json().catch(() => ({}));
    if (response.ok && (typeof result.code !== 'number' || result.code === 0)) return result;
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt + 1 < maxAttempts) {
      await delay(250 * (attempt + 1));
      continue;
    }
    console.error('Feishu API error', path, response.status, result.code, result.msg);
    throw httpError(502, response.status === 429 ? '飞书接口请求较多，请稍后重试' : '飞书数据接口返回异常');
  }
  throw httpError(502, '飞书数据接口返回异常');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function uniqueMemberRecord(records, openId) {
  const matches = records.filter((record) => String(field(record, '飞书OpenID', 'OpenID', 'open_id')) === String(openId));
  if (matches.length > 1) throw httpError(403, '人员表存在重复账号，请联系管理员核对');
  return matches[0];
}

function memberIsEnabled(record) {
  // Legacy tables do not have 人员状态. If present, it is an additional deny gate.
  const fields = record?.fields || {};
  const statusAllowed = !Object.hasOwn(fields, '人员状态') || field(record, '人员状态') === '在组';
  return statusAllowed && field(record, '是否启用', '启用') !== false;
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
    enabled: memberIsEnabled(record)
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

async function requireActiveMember(env, session) {
  const tenantToken = await getTenantToken(env);
  const records = await listRecords(env, tenantToken, 'MEMBERS_TABLE_ID');
  const record = uniqueMemberRecord(records, session.sub);
  if (!record) throw httpError(403, '你的账号已不在ER² Lab人员表中');
  const member = normalizeMember(record);
  if (!member.enabled) throw httpError(403, '你的ER² Lab账号已被停用');
  return {
    ...session,
    name: member.name,
    roles: member.roles,
    teacherOpenId: member.teacherOpenId,
    projectCode: member.projectCode,
    track: member.track
  };
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
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-ID',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Expose-Headers': 'X-Request-ID',
      'X-Request-ID': requestIds.get(request) || '',
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

async function readJson(request, maxBytes = 64 * 1024) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) throw httpError(415, '请求格式必须为JSON');
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > maxBytes) throw httpError(413, '提交内容过大，请将大文件上传飞书后填写链接');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw httpError(413, '提交内容过大，请将大文件上传飞书后填写链接');
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('invalid');
    return value;
  } catch (_) {
    throw httpError(400, '提交内容不是有效JSON');
  }
}

function requestBusinessId(request, body, prefix) {
  const provided = clean(body?.requestId || request.headers.get('X-Request-ID'));
  if (provided && provided.length <= 100) return provided;
  return prefix + '-' + (requestIds.get(request) || crypto.randomUUID());
}

function enforceWriteRateLimit(identity, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const key = String(identity || 'anonymous');
  const current = writeRateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    writeRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw httpError(429, '提交过于频繁，请稍后再试');
  if (writeRateBuckets.size > 1000) {
    for (const [bucketKey, bucket] of writeRateBuckets) {
      if (bucket.resetAt <= now) writeRateBuckets.delete(bucketKey);
    }
  }
}

function validateText(value, label, min, max) {
  const length = String(value || '').trim().length;
  if (length < min) throw httpError(400, '请填写' + label);
  if (length > max) throw httpError(400, label + '不能超过' + max + '字');
}

function validateHttps(value, label, required) {
  const text = clean(value);
  if (!text && required) throw httpError(400, '请填写' + label);
  if (text && !/^https:\/\//i.test(text)) throw httpError(400, label + '必须使用HTTPS地址');
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
