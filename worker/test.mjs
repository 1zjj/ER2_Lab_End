import assert from 'node:assert/strict';
import service from './src/index.js';

const env = {
  FRONTEND_URL: 'https://1zjj.github.io/ER2_Lab_End/'
};

const health = await service.fetch(new Request('https://api.example/health'), env);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), {
  ok: true,
  service: 'er2-lab-api',
  configured: false,
  authConfigured: false,
  dataConfigured: false,
  literatureConfigured: false,
  courseConfigured: false,
  courseDataConfigured: false,
  courseAccessConfigured: false
});

const authOnlyHealth = await service.fetch(new Request('https://api.example/health'), {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: '01234567890123456789012345678901'
});
assert.deepEqual(await authOnlyHealth.json(), {
  ok: true,
  service: 'er2-lab-api',
  configured: false,
  authConfigured: true,
  dataConfigured: false,
  literatureConfigured: false,
  courseConfigured: false,
  courseDataConfigured: false,
  courseAccessConfigured: false
});

const multiBaseHealth = await service.fetch(new Request('https://api.example/health'), {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: '01234567890123456789012345678901',
  MEMBERS_BASE_APP_TOKEN: 'bas_members',
  MEMBERS_TABLE_ID: 'tbl_members',
  WEEKLY_BASE_APP_TOKEN: 'bas_weekly',
  WEEKLY_TABLE_ID: 'tbl_weekly',
  LITERATURE_BASE_APP_TOKEN: 'bas_literature',
  LITERATURE_TABLE_ID: 'tbl_literature',
  COURSES_BASE_APP_TOKEN: 'bas_courses',
  COURSES_TABLE_ID: 'tbl_courses',
  COURSE_REVIEWER_OPEN_ID: 'ou_junjie',
  PROFESSOR_OPEN_ID: 'ou_professor'
});
assert.equal((await multiBaseHealth.json()).configured, true);

const wikiBaseHealth = await service.fetch(new Request('https://api.example/health'), {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: '01234567890123456789012345678901',
  FEISHU_BASE_WIKI_TOKEN: 'wik_test',
  MEMBERS_TABLE_ID: 'tbl_members',
  WEEKLY_TABLE_ID: 'tbl_weekly',
  LITERATURE_TABLE_ID: 'tbl_literature',
  COURSES_TABLE_ID: 'tbl_courses',
  COURSE_REVIEWER_OPEN_ID: 'ou_junjie',
  PROFESSOR_OPEN_ID: 'ou_professor'
});
assert.equal((await wikiBaseHealth.json()).configured, true);

const preflight = await service.fetch(new Request('https://api.example/api/dashboard', {
  method: 'OPTIONS',
  headers: { Origin: 'https://1zjj.github.io' }
}), env);
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://1zjj.github.io');

const unauthorized = await service.fetch(new Request('https://api.example/api/dashboard'), env);
assert.equal(unauthorized.status, 401);

const invalidCallback = await service.fetch(new Request('https://api.example/auth/callback'), env);
assert.equal(invalidCallback.status, 400);
const invalidCallbackBody = await invalidCallback.json();
assert.equal(invalidCallbackBody.message, '飞书授权参数不完整');
assert.ok(invalidCallbackBody.requestId);

const secret = '01234567890123456789012345678901';
const encoded = Buffer.from(JSON.stringify({
  purpose: 'session',
  sub: 'ou_teacher',
  name: '测试教师',
  roles: ['teacher'],
  exp: Math.floor(Date.now() / 1000) + 3600
})).toString('base64url');
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
async function makeSession(sub, name, roles) {
  const payload = Buffer.from(JSON.stringify({
    purpose: 'session', sub, name, roles, exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url');
  const signed = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return payload + '.' + signed;
}
const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded))).toString('base64url');
const session = encoded + '.' + signature;
const studentSession = await makeSession('ou_student', '测试学生', ['student']);
const otherStudentSession = await makeSession('ou_other_student', '其他学生', ['student']);
const reviewerSession = await makeSession('ou_junjie', '朱俊杰', ['student', 'teacher', 'manager']);
const professorSession = await makeSession('ou_professor', '陈铮一', ['teacher']);
const originalFetch = globalThis.fetch;
let postedLiterature = null;
let postedMember = null;
let postedReview = null;
let postedCourse = null;
let memberEnabled = true;
let memberStatusFields = {};
let extraMembers = [];
let projectItems = [];
let weeklyItems = [];
const courseItems = [];
const sentMessages = [];
let oauthUser = { open_id: 'ou_unknown', name: '陌生用户' };
const literatureItems = [
  { record_id: 'rec_recent', fields: { '论文标题': '近7天论文', '提交人OpenID': 'ou_teacher', '提交人姓名': '测试教师', '周次': 'recent', '阅读日期': Date.now() - 2 * 86400000, '提交时间': new Date(Date.now() - 2 * 86400000).toISOString() } },
  { record_id: 'rec_old', fields: { '论文标题': '历史论文', '提交人OpenID': 'ou_teacher', '提交人姓名': '测试教师', '周次': 'old', '提交时间': new Date(Date.now() - 10 * 86400000).toISOString() } }
];
globalThis.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/auth/v3/tenant_access_token/internal')) {
    return Response.json({ code: 0, tenant_access_token: 'tenant-token' });
  }
  if (String(url).endsWith('/authen/v2/oauth/token')) {
    return Response.json({ code: 0, access_token: 'user-token' });
  }
  if (String(url).endsWith('/authen/v1/user_info')) {
    return Response.json({ code: 0, data: oauthUser });
  }
  if (String(url).includes('/tables/tbl_members/records') && options.method === 'POST') {
    postedMember = JSON.parse(options.body).fields;
    return Response.json({ code: 0, data: { record: { record_id: 'rec_new_member', fields: postedMember } } });
  }
  if (String(url).includes('/tables/tbl_literature/records') && options.method === 'POST') {
    postedLiterature = JSON.parse(options.body).fields;
    literatureItems.unshift({ record_id: 'rec_new', fields: postedLiterature });
    return Response.json({ code: 0, data: { record: { record_id: 'rec_new', fields: postedLiterature } } });
  }
  if (String(url).includes('/tables/tbl_courses/records') && options.method === 'POST') {
    postedCourse = JSON.parse(options.body).fields;
    const record = { record_id: 'rec_course_' + (courseItems.length + 1), fields: postedCourse };
    courseItems.push(record);
    return Response.json({ code: 0, data: { record } });
  }
  if (String(url).includes('/tables/tbl_courses/records/') && options.method === 'PUT') {
    const recordId = String(url).split('/records/')[1];
    const fields = JSON.parse(options.body).fields;
    const record = courseItems.find((item) => item.record_id === recordId);
    if (record) record.fields = { ...record.fields, ...fields };
    return Response.json({ code: 0, data: { record: record || { record_id: recordId, fields } } });
  }
  if (String(url).includes('/tables/tbl_weekly/records/rec_student_report') && options.method === 'PUT') {
    postedReview = JSON.parse(options.body).fields;
    return Response.json({ code: 0, data: { record: { record_id: 'rec_student_report', fields: postedReview } } });
  }
  if (String(url).includes('/tables/tbl_members/records')) {
    return Response.json({ code: 0, data: { items: [
      { record_id: 'rec_member', fields: {
        '姓名': '测试教师', '飞书OpenID': 'ou_teacher', '角色': ['教师'], '是否启用': memberEnabled, ...memberStatusFields
      } },
      { record_id: 'rec_student', fields: {
        '姓名': '测试学生', '飞书OpenID': 'ou_student', '角色': ['学生'], '负责教师OpenID': 'ou_teacher', '项目编号': 'P03', '课程方向': '语义导航', '是否启用': true
      } },
      { record_id: 'rec_other_student', fields: {
        '姓名': '其他学生', '飞书OpenID': 'ou_other_student', '角色': ['学生'], '负责教师OpenID': 'ou_teacher', '项目编号': 'P04', '课程方向': '语义导航', '是否启用': true
      } },
      { record_id: 'rec_junjie', fields: {
        '姓名': '朱俊杰', '飞书OpenID': 'ou_junjie', '角色': ['学生', '教师', '管理者'], '是否启用': true
      } },
      { record_id: 'rec_professor', fields: {
        '姓名': '陈铮一', '飞书OpenID': 'ou_professor', '角色': ['教师'], '是否启用': true
      } }, ...extraMembers
    ] } });
  }
  if (String(url).includes('/tables/tbl_links/records')) {
    return Response.json({ code: 0, data: { items: [{ record_id: 'rec_link', fields: {
      '标题': 'ER²知识库', '副标题': '统一资料入口', '分类': '知识库', '关键词': ['SOP', '培训'], '链接': 'https://example.feishu.cn/wiki/test', '可见角色': ['教师'], '是否启用': true, '排序': 1
    } }] } });
  }
  if (String(url).includes('/tables/tbl_literature/records')) {
    return Response.json({ code: 0, data: { items: literatureItems } });
  }
  if (String(url).includes('/tables/tbl_weekly/records')) {
    return Response.json({ code: 0, data: { items: weeklyItems } });
  }
  if (String(url).includes('/tables/tbl_courses/records')) {
    return Response.json({ code: 0, data: { items: courseItems } });
  }
  if (String(url).includes('/im/v1/messages')) {
    const body = JSON.parse(options.body);
    sentMessages.push(body);
    return Response.json({ code: 0, data: { message_id: 'om_test_completion' } });
  }
  if (String(url).includes('/tables/tbl_projects/records')) return Response.json({ code: 0, data: { items: projectItems } });
  if (String(url).includes('/records')) return Response.json({ code: 0, data: { items: [] } });
  throw new Error('unexpected fetch ' + url);
};
const literatureEnv = {
  ...env,
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: secret,
  MEMBERS_BASE_APP_TOKEN: 'bas_members',
  MEMBERS_TABLE_ID: 'tbl_members',
  WEEKLY_BASE_APP_TOKEN: 'bas_weekly',
  WEEKLY_TABLE_ID: 'tbl_weekly',
  LITERATURE_BASE_APP_TOKEN: 'bas_literature',
  LITERATURE_TABLE_ID: 'tbl_literature',
  LINKS_BASE_APP_TOKEN: 'bas_links',
  LINKS_TABLE_ID: 'tbl_links',
  COURSES_BASE_APP_TOKEN: 'bas_courses',
  COURSES_TABLE_ID: 'tbl_courses',
  COURSE_REVIEWER_OPEN_ID: 'ou_junjie',
  PROFESSOR_OPEN_ID: 'ou_professor'
};
const oauthStatePayload = Buffer.from(JSON.stringify({
  purpose: 'oauth',
  returnTo: env.FRONTEND_URL,
  exp: Math.floor(Date.now() / 1000) + 600
})).toString('base64url');
const oauthStateSignature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(oauthStatePayload))).toString('base64url');
const oauthState = oauthStatePayload + '.' + oauthStateSignature;
const pilotEnv = {
  ...literatureEnv,
  FEISHU_REDIRECT_URI: 'https://api.example/auth/callback',
  PILOT_AUTO_PROVISION: 'true',
  PILOT_ALLOWED_NAMES: '朱俊杰,郑斯哲',
  BOOTSTRAP_FIRST_USER: 'true',
  BOOTSTRAP_ADMIN_NAME: '朱俊杰'
};
const blockedPilot = await service.fetch(new Request('https://api.example/auth/callback?code=test&state=' + encodeURIComponent(oauthState)), pilotEnv);
assert.equal(blockedPilot.status, 403);
assert.equal(postedMember, null);
oauthUser = { open_id: 'ou_zheng', name: '郑斯哲' };
const allowedPilot = await service.fetch(new Request('https://api.example/auth/callback?code=test&state=' + encodeURIComponent(oauthState)), pilotEnv);
assert.equal(allowedPilot.status, 403);
assert.equal(postedMember, null);
oauthUser = { open_id: 'ou_unregistered_admin_name', name: '朱俊杰' };
assert.equal((await service.fetch(new Request('https://api.example/auth/callback?code=test&state=' + encodeURIComponent(oauthState)), pilotEnv)).status, 403);
assert.equal(postedMember, null, 'matching administrator name must never create an account');
oauthUser = { open_id: 'ou_junjie', name: '已改名' };
assert.equal((await service.fetch(new Request('https://api.example/auth/callback?code=test&state=' + encodeURIComponent(oauthState)), pilotEnv)).status, 302, 'registered identity can log in independently of display name');

const literatureGet = await service.fetch(new Request('https://api.example/api/literature', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv);
assert.equal(literatureGet.status, 200);
const literatureGetBody = await literatureGet.json();
assert.equal(literatureGetBody.literature.minimum, 3);
assert.deepEqual(literatureGetBody.literature.items.map((item) => item.title), ['近7天论文']);
assert.match(literatureGetBody.literature.items[0].date, /^\d{4}-\d{2}-\d{2}$/);

const initialDashboard = await service.fetch(new Request('https://api.example/api/dashboard', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv);
const initialDashboardBody = await initialDashboard.json();
weeklyItems = [{ record_id: 'rec_report', fields: {
  '飞书OpenID': 'ou_teacher',
  '周次': initialDashboardBody.week.id,
  '本周完成与结果': '完成测试',
  '学习与方法': '回归测试',
  '证据链接': 'https://example.com/evidence',
  '问题与阻塞': '暂无',
  '下周计划': '继续验证'
} }, { record_id: 'rec_student_report', fields: {
  '飞书OpenID': 'ou_student',
  '周次': initialDashboardBody.week.id,
  '本周完成与结果': '完成学生实验',
  '学习与方法': '复盘导航算法',
  '证据链接': 'https://example.com/student-evidence',
  '问题与阻塞': '参数待验证',
  '下周计划': '补充对照实验',
  '提交时间': new Date().toISOString()
} }];
const submittedDashboard = await service.fetch(new Request('https://api.example/api/dashboard', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv);
assert.equal(submittedDashboard.status, 200);
const submittedDashboardBody = await submittedDashboard.json();
assert.equal(submittedDashboardBody.student.report.status, 'submitted');
assert.deepEqual(submittedDashboardBody.student.report.values, {
  progress: '完成测试',
  learning: '回归测试',
  evidence: 'https://example.com/evidence',
  blockers: '暂无',
  nextPlan: '继续验证'
});
assert.equal(submittedDashboardBody.student.history[0].weekId, initialDashboardBody.week.id);
assert.equal(submittedDashboardBody.teacher.students.length, 2);
assert.equal(submittedDashboardBody.teacher.students[0].currentReport.recordId, 'rec_student_report');
assert.equal(submittedDashboardBody.catalog[0].title, 'ER²知识库');

const invalidContentType = await service.fetch(new Request('https://api.example/api/literature', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'text/plain' },
  body: '{}'
}), literatureEnv);
assert.equal(invalidContentType.status, 415);

const oversizedPost = await service.fetch(new Request('https://api.example/api/literature', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' },
  body: JSON.stringify({ value: 'x'.repeat(70 * 1024) })
}), literatureEnv);
assert.equal(oversizedPost.status, 413);

const literaturePost = await service.fetch(new Request('https://api.example/api/literature', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: '测试论文',
    requestId: 'literature-test-request',
    contribution: '验证共同提交与查看',
    noteUrl: 'https://example.com/note',
    paperUrl: 'https://example.com/paper'
  })
}), literatureEnv);
assert.equal(literaturePost.status, 201);
assert.equal(postedLiterature['提交人姓名'], '测试教师');
assert.equal(postedLiterature['提交人角色'], '教师');
assert.equal(postedLiterature['论文标题'], '测试论文');
assert.equal(postedLiterature['请求ID'], 'literature-test-request');

const duplicateLiteraturePost = await service.fetch(new Request('https://api.example/api/literature', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    requestId: 'literature-test-request',
    title: '测试论文',
    contribution: '验证共同提交与查看',
    noteUrl: 'https://example.com/note'
  })
}), literatureEnv);
assert.equal(duplicateLiteraturePost.status, 200);
assert.equal((await duplicateLiteraturePost.json()).deduplicated, true);

const teacherReview = await service.fetch(new Request('https://api.example/api/teacher/review', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json', 'X-Request-ID': 'review-test-request' },
  body: JSON.stringify({ recordId: 'rec_student_report', comment: '请补充参数对照实验。' })
}), literatureEnv);
assert.equal(teacherReview.status, 200);
assert.equal(postedReview['教师反馈'], '请补充参数对照实验。');
assert.equal(postedReview['反馈请求ID'], 'review-test-request');

const noCourseIdentityEnv = { ...literatureEnv, COURSE_REVIEWER_OPEN_ID: '', PROFESSOR_OPEN_ID: '' };
const nameFallbackCannotConfirm = await service.fetch(new Request('https://api.example/api/courses/confirm', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + reviewerSession, 'Content-Type': 'application/json' },
  body: JSON.stringify({ recordId: 'missing', action: 'confirm', comment: '' })
}), noCourseIdentityEnv);
assert.equal(nameFallbackCannotConfirm.status, 403);
const nameFallbackCannotView = await service.fetch(new Request('https://api.example/api/dashboard?role=teacher', {
  headers: { Authorization: 'Bearer ' + professorSession }
}), noCourseIdentityEnv);
assert.equal((await nameFallbackCannotView.json()).teacher.courseReview.visible, false);

const onboardingInitial = await service.fetch(new Request('https://api.example/api/dashboard?role=student', {
  headers: { Authorization: 'Bearer ' + studentSession }
}), literatureEnv);
assert.deepEqual((await onboardingInitial.json()).student.onboarding, {
  version: 1, completedSteps: [], completedCount: 0, total: 5, completed: false
});
const onboardingPartial = await service.fetch(new Request('https://api.example/api/onboarding', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + studentSession, 'Content-Type': 'application/json', 'X-Request-ID': 'onboarding-partial' },
  body: JSON.stringify({ completedSteps: ['feishu-access', 'lab-rules', 'environment', 'track-a'] })
}), literatureEnv);
assert.equal(onboardingPartial.status, 200);
assert.equal((await onboardingPartial.json()).onboarding.completed, false);
const onboardingRecord = courseItems.find((item) => item.fields.Lesson === 'ONBOARDING');
assert.ok(onboardingRecord);
assert.equal(onboardingRecord.fields.Track, '入组准备');
const onboardingComplete = await service.fetch(new Request('https://api.example/api/onboarding', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + studentSession, 'Content-Type': 'application/json', 'X-Request-ID': 'onboarding-complete' },
  body: JSON.stringify({ completedSteps: ['feishu-access', 'lab-rules', 'environment', 'track-a', 'test-submit'] })
}), literatureEnv);
assert.equal(onboardingComplete.status, 200);
assert.equal((await onboardingComplete.json()).onboarding.completed, true);
const onboardingDashboard = await service.fetch(new Request('https://api.example/api/dashboard?role=student', {
  headers: { Authorization: 'Bearer ' + studentSession }
}), literatureEnv);
assert.equal((await onboardingDashboard.json()).student.onboarding.completedCount, 5);

const courseSubmission = await service.fetch(new Request('https://api.example/api/courses/submit', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + studentSession, 'Content-Type': 'application/json', 'X-Request-ID': 'course-01-request' },
  body: JSON.stringify({ lessonId: '01', coreLearning: '理解仿真环境与系统结构。', problems: '无', other: '准备继续学习ROS数据流。' })
}), literatureEnv);
assert.equal(courseSubmission.status, 200);
assert.equal(postedCourse['飞书OpenID'], 'ou_student');
assert.equal(postedCourse['Lesson'], '01');
assert.equal(postedCourse['核心收获'], '理解仿真环境与系统结构。');
assert.equal(postedCourse['状态'], '等待朱俊杰确认');

courseItems.push({ record_id: 'rec_other_course_01', fields: {
  '飞书OpenID': 'ou_other_student', '姓名': '其他学生', 'Track': 'Track A｜感知与语义导航',
  'Lesson': '01', '课程名称': 'Lesson 01｜仿真与系统结构', '核心收获': '其他学生的私有内容',
  '问题与处理': '无', '状态': '朱俊杰已确认'
} });

const studentCourseDashboard = await service.fetch(new Request('https://api.example/api/dashboard?role=student', {
  headers: { Authorization: 'Bearer ' + studentSession }
}), literatureEnv);
const studentCourseBody = await studentCourseDashboard.json();
assert.equal(studentCourseBody.student.course.total, 10);
assert.equal(studentCourseBody.student.course.lessons[0].status, 'submitted');
assert.equal(studentCourseBody.student.course.lessons[0].coreLearning, '理解仿真环境与系统结构。');
assert.equal(studentCourseBody.teacher.courseReview.visible, false);

const otherStudentDashboard = await service.fetch(new Request('https://api.example/api/dashboard?role=student', {
  headers: { Authorization: 'Bearer ' + otherStudentSession }
}), literatureEnv);
const otherStudentBody = await otherStudentDashboard.json();
assert.equal(otherStudentBody.student.course.lessons[0].status, 'confirmed');
assert.equal(otherStudentBody.student.course.lessons[0].coreLearning, '其他学生的私有内容');
assert.equal(otherStudentBody.teacher.courseReview.visible, false);

const studentLessonOne = courseItems.find((item) => item.fields['飞书OpenID'] === 'ou_student' && item.fields.Lesson === '01');
assert.ok(studentLessonOne);

const professorCannotConfirm = await service.fetch(new Request('https://api.example/api/courses/confirm', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + professorSession, 'Content-Type': 'application/json' },
  body: JSON.stringify({ recordId: studentLessonOne.record_id, action: 'confirm', comment: '' })
}), literatureEnv);
assert.equal(professorCannotConfirm.status, 403);

const firstConfirmation = await service.fetch(new Request('https://api.example/api/courses/confirm', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + reviewerSession, 'Content-Type': 'application/json' },
  body: JSON.stringify({ recordId: studentLessonOne.record_id, action: 'confirm', comment: '' })
}), literatureEnv);
assert.equal(firstConfirmation.status, 200);
assert.equal(studentLessonOne.fields['状态'], '朱俊杰已确认');

for (let lesson = 2; lesson <= 9; lesson += 1) {
  courseItems.push({ record_id: 'rec_course_' + lesson, fields: {
    '飞书OpenID': 'ou_student', '姓名': '测试学生', 'Track': 'Track A｜感知与语义导航',
    'Lesson': String(lesson).padStart(2, '0'), '课程名称': 'Lesson ' + String(lesson).padStart(2, '0'),
    '核心收获': '课程收获', '问题与处理': '无', '状态': '朱俊杰已确认'
  } });
}
courseItems.push({ record_id: 'rec_course_10', fields: {
  '飞书OpenID': 'ou_student', '姓名': '测试学生', 'Track': 'Track A｜感知与语义导航',
  'Lesson': '10', '课程名称': 'Lesson 10｜综合实验与课程总结', '核心收获': '理解完整流程',
  '问题与处理': '完成问题复盘', '课程总结': '掌握主流程，仍需加强调参。', '状态': '等待朱俊杰确认'
} });
const finalConfirmation = await service.fetch(new Request('https://api.example/api/courses/confirm', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + reviewerSession, 'Content-Type': 'application/json' },
  body: JSON.stringify({ recordId: 'rec_course_10', action: 'confirm', comment: '完成基础培训。' })
}), literatureEnv);
assert.equal(finalConfirmation.status, 200);
const finalConfirmationBody = await finalConfirmation.json();
assert.equal(finalConfirmationBody.completion.completed, true);
assert.equal(finalConfirmationBody.completion.notified, true);
assert.equal(sentMessages.length, 1);
assert.equal(sentMessages[0].receive_id, 'ou_professor');
assert.match(sentMessages[0].uuid, /^[0-9a-f]{32}$/);
assert.match(JSON.parse(sentMessages[0].content).text, /测试学生同学已完成“感知与语义导航”课程培训/);

const duplicateFinalConfirmation = await service.fetch(new Request('https://api.example/api/courses/confirm', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + reviewerSession, 'Content-Type': 'application/json' },
  body: JSON.stringify({ recordId: 'rec_course_10', action: 'confirm', comment: '重复确认不应再次通知。' })
}), literatureEnv);
assert.equal(duplicateFinalConfirmation.status, 200);
assert.equal((await duplicateFinalConfirmation.json()).deduplicated, true);
assert.equal(sentMessages.length, 1);

const professorDashboard = await service.fetch(new Request('https://api.example/api/dashboard?role=teacher', {
  headers: { Authorization: 'Bearer ' + professorSession }
}), literatureEnv);
const professorDashboardBody = await professorDashboard.json();
assert.equal(professorDashboardBody.teacher.courseReview.visible, true);
assert.equal(professorDashboardBody.teacher.courseReview.canConfirm, false);
assert.equal(professorDashboardBody.teacher.courseReview.submissions.length, 11);

const managerDashboard = await service.fetch(new Request('https://api.example/api/dashboard?role=manager', {
  headers: { Authorization: 'Bearer ' + reviewerSession }
}), literatureEnv);
assert.equal((await managerDashboard.json()).manager.stats.courses, 1);

for (let lesson = 2; lesson <= 9; lesson += 1) {
  courseItems.push({ record_id: 'rec_other_course_' + lesson, fields: {
    '飞书OpenID': 'ou_other_student', '姓名': '其他学生', 'Track': 'Track A｜感知与语义导航',
    'Lesson': String(lesson).padStart(2, '0'), '课程名称': 'Lesson ' + String(lesson).padStart(2, '0'),
    '核心收获': '课程收获', '问题与处理': '无', '状态': '朱俊杰已确认'
  } });
}
courseItems.push({ record_id: 'rec_other_course_10', fields: {
  '飞书OpenID': 'ou_other_student', '姓名': '其他学生', 'Track': 'Track A｜感知与语义导航',
  'Lesson': '10', '课程名称': 'Lesson 10｜综合实验与课程总结', '核心收获': '理解完整流程',
  '问题与处理': '完成问题复盘', '课程总结': '完成课程总结。', '状态': '等待朱俊杰确认'
} });
const concurrentConfirmations = await Promise.all([1, 2].map(() => service.fetch(new Request('https://api.example/api/courses/confirm', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + reviewerSession, 'Content-Type': 'application/json' },
  body: JSON.stringify({ recordId: 'rec_other_course_10', action: 'confirm', comment: '并发确认测试。' })
}), literatureEnv)));
assert.deepEqual(concurrentConfirmations.map((response) => response.status), [200, 200]);
assert.equal(sentMessages.length, 2);
assert.notEqual(sentMessages[1].uuid, sentMessages[0].uuid);
assert.match(JSON.parse(sentMessages[1].content).text, /其他学生同学已完成/);

memberEnabled = false;
const disabledPost = await service.fetch(new Request('https://api.example/api/literature', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '停用后提交', contribution: '不应写入', noteUrl: 'https://example.com/disabled' })
}), literatureEnv);
assert.equal(disabledPost.status, 403);
assert.equal((await disabledPost.json()).message, '你的ER² Lab账号已被停用');
const disabledGet = await service.fetch(new Request('https://api.example/api/literature', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv);
assert.equal(disabledGet.status, 403);
assert.equal((await disabledGet.json()).message, '你的ER² Lab账号已被停用');
memberEnabled = true;
for (const status of ['离组', '已归档', '', '待入组']) {
  memberStatusFields = { '人员状态': status };
  const response = await service.fetch(new Request('https://api.example/api/me', {
    headers: { Authorization: 'Bearer ' + session }
  }), literatureEnv);
  assert.equal(response.status, 403, 'inactive master status must deny an existing session');
}
memberStatusFields = { '人员状态': '在组' };
assert.equal((await service.fetch(new Request('https://api.example/api/me', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv)).status, 200);
extraMembers = [{ record_id: 'rec_duplicate', fields: { '飞书OpenID': 'ou_teacher', '是否启用': false } }];
assert.equal((await service.fetch(new Request('https://api.example/api/me', {
  headers: { Authorization: 'Bearer ' + session }
}), literatureEnv)).status, 403, 'duplicate identity must deny even if one record is disabled');
extraMembers = [{ record_id: 'rec_private', fields: {
  '飞书OpenID': 'ou_private', '姓名': '不可向学生返回', '角色': ['学生'], '负责教师OpenID': 'ou_student'
} }];
const isolated = await service.fetch(new Request('https://api.example/api/dashboard?role=manager', {
  headers: { Authorization: 'Bearer ' + studentSession }
}), literatureEnv);
const isolatedBody = await isolated.json();
assert.equal(isolated.status, 200);
assert.deepEqual(isolatedBody.teacher.students, []);
assert.deepEqual(isolatedBody.manager, { stats: {}, automations: [] });
extraMembers = [];
projectItems = [{ record_id: 'rec_unassigned_project', fields: { '项目名称': '不得泄露的空编号项目' } }];
const noProject = await service.fetch(new Request('https://api.example/api/dashboard', {
  headers: { Authorization: 'Bearer ' + professorSession }
}), { ...literatureEnv, PROJECTS_BASE_APP_TOKEN: 'bas_projects', PROJECTS_TABLE_ID: 'tbl_projects' });
assert.equal(noProject.status, 200);
assert.equal((await noProject.json()).student.project.title, '暂未分配项目');
globalThis.fetch = originalFetch;

console.log('worker smoke tests passed');
