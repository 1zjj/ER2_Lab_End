(function () {
  'use strict';

  const config = window.ER2_CONFIG || {};
  const DEMO_MODE = config.demo !== false || !config.apiBase;
  const API_BASE = String(config.apiBase || '').replace(/\/$/, '');
  const roleMeta = {
    student: { label: '学生个人页', short: '学' },
    teacher: { label: '教师汇总页', short: '教' },
    manager: { label: '管理配置', short: '管' }
  };
  const onboardingSteps = [
    { id: 'workbench', icon: '⌁', title: '认识工作台', detail: '了解学习中心、周报和文献阅读入口。',
      explanation: '学习中心查看课程安排；本周工作记录填写周报并查看历史；文献阅读记录论文学习。遇到无法访问的内容，请联系管理员核对账号权限。' },
    { id: 'rules', icon: '◇', title: '阅读实验室规则', detail: '了解安全、保密、文件命名及基本规范。',
      explanation: '请阅读实验室现行规则和相关 SOP，具体要求以正式发布的文档为准。涉及设备操作和保密资料时，仍须按规定完成培训和审批。' },
    { id: 'environment', icon: '▣', title: '查看环境准备说明', detail: '了解 Ubuntu、ROS、代码及环境配置指引。',
      explanation: '按对应课程的说明准备系统、软件版本和代码环境。遇到启动或运行问题，保留报错信息并联系课程负责人；此处确认只表示已了解准备方法。' },
    { id: 'learning', icon: '⌘', title: '了解学习安排', detail: '查看当前课程、学习顺序和求助方式。',
      explanation: '进入学习中心了解当前学习安排，再按课程说明逐项学习。课程提交和审核状态以实际记录为准；“我已了解”不会改变培训状态。' },
    { id: 'weekly', icon: '➤', title: '了解周报填写方法', detail: '了解五项内容、提交时间、本人历史及教师反馈。',
      explanation: '周报包括本周完成与结果、学习与方法、产出、当前问题与阻塞、下周计划。产出可填写说明及普通网页或飞书链接。按首页显示的周次和截止时间填写正式内容，提交后可查看历史；无需为阅读本指南生成测试周报。' }
  ];

  const elements = {
    app: document.getElementById('app-root'),
    loading: document.getElementById('loading-state'),
    error: document.getElementById('error-state'),
    errorTitle: document.getElementById('error-title'),
    errorMessage: document.getElementById('error-message'),
    notice: document.getElementById('environment-notice'),
    roleNav: document.getElementById('role-nav'),
    mobileRoleNav: document.getElementById('mobile-role-nav'),
    accountName: document.getElementById('account-name'),
    accountRole: document.getElementById('account-role'),
    accountAvatar: document.getElementById('account-avatar'),
    logoutButton: document.getElementById('logout-button'),
    reportDialog: document.getElementById('report-dialog'),
    reportForm: document.getElementById('report-form'),
    reportSubmit: document.getElementById('report-submit'),
    reportError: document.getElementById('report-error'),
    reportReload: document.getElementById('report-reload'),
    reportWeekLabel: document.getElementById('report-week-label'),
    reportHistoryDialog: document.getElementById('report-history-dialog'),
    reportHistoryBody: document.getElementById('report-history-body'),
    reportHistoryStatus: document.getElementById('report-history-status'),
    reportHistoryYear: document.getElementById('report-history-year'),
    reportHistoryWeek: document.getElementById('report-history-week'),
    reportHistoryPrev: document.getElementById('report-history-prev'),
    reportHistoryNext: document.getElementById('report-history-next'),
    literatureDialog: document.getElementById('literature-dialog'),
    literatureForm: document.getElementById('literature-form'),
    literatureSubmit: document.getElementById('literature-submit'),
    literatureError: document.getElementById('literature-error'),
    literatureWeekLabel: document.getElementById('literature-week-label'),
    searchForm: document.getElementById('global-search'),
    searchInput: document.getElementById('search-input'),
    searchDialog: document.getElementById('search-dialog'),
    searchSummary: document.getElementById('search-summary'),
    searchResults: document.getElementById('search-results'),
    literatureDetailDialog: document.getElementById('literature-detail-dialog'),
    literatureDetailTitle: document.getElementById('literature-detail-title'),
    literatureDetailMeta: document.getElementById('literature-detail-meta'),
    literatureDetailBody: document.getElementById('literature-detail-body'),
    studentDetailDialog: document.getElementById('student-detail-dialog'),
    studentDetailTitle: document.getElementById('student-detail-title'),
    studentDetailMeta: document.getElementById('student-detail-meta'),
    studentDetailBody: document.getElementById('student-detail-body'),
    feedbackForm: document.getElementById('teacher-feedback-form'),
    feedbackRecordId: document.getElementById('feedback-record-id'),
    feedbackComment: document.getElementById('feedback-comment'),
    feedbackSubmit: document.getElementById('feedback-submit'),
    feedbackError: document.getElementById('feedback-error'),
    courseDialog: document.getElementById('course-dialog'),
    courseDialogTitle: document.getElementById('course-dialog-title'),
    courseDialogPrompt: document.getElementById('course-dialog-prompt'),
    courseForm: document.getElementById('course-form'),
    courseLessonId: document.getElementById('course-lesson-id'),
    courseSummaryField: document.getElementById('course-summary-field'),
    courseConfirmationNote: document.getElementById('course-confirmation-note'),
    courseSubmit: document.getElementById('course-submit'),
    courseError: document.getElementById('course-error'),
    courseReviewDialog: document.getElementById('course-review-dialog'),
    courseReviewTitle: document.getElementById('course-review-title'),
    courseReviewMeta: document.getElementById('course-review-meta'),
    courseReviewBody: document.getElementById('course-review-body'),
    courseConfirmForm: document.getElementById('course-confirm-form'),
    courseReviewRecordId: document.getElementById('course-review-record-id'),
    courseReviewComment: document.getElementById('course-review-comment'),
    courseReviewError: document.getElementById('course-review-error'),
    courseConfirmButton: document.getElementById('course-confirm-button'),
    courseSupplementButton: document.getElementById('course-supplement-button'),
    onboardingDialog: document.getElementById('onboarding-dialog'),
    onboardingChecklist: document.getElementById('onboarding-checklist'),
    onboardingProgressLabel: document.getElementById('onboarding-progress-label'),
    onboardingProgressHint: document.getElementById('onboarding-progress-hint'),
    onboardingProgressTrack: document.getElementById('onboarding-progress-track'),
    onboardingCourseEntry: document.getElementById('onboarding-course-entry'),
    onboardingSaveStatus: document.getElementById('onboarding-save-status'),
    toast: document.getElementById('toast')
  };

  const privateDrafts = window.ER2DraftStore.create(sessionStorage);
  const state = {
    session: readSession(),
    activeRole: 'student',
    activeStudentId: '',
    activeLessonId: '',
    activeCourseRecordId: '',
    learningCenterOpen: false,
    dashboard: null,
    catalog: [],
    toastTimer: null
  };

  const memberGuide = window.ER2GuideStore.create({ storage: function () { return localStorage; },
    namespace: API_BASE || 'demo', steps: onboardingSteps.map(function (step) { return step.id; }) });

  const draftKeys = {
    report: 'er2-draft-report',
    literature: 'er2-draft-literature',
    feedbackRequest: 'er2-request-feedback',
    courseRequest: 'er2-request-course',
    courseReviewRequest: 'er2-request-course-review'
  };

  const demoData = {
    profile: {
      name: '学生 A',
      track: '语义导航方向',
      roles: ['student', 'teacher', 'manager']
    },
    week: {
      id: '2026-W36',
      label: '2026年8月31日—9月6日 · 第36周',
      dueLabel: '周五 18:00 截止'
    },
    student: {
      onboarding: { version: 1, completedSteps: [], completedCount: 0, total: 5, completed: false },
      report: { status: 'pending', label: '未提交' },
      course: {
        id: 'track-a', title: 'Track A｜感知与语义导航', progress: 20, completed: 2, submitted: 3, total: 10,
        next: 'Lesson 03 · 机器人本体与 TF',
        lessons: [
          { lessonId: '01', lessonTitle: '仿真与系统结构', prompt: '仿真系统由哪些模块组成？课程环境如何启动？', status: 'confirmed', statusLabel: '朱俊杰已确认', coreLearning: '理解课程仿真环境与主要模块。', problems: '无', courseSummary: '', other: '', canEdit: false },
          { lessonId: '02', lessonTitle: 'ROS 数据流', prompt: 'ROS 节点、Topic 和消息如何构成数据流？', status: 'confirmed', statusLabel: '朱俊杰已确认', coreLearning: '理解 ROS 数据流和 rqt_graph。', problems: '无', courseSummary: '', other: '', canEdit: false },
          { lessonId: '03', lessonTitle: '机器人本体与 TF', prompt: '机器人本体、URDF/Xacro 与 TF 分别有什么作用？', status: 'supplement', statusLabel: '需要补充', coreLearning: '理解 URDF 和 TF 的基本关系。', problems: 'base_link 到传感器坐标关系仍需梳理。', courseSummary: '', other: '', confirmationComment: '请补充 map、base_footprint 与 base_link 的关系。', canEdit: true },
          { lessonId: '04', lessonTitle: '传感器原始数据', prompt: '传感器原始数据如何产生并进入 ROS？', status: 'pending', statusLabel: '未开始', coreLearning: '', problems: '', courseSummary: '', other: '', canEdit: true },
          { lessonId: '05', lessonTitle: 'FAST-LIO2', prompt: 'FAST-LIO2 使用哪些输入，产生什么输出？', status: 'pending', statusLabel: '未开始', coreLearning: '', problems: '', courseSummary: '', other: '', canEdit: true },
          { lessonId: '06', lessonTitle: '地图与 Costmap', prompt: '地图、障碍物和 Costmap 之间是什么关系？', status: 'pending', statusLabel: '未开始', coreLearning: '', problems: '', courseSummary: '', other: '', canEdit: true },
          { lessonId: '07', lessonTitle: '全局规划', prompt: '全局规划如何生成可行路径？', status: 'pending', statusLabel: '未开始', coreLearning: '', problems: '', courseSummary: '', other: '', canEdit: true },
          { lessonId: '08', lessonTitle: '局部规划与控制', prompt: '局部规划与控制如何完成跟踪和避障？', status: 'pending', statusLabel: '未开始', coreLearning: '', problems: '', courseSummary: '', other: '', canEdit: true },
          { lessonId: '09', lessonTitle: '语义导航', prompt: '语义信息如何参与地图构建和导航决策？', status: 'pending', statusLabel: '未开始', coreLearning: '', problems: '', courseSummary: '', other: '', canEdit: true },
          { lessonId: '10', lessonTitle: '综合实验与课程总结', prompt: '如何将感知、定位、建图、规划和控制组成完整闭环？', status: 'pending', statusLabel: '未开始', coreLearning: '', problems: '', courseSummary: '', other: '', canEdit: true }
        ],
        otherTracks: [
          { title: 'Track 0｜通用、安全与设备', status: '待规划' },
          { title: 'Track B｜操作与装配', status: '待建设' },
          { title: 'Track C｜规划与多智能体', status: '待建设' }
        ]
      },
      project: {
        code: 'P03',
        title: 'PatchNav',
        milestone: '真机地图稳定性验证',
        progress: 62,
        blocker: '动态障碍附近 costmap 局部跳变；下一步完成参数对照实验。',
        url: ''
      },
      tasks: [
        { title: '完成 Lesson 03 实验', detail: '提交 rqt_graph、TF 检查与结果截图', type: '课程' },
        { title: '更新 P03 项目证据', detail: '记录 costmap 跳变现象与复现实验', type: '项目' },
        { title: '提交本周工作记录', detail: '进展、证据、阻塞和下一步', type: '周报' }
      ],
      links: [
        { title: '历史周报', url: '' },
        { title: '设备培训资格', url: '' },
        { title: '借用与报修', url: '' },
        { title: 'ER²知识库', url: config.feishuWikiUrl }
      ],
      history: [
        { recordId: 'demo-report-1', weekId: '2026-W35', submittedAt: '2026-08-28', status: '已反馈', feedback: '证据完整，下周补充参数对照。', values: { progress: '完成 Lesson 02 与 TF 检查。', learning: '掌握 rqt_graph 排查方法。', evidence: 'https://example.com/evidence', blockers: 'costmap 局部跳变。', nextPlan: '完成参数对照实验。' } }
      ]
    },
    teacher: {
      stats: { submitted: 2, missing: 1, blocked: 1 },
      students: [
        { id: 'stu-a', name: '学生 A', project: 'P03 PatchNav', status: '未提交', blocker: 'costmap 局部跳变', tone: 'orange' },
        { id: 'stu-b', name: '学生 B', project: 'P01 双臂协同', status: '已提交', blocker: '无', tone: 'green' },
        { id: 'stu-c', name: '学生 C', project: 'P05 Go2 感知', status: '已提交', blocker: '标定误差偏高', tone: 'red' }
      ],
      commonIssues: [
        '两名学生需要统一 ROS/TF 证据提交格式',
        'P03 的动态障碍 costmap 稳定性需要安排复现实验',
        'Lesson 03 建议增加真机安全检查清单'
      ],
      courseReview: { visible: true, canConfirm: true, viewerLabel: '朱俊杰确认页', pending: 1, submissions: [] }
    },
    manager: {
      stats: { members: 4, projects: 3, courses: 5 },
      automations: [
        { name: '未交周报提醒', trigger: '周五 11:00', target: '未交学生', status: '待接入' },
        { name: '提交状态更新', trigger: '学生提交后', target: '周报记录', status: '页面已支持' },
        { name: '教授周报摘要', trigger: '周五 18:00', target: '教授', status: '待接入' }
      ]
    },
    literature: {
      weekId: '2026-W36',
      mineCount: 2,
      minimum: 3,
      completed: false,
      items: [
        { id: 'demo-1', title: 'Learning Transferable Visual Models From Natural Language Supervision', submitter: '郑斯哲', role: '学生', weekId: '2026-W36', date: '2026-09-03', authors: 'Radford et al.', venue: 'ICML', year: '2021', direction: '视觉语言', type: '精读', contribution: '通过大规模图文对比学习获得可迁移的零样本视觉识别能力。', noteUrl: '', paperUrl: 'https://arxiv.org/abs/2103.00020', attachmentUrl: '', submittedAt: '2026-09-03T12:30:00.000Z' },
        { id: 'demo-2', title: 'Diffusion Policy: Visuomotor Policy Learning via Action Diffusion', submitter: '朱俊杰', role: '教师 / 管理员', weekId: '2026-W36', date: '2026-09-02', authors: 'Chi et al.', venue: 'RSS', year: '2023', direction: '具身智能', type: '复现', contribution: '把动作序列建模为条件扩散过程，提高多模态机器人操作策略的表达能力。', noteUrl: '', paperUrl: 'https://arxiv.org/abs/2303.04137', attachmentUrl: '', submittedAt: '2026-09-02T09:10:00.000Z' }
      ]
    }
  };

  function readSession() {
    const match = location.hash.match(/(?:^#|&)session=([^&]+)/);
    if (match) {
      const token = decodeURIComponent(match[1]);
      // Drafts remain unreadable until /api/me or the dashboard confirms the
      // owner. bind() clears them when a different account signs in.
      sessionStorage.setItem('er2-session', token);
      history.replaceState(null, '', location.pathname + location.search);
      return token;
    }
    return sessionStorage.getItem('er2-session') || '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeUrl(value) {
    const text = String(value || '').trim();
    if (!text || text === '#') return '#';
    try {
      const url = new URL(text, location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch (_) {
      return '#';
    }
  }

  function createRequestId(prefix) {
    const id = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    return (prefix || 'req') + '-' + id;
  }

  function pendingRequestId(key, prefix) {
    const existing = privateDrafts.get(key, draftScope());
    if (existing) return existing;
    const created = createRequestId(prefix);
    privateDrafts.set(key, draftScope(), created);
    return created;
  }

  function availableLink(url, label, className) {
    const safe = safeUrl(url);
    if (safe === '#') return '<button class="' + escapeHtml(className || 'text-link') + ' link-unconfigured" type="button" data-missing-link="' + escapeHtml(label) + '" title="该入口尚未由管理员配置">' + escapeHtml(label) + '</button>';
    return '<a class="' + escapeHtml(className || 'text-link') + '" href="' + safe + '">' + escapeHtml(label) + '</a>';
  }

  function draftScope() { return state.dashboard?.week?.id || ''; }

  function saveDraft(form, key) {
    const values = Object.fromEntries(new FormData(form).entries());
    if (key === draftKeys.report) values._baseRevision = state.reportBaseRevision || '';
    privateDrafts.set(key, draftScope(), JSON.stringify(values));
  }

  function restoreDraft(form, key, contentFields) {
    let values = {};
    try { values = JSON.parse(privateDrafts.get(key, draftScope()) || '{}'); } catch (_) { values = {}; }
    if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
    // A cleared or obsolete report draft must not hide a later saved report.
    if (contentFields && !contentFields.some(name => typeof values[name] === 'string' && values[name].trim())) return false;
    setFormValues(form, values);
    return Object.keys(values).length > 0;
  }

  function setFormValues(form, values) {
    Object.keys(values || {}).forEach(function (name) {
      const field = form.elements.namedItem(name);
      if (field && typeof values[name] === 'string') field.value = values[name];
    });
  }

  function clearDraft(key) {
    privateDrafts.remove(key, draftScope());
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    state.toastTimer = setTimeout(function () {
      elements.toast.classList.remove('show');
    }, 2800);
  }

  function setBusy(busy) {
    elements.loading.hidden = !busy;
    if (busy) {
      elements.error.hidden = true;
      elements.app.hidden = true;
    }
  }

  function showError(title, message) {
    setBusy(false);
    elements.app.hidden = true;
    elements.errorTitle.textContent = title;
    elements.errorMessage.textContent = message;
    elements.error.hidden = false;
  }

  window.addEventListener('er2-session-denied', function (event) {
    if (event.detail?.status !== 401) privateDrafts.clear();
    memberGuide.bind('');
    state.dashboard = null;
    const sourcePanel = document.getElementById('weekly-source-panel');
    const sourceResult = document.getElementById('weekly-source-result');
    if (sourcePanel) sourcePanel.hidden = true;
    if (sourceResult) sourceResult.textContent = '';
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    elements.app.hidden = true;
    showError('访问权限需要重新核验', '请重新登录；若账号已停用，请联系管理员核对。');
  });

  async function authenticatedFetch(url, options) {
    const response = await fetch(url, options);
    if (response.status === 401 || response.status === 403) {
      window.dispatchEvent(new CustomEvent('er2-session-denied', { detail: { status: response.status } }));
    }
    return response;
  }

  async function request(path, options) {
    const response = await authenticatedFetch(API_BASE + path, Object.assign({
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + state.session
      }
    }, options || {}));
    if (response.status === 401) {
      sessionStorage.removeItem('er2-session');
      location.href = API_BASE + '/auth/launch?returnTo=' + encodeURIComponent(location.href);
      throw new Error('身份已过期，正在重新登录');
    }
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const error = new Error((payload.message || '请求失败（' + response.status + '）') + (payload.requestId ? '；诊断编号：' + payload.requestId : ''));
      error.status = response.status; error.code = payload.code; throw error;
    }
    return payload;
  }

  async function loadDashboard(role) {
    setBusy(true);
    try {
      let data;
      if (DEMO_MODE) {
        await new Promise(function (resolve) { setTimeout(resolve, 260); });
        data = JSON.parse(JSON.stringify(demoData));
        const saved = readDemoLiterature();
        if (saved.length) {
          const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const recentSaved = saved.filter(function (item) {
            return recordTimestamp(item.submittedAt || item.date) >= recentCutoff;
          });
          const currentWeekSaved = saved.filter(function (item) {
            return item.weekId === data.week.id && item.submitter === data.profile.name;
          });
          data.literature.items = recentSaved.concat(data.literature.items).slice(0, 30);
          data.literature.mineCount += currentWeekSaved.length;
          data.literature.completed = data.literature.mineCount >= data.literature.minimum;
        }
      } else {
        if (!state.session) {
          location.href = API_BASE + '/auth/launch?returnTo=' + encodeURIComponent(location.href);
          return;
        }
        if (new URLSearchParams(location.search).get('page') === 'weekly') data = await request('/api/weekly');
        else {
          try { data = await request('/api/dashboard' + (role ? '?role=' + encodeURIComponent(role) : '')); }
          catch (error) {
            if (!error.status || error.status < 500) throw error;
            data = await request('/api/weekly');
            data.dashboardUnavailable = true;
          }
        }
      }
      privateDrafts.bind(DEMO_MODE ? 'demo' : data.profile.sub);
      memberGuide.bind(DEMO_MODE ? 'demo' : data.profile.sub);
      state.learningCenterOpen = false;
      state.dashboard = data;
      if (Array.isArray(data.catalog) && data.catalog.length) state.catalog = mergeCatalog(state.catalog, data.catalog);
      const roles = Array.isArray(data.profile.roles) ? data.profile.roles.filter(function (item) { return roleMeta[item]; }) : ['student'];
      state.activeRole = roles.includes(role) ? role : (roles.includes(state.activeRole) ? state.activeRole : roles[0]);
      renderAccount();
      renderRoleNavigation(roles);
      renderActiveView();
      elements.notice.hidden = !DEMO_MODE;
      elements.error.hidden = true;
      elements.loading.hidden = true;
      elements.app.hidden = false;
      if (new URLSearchParams(location.search).get('page') === 'weekly' && roles.includes('student')) openReportDialog();
    } catch (error) {
      elements.accountName.textContent = '身份或数据读取未完成';
      showError('工作台暂时无法载入', error.message || '请稍后重试');
      if (state.session && error.status !== 401 && error.status !== 403) {
        try { const me = await request('/api/me');
          elements.accountName.textContent = me.profile.name;
          elements.accountRole.textContent = '已确认身份';
          elements.logoutButton.hidden = false;
        } catch (_) { /* Keep the original failure and do not assume an identity. */ }
      }
    }
  }

  function renderAccount() {
    const profile = state.dashboard.profile;
    elements.accountName.textContent = profile.name;
    elements.accountRole.textContent = roleMeta[state.activeRole].label + (profile.track ? ' · ' + profile.track : '');
    elements.accountAvatar.textContent = String(profile.name || 'ER').trim().slice(-1).toUpperCase();
    elements.logoutButton.hidden = DEMO_MODE;
  }

  function greeting() {
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false
    }).format(new Date()));
    if (hour < 6) return '夜深了';
    if (hour < 12) return '早上好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function recordTimestamp(value) {
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readDemoLiterature() {
    try {
      const saved = JSON.parse(localStorage.getItem('er2-demo-literature') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  }

  function mergeCatalog(baseItems, liveItems) {
    const merged = new Map();
    (baseItems || []).forEach(function (item) { merged.set(normalize(item.title), item); });
    (liveItems || []).forEach(function (item) {
      const key = normalize(item.title);
      const previous = merged.get(key) || {};
      merged.set(key, Object.assign({}, previous, item, {
        keywords: Array.from(new Set([].concat(previous.keywords || [], item.keywords || [])))
      }));
    });
    return Array.from(merged.values());
  }
  function renderRoleNavigation(roles) {
    const html = roles.map(function (role) {
      const meta = roleMeta[role];
      return '<button type="button" class="role-button ' + (role === state.activeRole ? 'active' : '') +
        '" data-role="' + role + '" data-short="' + meta.short + '">' + meta.label + '</button>';
    }).join('');
    elements.roleNav.innerHTML = html;
    elements.mobileRoleNav.innerHTML = html;
    [elements.roleNav, elements.mobileRoleNav].forEach(function (nav) {
      nav.querySelectorAll('[data-role]').forEach(function (button) {
        button.addEventListener('click', function () {
          const role = button.dataset.role;
          if (!roles.includes(role)) return;
          state.activeRole = role;
          renderAccount();
          renderRoleNavigation(roles);
          renderActiveView();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    });
  }

  function tag(text, tone) {
    return '<span class="tag ' + escapeHtml(tone || '') + '">' + escapeHtml(text) + '</span>';
  }

  function dashboardLink(terms) {
    const links = state.dashboard && state.dashboard.student && Array.isArray(state.dashboard.student.links)
      ? state.dashboard.student.links : [];
    return (links.find(function (item) {
      return terms.some(function (term) { return String(item.title || '').includes(term); });
    }) || {}).url || '';
  }

  function wikiUrl() {
    return config.feishuWikiUrl || dashboardLink(['知识库', 'ER²首页', 'ER2首页']) ||
      (state.catalog.find(function (item) { return item.category === '知识库' && safeUrl(item.url) !== '#'; }) || {}).url || '#';
  }

  function courseUrl() {
    return config.learningCenterUrl || dashboardLink(['课程', '学习中心', '培训']) ||
      (state.catalog.find(function (item) { return item.category === '课程' && safeUrl(item.url) !== '#'; }) || {}).url || wikiUrl();
  }

  function footer() {
    return '<footer><span>ER² Lab统一工作台 · 数据与大文件由飞书承载</span>' +
      availableLink(wikiUrl(), '打开ER²知识库') + '</footer>';
  }

  function onboardingData() { return memberGuide.read(); }

  function renderOnboardingEntry() {
    const guide = onboardingData();
    if (guide.completed || guide.skipped) return '';
    const progress = Math.round(guide.completedCount / guide.total * 100);
    return '<section class="onboarding-banner"><div class="onboarding-icon" aria-hidden="true">✦</div><div><h2>新成员使用指南</h2><p>了解工作台、规则、环境、学习安排及周报使用方法。也可直接进入学习中心。</p><div class="onboarding-banner-progress"><div class="progress-track" role="progressbar" aria-label="指南阅读进度" aria-valuemin="0" aria-valuemax="5" aria-valuenow="' + guide.completedCount + '"><span style="width:' + progress + '%"></span></div><strong>' + guide.completedCount + ' / ' + guide.total + ' 已了解</strong></div></div><div class="action-row"><button class="button button-primary" type="button" data-open-onboarding>查看指南</button></div></section>';
  }

  function renderOnboardingDialog() {
    const guide = onboardingData();
    const completed = new Set(guide.completedSteps);
    elements.onboardingProgressLabel.textContent = guide.completedCount + ' / ' + guide.total + ' 已了解';
    elements.onboardingProgressHint.textContent = guide.completed ? '五项说明均已了解' : (guide.skipped ? '已选择直接进入学习中心，可随时补看说明' : '可逐项查看，也可直接进入学习中心');
    elements.onboardingProgressTrack.setAttribute('aria-valuenow', String(guide.completedCount));
    elements.onboardingProgressTrack.querySelector('span').style.width = Math.round(guide.completedCount / guide.total * 100) + '%';
    elements.onboardingChecklist.innerHTML = onboardingSteps.map(function (step) {
      const done = completed.has(step.id);
      return '<article class="onboarding-check-item ' + (done ? 'completed' : '') + '"><span class="onboarding-step-icon" aria-hidden="true">' + escapeHtml(done ? '✓' : step.icon) + '</span><div><strong>' + escapeHtml(step.title) + '</strong><small>' + escapeHtml(step.detail) + '</small><details class="guide-explanation"><summary>查看说明</summary><p>' + escapeHtml(step.explanation) + '</p>' + (step.id === 'weekly' ? '<button class="button button-ghost" type="button" data-guide-weekly>查看周报表单</button>' : '') + '</details></div><button class="button button-secondary onboarding-step-action" type="button" data-guide-step="' + escapeHtml(step.id) + '" aria-pressed="' + done + '" aria-label="' + escapeHtml(step.title + '：' + (done ? '撤销已了解' : '我已了解')) + '">' + (done ? '已了解 · 撤销' : '我已了解') + '</button></article>';
    }).join('');
    elements.onboardingCourseEntry.innerHTML = '<button class="button button-primary" type="button" data-guide-learning>进入学习中心</button>';
    elements.onboardingSaveStatus.textContent = guide.persistent
      ? '仅在本浏览器记住此账号的阅读进度；换设备或清除浏览器数据后可能重新出现。'
      : '浏览器暂不能记住进度，本次查看仍可继续；刷新后可能重新显示指南。';
    elements.onboardingSaveStatus.className = '';
    elements.onboardingChecklist.querySelectorAll('[data-guide-step]').forEach(function (button) {
      button.addEventListener('click', function () { acknowledgeGuideStep(button.dataset.guideStep); });
    });
    elements.onboardingChecklist.querySelectorAll('[data-guide-weekly]').forEach(function (button) {
      button.addEventListener('click', function () { closeDialog(elements.onboardingDialog); openReportDialog(); });
    });
    elements.onboardingCourseEntry.querySelector('[data-guide-learning]').addEventListener('click', function () {
      closeDialog(elements.onboardingDialog); openLearningCenter();
    });
  }

  function openOnboardingDialog() {
    if (!state.dashboard?.profile?.roles?.includes('student')) return;
    renderOnboardingDialog();
    showDialog(elements.onboardingDialog);
  }

  function acknowledgeGuideStep(stepId) {
    if (!state.dashboard?.profile?.roles?.includes('student')) return;
    const current = onboardingData();
    if (!memberGuide.setStep(stepId, !current.completedSteps.includes(stepId))) return;
    const next = onboardingData();
    renderActiveView();
    if (next.completed) {
      closeDialog(elements.onboardingDialog);
      showToast('已了解全部说明，可随时从右上角重新查看');
    } else {
      renderOnboardingDialog();
      const button = elements.onboardingChecklist.querySelector('[data-guide-step="' + stepId + '"]');
      if (button) button.focus();
    }
  }

  function skipMemberGuide() {
    if (!state.dashboard?.profile?.roles?.includes('student') || !memberGuide.skip()) return;
    closeDialog(elements.onboardingDialog);
    renderActiveView();
    openLearningCenter();
  }

  function openLearningCenter() {
    if (!state.dashboard?.profile?.roles?.includes('student') || state.activeRole !== 'student') return;
    const materials = elements.app.querySelector('.learning-material-link');
    if (materials) { materials.click(); return; }
    const center = elements.app.querySelector('.course-panel');
    if (!center) { showToast('当前页面未加载学习中心，请返回主页后重试'); return; }
    state.learningCenterOpen = true;
    center.hidden = false;
    center.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderLiteratureSection() {
    const literature = state.dashboard.literature || { mineCount: 0, minimum: 3, completed: false, items: [] };
    const items = Array.isArray(literature.items) ? literature.items : [];
    const progress = Math.min(100, Math.round((Number(literature.mineCount || 0) / Math.max(Number(literature.minimum || 3), 1)) * 100));
    return [
      '<section class="panel literature-panel"><div class="literature-head"><div><p class="kicker">SHARED READING</p><h2>文献阅读</h2>',
      '<p>本周至少 3 篇，不限制上限。学生、教师和管理员提交的内容在课题组内互相可见。</p></div>',
      '<div class="literature-actions"><div class="literature-count"><strong>' + Number(literature.mineCount || 0) + ' / ' + Number(literature.minimum || 3) + '</strong><span>我的本周提交</span></div>',
      '<button class="button button-primary" type="button" data-open-literature>＋ 提交文献阅读</button></div></div>',
      '<div class="progress-track literature-progress" role="progressbar" aria-label="文献阅读周进度" aria-valuenow="' + progress + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + progress + '%"></span></div>',
      '<div class="literature-status">' + (literature.completed ? '<span class="status-ok">已达到本周最低篇数，可继续提交</span>' : '<span class="status-wait">还需 ' + Math.max(0, Number(literature.minimum || 3) - Number(literature.mineCount || 0)) + ' 篇达到本周最低要求</span>') + '</div>',
      '<div class="panel-title literature-list-title"><h3>最近7天阅读</h3><span>课题组共同可见 · ' + items.length + ' 条</span></div>',
      items.length ? '<div class="literature-list">' + items.map(function (item) {
        const meta = [item.authors, item.venue, item.year].filter(Boolean).join(' · ');
        return '<button class="literature-item" type="button" data-literature-detail="' + escapeHtml(item.id) + '"><div class="literature-item-main"><div class="literature-by"><span class="student-avatar">' + escapeHtml(String(item.submitter || 'ER').slice(-1)) + '</span><span><strong>' + escapeHtml(item.submitter || 'ER²成员') + '</strong><small>' + escapeHtml(item.role || '成员') + ' · ' + escapeHtml(item.date || item.weekId || '') + '</small></span></div><h3>' + escapeHtml(item.title) + '</h3>' +
          (meta ? '<p class="literature-meta">' + escapeHtml(meta) + '</p>' : '') + '<p class="literature-contribution">' + escapeHtml(item.contribution || '尚未填写一句话贡献') + '</p><div class="literature-tags">' +
          (item.direction ? tag(item.direction) : '') + (item.type ? tag(item.type, 'green') : '') + '</div></div><span class="literature-open">查看详情 ›</span></button>';
      }).join('') + '</div>' : '<div class="empty">最近7天还没有阅读记录。</div>',
      '</section>'
    ].join('');
  }

  function courseTone(status) {
    return ({ confirmed: 'green', supplement: 'red', submitted: 'orange', learning: 'blue', pending: '' })[status] || '';
  }

  function courseSubmissionAvailable() {
    return DEMO_MODE || state.dashboard?.capabilities?.courses?.submissionEnabled === true;
  }

  function renderCoursePanel() {
    if (!courseSubmissionAvailable()) return '';
    const course = state.dashboard.student.course || { lessons: [], otherTracks: [], completed: 0, total: 10, progress: 0 };
    const lessons = Array.isArray(course.lessons) ? course.lessons : [];
    const otherTracks = Array.isArray(course.otherTracks) ? course.otherTracks : [];
    return [
      '<section class="panel course-panel" id="learning-center"' + (state.learningCenterOpen ? '' : ' hidden') + '><div class="course-panel-head"><div><p class="kicker">TRACK A TRAINING</p><h2>' + escapeHtml(course.title || 'Track A｜感知与语义导航') + '</h2>',
      '<p>Lesson 01–10 每课提交一份文字学习记录，由朱俊杰确认。</p></div><div class="course-count"><strong>' + Number(course.completed || 0) + ' / ' + Number(course.total || 10) + '</strong><span>已确认课程</span></div></div>',
      '<div class="progress-track course-progress" role="progressbar" aria-label="Track A课程进度" aria-valuenow="' + Number(course.progress || 0) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + Number(course.progress || 0) + '%"></span></div>',
      '<div class="course-list">',
      lessons.map(function (lesson) {
        const action = lesson.status === 'confirmed' ? '查看记录' : (lesson.recordId ? '查看 / 修改' : '提交记录');
        return '<article class="course-lesson"><span class="course-number">' + escapeHtml(lesson.lessonId) + '</span><div class="course-lesson-main"><div><strong>Lesson ' + escapeHtml(lesson.lessonId) + '｜' + escapeHtml(lesson.lessonTitle) + '</strong>' + tag(lesson.statusLabel, courseTone(lesson.status)) + '</div><small>' + escapeHtml(lesson.prompt || '') + '</small>' +
          (lesson.confirmationComment ? '<p class="course-comment"><strong>朱俊杰说明：</strong>' + escapeHtml(lesson.confirmationComment) + '</p>' : '') + '</div><button class="button button-secondary course-action" type="button" data-course-lesson="' + escapeHtml(lesson.lessonId) + '">' + action + '</button></article>';
      }).join(''),
      '</div>',
      otherTracks.length ? '<details class="other-tracks"><summary>其他学习方向</summary>' + otherTracks.map(function (track) {
        return '<div><span>' + escapeHtml(track.title) + '</span>' + tag(track.status) + '</div>';
      }).join('') + '</details>' : '',
      '</section>'
    ].join('');
  }

  function renderCourseReviewPanel() {
    if (!courseSubmissionAvailable()) return '';
    const review = state.dashboard.teacher && state.dashboard.teacher.courseReview;
    if (!review || !review.visible) return '';
    const submissions = Array.isArray(review.submissions) ? review.submissions : [];
    return [
      '<section class="panel course-review-panel"><div class="panel-title"><div><p class="kicker">COURSE CONFIRMATION</p><h2>Track A 学习记录</h2></div><span>' + escapeHtml(review.viewerLabel || '') + ' · 待确认 ' + Number(review.pending || 0) + '</span></div>',
      '<p class="course-review-note">提交内容仅学生本人、朱俊杰和陈铮一教授可见。' + (review.canConfirm ? '请对基本完成情况进行确认，不进行评分。' : '当前为只读查看。') + '</p>',
      submissions.length ? '<div class="course-review-list">' + submissions.map(function (item) {
        return '<button type="button" class="course-review-item" data-course-review="' + escapeHtml(item.recordId) + '"><span class="student-avatar">' + escapeHtml(String(item.studentName || 'ER').slice(-1)) + '</span><span><strong>' + escapeHtml(item.studentName) + ' · Lesson ' + escapeHtml(item.lessonId) + '</strong><small>' + escapeHtml(item.lessonTitle) + ' · ' + escapeHtml(item.submittedAt || '未记录时间') + '</small></span>' + tag(item.statusLabel, courseTone(item.status)) + '<b>查看 ›</b></button>';
      }).join('') + '</div>' : '<div class="empty">当前还没有课程提交记录。</div>',
      '</section>'
    ].join('');
  }

  function renderWeeklyOnly() {
    const data = state.dashboard;
    const roles = data.profile.roles;
    const mine = roles.includes('student') ? '<button class="button button-primary" data-open-report>' +
      (data.student.report.status === 'submitted' ? '修改本周记录' : '填写本周工作记录') +
      '</button> <button class="button button-secondary" data-open-report-history>查看本人历史</button>' : '';
    const students = roles.some(role => ['teacher', 'manager'].includes(role)) ?
      (data.teacher.students || []).map(student => '<button class="button button-secondary" data-student="' + escapeHtml(student.id) + '">' +
        escapeHtml(student.name + ' · ' + student.status) + '</button>').join(' ') : '';
    elements.app.innerHTML = '<section class="panel"><h2>本周工作记录</h2><p>' + escapeHtml(data.week.label) + '</p>' +
      (data.dashboardUnavailable ? '<p>其他模块暂时无法加载。周报服务已独立读取，可继续填写和查看记录。</p>' : '') +
      mine + (students ? '<h3>教师查看</h3>' + students : '') + '</section>';
    bindViewActions();
  }

  function evidenceMarkup(value) {
    if (!value) return '';
    const content = String(value).split(/(https?:\/\/[^\s<>"'，。；（）]+)/g).map(function (part) {
      if (/^https?:\/\//.test(part)) {
        try { const url = new URL(part);
          if (url.username || url.password) return escapeHtml(part);
          return '<a target="_blank" rel="noopener noreferrer" href="' + escapeHtml(url.href) + '">' + escapeHtml(part) + '</a>';
        } catch (_) { /* Non-URL text stays text. */ }
      }
      return escapeHtml(part).replace(/\n/g, '<br>');
    }).join('');
    return '<section class="detail-wide"><h3>产出（若有阶段性成果，可以提交文档链接）</h3><p>' + content + '</p></section>';
  }

  function studentHomeView(student) {
    if (!student?.home) return null;
    // A confirmed weekly save updates student.report before the next dashboard
    // read. Do not let the older home summary overwrite that confirmed status.
    const home = student.home;
    const report = Object.assign({}, home.report, student.report);
    return Object.assign({}, home, { report, todos: (home.todos || []).filter(function (item) {
      return !(item.action === 'report' && report.status === 'submitted');
    }) });
  }

  function renderActiveView() {
    if (state.dashboard.weeklyOnly) { renderWeeklyOnly(); return; }
    if (state.activeRole === 'teacher') elements.app.innerHTML = renderTeacher();
    else if (state.activeRole === 'manager') elements.app.innerHTML = renderManager();
    else elements.app.innerHTML = renderStudent();
    bindViewActions();
    window.dispatchEvent(new CustomEvent('er2-dashboard-rendered', { detail: { role: state.activeRole, home: studentHomeView(state.dashboard.student) } }));
  }

  function renderLearningCard() {
    const course = state.dashboard.student.course || {};
    const enabled = courseSubmissionAvailable();
    const materials = safeUrl(courseUrl());
    const action = enabled
      ? '<button class="button button-primary" type="button" data-open-learning-center>进入学习中心</button>'
      : (materials !== '#' ? availableLink(materials, '进入学习中心', 'button button-primary learning-material-link')
        : '<p class="empty-link-note">学习资料入口待配置，请联系管理员。</p>');
    return '<section class="panel learning-card" data-courses-enabled="' + enabled + '"><p class="kicker">LEARNING</p><div class="panel-title"><h2>学习中心</h2></div>' +
      '<p class="learning-direction">' + escapeHtml(course.title || '查看当前学习安排') + '</p>' +
      (enabled ? '<p>' + escapeHtml(course.next || '查看课程安排与记录') + '</p>' : '<p>阅读教材，完成练习。<br>本周学习进展写入周报的“学习与方法”。</p>') +
      action + '</section>';
  }

  function renderFinancePlaceholder() {
    return '<section class="panel finance-card" aria-labelledby="finance-title"><p class="kicker">APPLICATIONS</p>' +
      '<div class="panel-title"><h2 id="finance-title">预算与报销</h2>' + tag('筹备中') + '</div>' +
      '<div class="finance-overview"><div><span aria-hidden="true">01</span><div><h3>预算申请</h3><p>费用发生前，说明用途与预计金额。</p></div></div>' +
      '<div><span aria-hidden="true">02</span><div><h3>费用报销</h3><p>费用发生后，整理实际支出与凭证。</p></div></div></div>' +
      '<p class="finance-notice">在线办理暂未开放，后续在这里统一查看申请进度。</p></section>';
  }

  function renderStudent() {
    const profile = state.dashboard.profile;
    const week = state.dashboard.week;
    const data = state.dashboard.student;
    const submitted = data.report.status === 'submitted';
    return [
      '<section class="welcome student-welcome"><div><p class="kicker">STUDENT WORKSPACE</p><h1>' + greeting() + '，' + escapeHtml(profile.name) + '</h1>',
      '<p>记录本周工作，继续学习与协作。</p></div><div class="welcome-tools">',
      '<button class="button button-ghost guide-help-link" type="button" data-open-onboarding>入组说明</button>',
      '<div class="deadline">◷ ' + escapeHtml(week.dueLabel) + '</div></div></section>',
      renderOnboardingEntry(),
      '<div class="student-home-layout"><div class="stack student-main">',
      '<section class="hero-card weekly-home-card"><div><p class="kicker">本周工作记录</p><h2>' + (submitted ? '本周工作记录已提交' : '记录这一周的进展') + '</h2>',
      '<p>' + escapeHtml(week.label || '') + '</p><div class="weekly-home-status">' + tag(data.report.label, submitted ? 'green' : 'orange') + '<span>项目进展、学习收获与下周计划</span></div><div class="action-row">',
      '<button class="button button-primary" type="button" data-open-report>' + (submitted ? '修改本周记录' : '填写本周记录') + '</button>',
      '<button class="button button-secondary" type="button" data-open-report-history>查看历史记录</button></div></div></section>',
      renderLiteratureSection(),
      '<details class="panel home-todos"><summary>本周待办</summary><div class="panel-title"><h2>本周待办</h2>' + tag(data.tasks.length + '项') + '</div><ol class="task-list">',
      data.tasks.map(function (item, index) {
        return '<li><span class="task-number">' + (index + 1) + '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.detail) + '</small></div>' + tag(item.type) + '</li>';
      }).join(''), '</ol></details>',
      renderCoursePanel(), '</div><aside class="stack student-side" aria-label="学习、申请与项目">',
      renderLearningCard(), renderFinancePlaceholder(),
      '<section class="panel project-home-card"><div class="panel-title"><h2>我的项目</h2>' + availableLink(data.project.url, '打开项目页') + '</div>',
      '<h3>' + escapeHtml(data.project.code + ' ' + data.project.title) + '</h3><p>' + escapeHtml(data.project.milestone) + '</p>',
      '<p class="project-note"><strong>最近阻塞：</strong>' + escapeHtml(data.project.blocker) + '</p></section>',
      '</aside></div>', footer()
    ].join('');
  }

  function renderTeacher() {
    const profile = state.dashboard.profile;
    const data = state.dashboard.teacher;
    return [
      '<section class="welcome"><div><p class="kicker">TEACHER WORKSPACE</p><h1>教师汇总页</h1><p>' + escapeHtml(profile.name) + '负责学生的周报、项目和培养进度。</p></div>',
      '<a class="button button-secondary" href="' + safeUrl(wikiUrl()) + '">打开飞书后台</a></section>',
      '<div class="metric-grid"><article class="metric-card"><span>本周已交</span><strong>' + data.stats.submitted + '</strong><small>已完成本周工作记录</small></article>',
      '<article class="metric-card alert"><span>本周未交</span><strong>' + data.stats.missing + '</strong><small>周五11:00自动提醒</small></article>',
      '<article class="metric-card alert"><span>需要关注</span><strong>' + data.stats.blocked + '</strong><small>存在项目或实验阻塞</small></article></div>',
      '<div class="dashboard-grid"><div class="stack"><section class="panel"><div class="panel-title"><h2>学生状态</h2><span>按负责关系显示</span></div><ul class="student-list">',
      data.students.map(function (student) {
        return '<li><span class="student-avatar">' + escapeHtml(student.name.slice(-1)) + '</span><div><strong>' + escapeHtml(student.name) +
          '</strong><small>' + escapeHtml(student.project + ' · ' + student.blocker) + '</small></div>' + tag(student.status, student.tone) +
          '<button type="button" data-student="' + escapeHtml(student.id) + '">查看详情</button></li>';
      }).join(''), data.students.length ? '' : '<li class="empty">当前没有分配给你的学生。</li>', '</ul></section></div><aside class="stack"><section class="panel"><div class="panel-title"><h2>本周共性问题</h2></div><ol class="task-list">',
      data.commonIssues.map(function (issue, index) { return '<li><span class="task-number">' + (index + 1) + '</span><div><strong>' + escapeHtml(issue) + '</strong></div></li>'; }).join(''),
      data.commonIssues.length ? '' : '<li class="empty">本周暂无共性阻塞。</li>',
      '</ol></section><section class="panel"><div class="panel-title"><h2>教师快捷入口</h2></div><ul class="link-list">',
      '<li><a href="' + safeUrl(wikiUrl()) + '"><span>课程与培训维护</span><span>›</span></a></li>',
      '<li><a href="' + safeUrl(wikiUrl()) + '"><span>项目里程碑</span><span>›</span></a></li>',
      '<li><a href="' + safeUrl(wikiUrl()) + '"><span>周报原始记录</span><span>›</span></a></li>',
      '</ul></section></aside></div>', renderCourseReviewPanel(), renderLiteratureSection(), footer()
    ].join('');
  }

  function renderDataSourceDiagnostics() {
    if (state.activeRole !== 'manager' || !state.dashboard?.profile?.roles?.includes('manager')) return '';
    return '<details class="panel data-source-diagnostics" id="weekly-source-panel"><summary>数据源诊断</summary>' +
      '<div class="data-source-diagnostics-body"><h3>周报数据源核对</h3><p>查看后端实际连接的周报表及字段配置。</p>' +
      '<button class="button button-secondary" type="button" id="weekly-source-button">查看当前连接的周报表</button>' +
      '<div id="weekly-source-result" aria-live="polite"></div></div></details>';
  }

  function renderManager() {
    const data = state.dashboard.manager;
    return [
      '<section class="welcome"><div><p class="kicker">MANAGEMENT WORKSPACE</p><h1>管理配置</h1><p>人员、项目、课程和自动化的统一状态。</p></div>',
      '<a class="button button-primary" href="' + safeUrl(wikiUrl()) + '">进入飞书管理后台</a></section>',
      '<div class="metric-grid"><article class="metric-card"><span>启用成员</span><strong>' + data.stats.members + '</strong><small>来自飞书人员表</small></article>',
      '<article class="metric-card"><span>进行中项目</span><strong>' + data.stats.projects + '</strong><small>具有负责人和成员</small></article>',
      '<article class="metric-card"><span>正式课程</span><strong>' + data.stats.courses + '</strong><small>Lesson与培训资料</small></article></div>',
      '<section class="panel"><div class="panel-title"><h2>自动化运行状态</h2><span>接入后显示真实日志</span></div><div class="table-wrap"><table><thead><tr><th>自动化</th><th>触发条件</th><th>对象</th><th>状态</th></tr></thead><tbody>',
      data.automations.map(function (item) {
        return '<tr><td>' + escapeHtml(item.name) + '</td><td>' + escapeHtml(item.trigger) + '</td><td>' +
          escapeHtml(item.target) + '</td><td><span class="' + (item.status.indexOf('支持') > -1 ? 'status-ok' : 'status-wait') + '">' + escapeHtml(item.status) + '</span></td></tr>';
      }).join(''), '</tbody></table></div></section>',
      '<div class="metric-grid" style="margin-top:22px"><a class="metric-card" href="' + safeUrl(wikiUrl()) + '"><span>人员与权限</span><strong>角色配置</strong><small>维护学生、教师、管理者和负责关系</small></a>',
      '<a class="metric-card" href="' + safeUrl(wikiUrl()) + '"><span>课程与知识</span><strong>内容维护</strong><small>课程、SOP、资料版本和大文件</small></a>',
      '<a class="metric-card" href="' + safeUrl(wikiUrl()) + '"><span>项目与周报</span><strong>原始数据</strong><small>项目成员、里程碑和历史记录</small></a></div>',
      renderDataSourceDiagnostics(), renderCourseReviewPanel(), renderLiteratureSection(), footer()
    ].join('');
  }

  function bindViewActions() {
    const sourceButton = elements.app.querySelector('#weekly-source-button');
    if (sourceButton) sourceButton.addEventListener('click', showWeeklySource);
    elements.app.querySelectorAll('[data-open-learning-center]').forEach(function (button) {
      button.addEventListener('click', openLearningCenter);
    });
    elements.app.querySelectorAll('[data-open-onboarding]').forEach(function (button) {
      button.addEventListener('click', openOnboardingDialog);
    });
    const reportButton = elements.app.querySelector('[data-open-report]');
    if (reportButton) reportButton.addEventListener('click', openReportDialog);
    const reportHistoryButton = elements.app.querySelector('[data-open-report-history]');
    if (reportHistoryButton) reportHistoryButton.addEventListener('click', openReportHistory);
    const literatureButton = elements.app.querySelector('[data-open-literature]');
    if (literatureButton) literatureButton.addEventListener('click', openLiteratureDialog);
    elements.app.querySelectorAll('[data-literature-detail]').forEach(function (button) {
      button.addEventListener('click', function () { openLiteratureDetail(button.dataset.literatureDetail); });
    });
    elements.app.querySelectorAll('[data-student]').forEach(function (button) {
      button.addEventListener('click', function () { openStudentDetail(button.dataset.student); });
    });
    elements.app.querySelectorAll('[data-course-lesson]').forEach(function (button) {
      button.addEventListener('click', function () { openCourseDialog(button.dataset.courseLesson); });
    });
    elements.app.querySelectorAll('[data-course-review]').forEach(function (button) {
      button.addEventListener('click', function () { openCourseReview(button.dataset.courseReview); });
    });
  }

  function showDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function detailSection(title, value, wide) {
    if (!value) return '';
    return '<section' + (wide ? ' class="detail-wide"' : '') + '><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(value).replace(/\n/g, '<br>') + '</p></section>';
  }

  function openReportDialog() {
    elements.reportWeekLabel.textContent = state.dashboard.week.label;
    elements.reportError.hidden = true;
    elements.reportReload.hidden = true;
    elements.reportForm.reset();
    const hasDraft = restoreDraft(elements.reportForm, draftKeys.report, ['progress', 'learning', 'evidence', 'blockers', 'nextPlan']);
    const report = state.dashboard.student.report || {};
    if (!hasDraft) setFormValues(elements.reportForm, report.values || {});
    let draft = {};
    try { draft = JSON.parse(privateDrafts.get(draftKeys.report, draftScope()) || '{}'); } catch (_) {}
    // A draft must retain the version it started from; never silently rebase it.
    state.reportBaseRevision = hasDraft ? (typeof draft?._baseRevision === 'string' ? draft._baseRevision : '') : (report.revision || '');
    showDialog(elements.reportDialog);
  }

  function historyMarkup(history) {
    return history.length ? history.map(function (report) {
      const values = report.values || {};
      const evidence = evidenceMarkup(values.evidence);
      return '<article class="history-record"><div class="history-record-head"><div><strong>' + escapeHtml(report.weekLabel || report.title || report.weekId || '历史周报') + '</strong><small>最近保存：' + escapeHtml(report.savedAt || report.submittedAt || report.date || '时间未记录') + '</small></div>' + tag(report.status || '已提交', report.feedback ? 'green' : '') + '</div><div class="literature-detail-grid">' +
        detailSection('本周完成与结果', values.progress, true) + detailSection('学习与方法', values.learning, true) +
        detailSection('当前问题与阻塞', values.blockers, true) + detailSection('下周计划', values.nextPlan, true) +
        detailSection('教师反馈', report.feedback, true) + '</div>' + evidence + '</article>';
    }).join('') : '<div class="empty">所选范围内还没有已提交的周报。</div>';
  }

  function openReportHistory() {
    state.reportHistory = { page: 1, pages: 1, loading: false, generation: 0 };
    elements.reportHistoryYear.value = '';
    elements.reportHistoryWeek.value = '';
    elements.reportHistoryBody.innerHTML = '';
    showDialog(elements.reportHistoryDialog);
    loadReportHistory(1);
  }

  async function loadReportHistory(page) {
    const view = state.reportHistory;
    if (!view) return;
    const generation = ++view.generation, owner = state.dashboard?.profile?.sub, session = state.session;
    const valid = () => state.reportHistory === view && generation === view.generation &&
      state.session === session && state.dashboard?.profile?.sub === owner && elements.reportHistoryDialog.open;
    view.loading = true;
    elements.reportHistoryPrev.disabled = elements.reportHistoryNext.disabled = true;
    elements.reportHistoryStatus.textContent = '正在读取历史记录…';
    try {
      const year = elements.reportHistoryYear.value, week = elements.reportHistoryWeek.value;
      const query = new URLSearchParams({ page: String(page), year, week });
      let result;
      if (DEMO_MODE) {
        const reports = state.dashboard.student.history || [];
        result = { reports, total: reports.length, page: 1, pages: 1, years: [] };
      } else result = await request('/api/reports/history?' + query);
      if (!valid()) return;
      if (!Array.isArray(result.reports) || !Number.isInteger(result.total) || !Number.isInteger(result.page) || !Number.isInteger(result.pages))
        throw new Error('历史记录返回不完整，请重新查询');
      const years = [...new Set([year].concat(result.years || []).filter(y => /^\d{4}$/.test(y)))].sort().reverse();
      elements.reportHistoryYear.innerHTML = '<option value="">全部年份</option>' + years.map(y =>
        '<option value="' + y + '">' + y + '年</option>').join('');
      elements.reportHistoryYear.value = year;
      view.page = result.page; view.pages = result.pages;
      elements.reportHistoryBody.innerHTML = historyMarkup(result.reports);
      elements.reportHistoryBody.scrollTop = 0;
      elements.reportHistoryStatus.textContent = '共 ' + result.total + ' 条 · 第 ' + result.page + ' / ' + result.pages + ' 页';
    } catch (error) {
      if (!valid()) return;
      elements.reportHistoryStatus.textContent = '读取失败：' + (error.message || '请稍后重试') + '。可点击“查询”重试；下方如有内容，为上次读取结果。';
    } finally {
      if (valid()) {
        view.loading = false;
        elements.reportHistoryPrev.disabled = view.page <= 1;
        elements.reportHistoryNext.disabled = view.page >= view.pages;
      }
    }
  }

  function openLiteratureDialog() {
    elements.literatureWeekLabel.textContent = state.dashboard.week.label + ' · 已提交 ' + Number((state.dashboard.literature || {}).mineCount || 0) + ' 篇';
    elements.literatureError.hidden = true;
    restoreDraft(elements.literatureForm, draftKeys.literature);
    showDialog(elements.literatureDialog);
  }

  function openLiteratureDetail(id) {
    const items = (state.dashboard.literature || {}).items || [];
    const item = items.find(function (entry) { return String(entry.id) === String(id); });
    if (!item) return showToast('这条阅读记录暂时不可用');
    elements.literatureDetailTitle.textContent = item.title || '文献阅读详情';
    elements.literatureDetailMeta.textContent = [item.submitter, item.role, item.weekId, item.date].filter(Boolean).join(' · ');
    const links = [
      item.noteUrl ? availableLink(item.noteUrl, '打开飞书阅读笔记', 'button button-primary') : '',
      item.paperUrl ? availableLink(item.paperUrl, '打开论文网页', 'button button-secondary') : '',
      item.attachmentUrl ? availableLink(item.attachmentUrl, '打开论文附件', 'button button-secondary') : ''
    ].filter(Boolean).join('');
    elements.literatureDetailBody.innerHTML = '<div class="literature-detail-grid">' +
      detailSection('作者', item.authors) + detailSection('会议或期刊', [item.venue, item.year].filter(Boolean).join(' · ')) +
      detailSection('DOI / arXiv', item.doi) + detailSection('研究方向与类型', [item.direction, item.type].filter(Boolean).join(' · ')) +
      detailSection('一句话贡献', item.contribution, true) + detailSection('核心问题', item.coreProblem, true) +
      detailSection('方法摘要', item.method, true) + detailSection('个人评价', item.review, true) + detailSection('与项目关系', item.projectRelation, true) +
      '</div><div class="action-row literature-detail-links">' + links + '</div>';
    showDialog(elements.literatureDetailDialog);
  }

  function courseDraftKey(lessonId) {
    return 'er2-draft-course-' + lessonId;
  }

  function openCourseDialog(lessonId) {
    if (!courseSubmissionAvailable()) return showToast('课程提交暂未开放，请在本周工作记录中填写学习与方法。');
    const course = state.dashboard.student.course || {};
    const lesson = (course.lessons || []).find(function (item) { return String(item.lessonId) === String(lessonId); });
    if (!lesson) return showToast('课程记录暂时不可用');
    state.activeLessonId = lesson.lessonId;
    elements.courseForm.reset();
    elements.courseLessonId.value = lesson.lessonId;
    elements.courseDialogTitle.textContent = 'Lesson ' + lesson.lessonId + '｜' + lesson.lessonTitle;
    elements.courseDialogPrompt.textContent = lesson.prompt || '';
    elements.courseSummaryField.hidden = lesson.lessonId !== '10';
    const summaryInput = elements.courseForm.elements.namedItem('courseSummary');
    summaryInput.required = lesson.lessonId === '10';
    const savedDraft = lesson.canEdit && restoreDraft(elements.courseForm, courseDraftKey(lesson.lessonId));
    if (!savedDraft) setFormValues(elements.courseForm, lesson);
    const readOnly = lesson.canEdit === false;
    Array.from(elements.courseForm.querySelectorAll('textarea')).forEach(function (field) { field.readOnly = readOnly; });
    elements.courseSubmit.hidden = readOnly;
    elements.courseSubmit.disabled = false;
    elements.courseSubmit.textContent = lesson.recordId ? '更新本课记录' : '正式提交';
    elements.courseConfirmationNote.hidden = !lesson.confirmationComment;
    elements.courseConfirmationNote.textContent = lesson.confirmationComment ? '朱俊杰说明：' + lesson.confirmationComment : '';
    elements.courseError.hidden = true;
    showDialog(elements.courseDialog);
  }

  function openCourseReview(recordId) {
    const review = state.dashboard.teacher && state.dashboard.teacher.courseReview;
    const item = review && (review.submissions || []).find(function (entry) { return String(entry.recordId) === String(recordId); });
    if (!item) return showToast('课程提交记录暂时不可用');
    state.activeCourseRecordId = item.recordId;
    elements.courseReviewTitle.textContent = item.studentName + ' · Lesson ' + item.lessonId;
    elements.courseReviewMeta.textContent = item.lessonTitle + ' · ' + item.statusLabel + (item.submittedAt ? ' · ' + item.submittedAt : '');
    elements.courseReviewBody.innerHTML = '<div class="literature-detail-grid">' +
      detailSection('核心收获', item.coreLearning, true) + detailSection('问题与处理', item.problems, true) +
      detailSection('课程总结', item.courseSummary, true) + detailSection('其他', item.other, true) +
      detailSection('已有确认说明', item.confirmationComment, true) + '</div>';
    const canAct = Boolean(review.canConfirm && item.status !== 'confirmed');
    elements.courseConfirmForm.hidden = !canAct;
    elements.courseReviewRecordId.value = item.recordId;
    elements.courseReviewComment.value = item.confirmationComment || '';
    elements.courseReviewError.hidden = true;
    showDialog(elements.courseReviewDialog);
  }

  function openStudentDetail(id) {
    const student = (state.dashboard.teacher.students || []).find(function (item) { return String(item.id) === String(id); });
    if (!student) return showToast('学生信息暂时不可用');
    state.activeStudentId = student.id;
    elements.studentDetailTitle.textContent = student.name;
    elements.studentDetailMeta.textContent = [student.track, student.project, student.status].filter(Boolean).join(' · ');
    const report = student.currentReport;
    if (report) {
      const values = report.values || {};
      const evidence = evidenceMarkup(values.evidence);
      const previous = (student.history || []).filter(function (item) { return item.recordId !== report.recordId; }).slice(0, 3);
      const previousHtml = previous.length ? '<div class="student-history"><h3>最近历史记录</h3>' + previous.map(function (item) {
        return '<div><span><strong>' + escapeHtml(item.weekId || '历史周报') + '</strong><small>' + escapeHtml(item.submittedAt || '') + '</small></span>' + tag(item.feedback ? '已反馈' : '已提交', item.feedback ? 'green' : '') + '</div>';
      }).join('') + '</div>' : '';
      elements.studentDetailBody.innerHTML = '<div class="student-report-summary"><span>本周周报</span><strong>' + escapeHtml(report.weekId || '') + ' · ' + escapeHtml(report.submittedAt || '') + '</strong></div><div class="literature-detail-grid">' +
        detailSection('本周完成与结果', values.progress, true) + detailSection('学习与方法', values.learning, true) +
        detailSection('当前问题与阻塞', values.blockers, true) + detailSection('下周计划', values.nextPlan, true) +
        detailSection('已有教师反馈', report.feedback, true) + '</div>' + evidence + previousHtml;
      elements.feedbackForm.hidden = false;
      elements.feedbackRecordId.value = report.recordId || '';
      elements.feedbackComment.value = report.feedback || '';
    } else {
      elements.studentDetailBody.innerHTML = '<div class="empty">该学生本周尚未提交周报。</div>';
      elements.feedbackForm.hidden = true;
      elements.feedbackRecordId.value = '';
      elements.feedbackComment.value = '';
    }
    elements.feedbackError.hidden = true;
    showDialog(elements.studentDetailDialog);
  }

  async function submitReport(event) {
    event.preventDefault();
    if (elements.reportSubmit.disabled) return;
    if (!elements.reportForm.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(elements.reportForm).entries());
    fields.baseRevision = state.reportBaseRevision || '';
    const intent = JSON.stringify(fields);
    if (privateDrafts.get('er2-report-intent', draftScope()) !== intent) {
      privateDrafts.remove('er2-request-report', draftScope());
      privateDrafts.set('er2-report-intent', draftScope(), intent);
    }
    fields.requestId = pendingRequestId('er2-request-report', 'weekly');
    elements.reportSubmit.disabled = true;
    elements.reportSubmit.textContent = '正在提交…';
    elements.reportError.hidden = true;
    try {
      let saved;
      if (DEMO_MODE) {
        await new Promise(function (resolve) { setTimeout(resolve, 500); });
      } else {
        saved = await request('/api/reports', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Request-ID': fields.requestId,
            'Authorization': 'Bearer ' + state.session
          },
          body: JSON.stringify(Object.assign({ weekId: state.dashboard.week.id }, fields))
        });
        if (saved.readBackVerified !== true || !saved.report) throw new Error('后端未返回保存读回确认，草稿已保留；请管理员核对部署版本。');
      }
      state.dashboard.student.report = {
        status: 'submitted',
        label: '已提交',
        submittedAt: new Date().toISOString(),
        values: {
          progress: fields.progress || '',
          learning: fields.learning || '',
          evidence: fields.evidence || '',
          blockers: fields.blockers || '',
          nextPlan: fields.nextPlan || ''
        }
      };
      const historyEntry = saved && saved.report ? saved.report : {
        recordId: '',
        weekId: state.dashboard.week.id,
        submittedAt: new Date().toLocaleDateString('en-CA'),
        status: '已提交',
        feedback: '',
        values: state.dashboard.student.report.values
      };
      if (saved && saved.report) {
        state.dashboard.student.report.values = saved.report.values;
        state.dashboard.student.report.submittedAt = saved.report.submittedAt;
        state.dashboard.student.report.revision = saved.report.revision || '';
        state.reportBaseRevision = saved.report.revision || '';
      }
      const previousHistory = state.dashboard.student.history || [];
      state.dashboard.student.history = [historyEntry].concat(previousHistory.filter(function (item) {
        return item.weekId !== state.dashboard.week.id;
      })).slice(0, 12);
      closeDialog(elements.reportDialog);
      elements.reportForm.reset();
      clearDraft(draftKeys.report);
      privateDrafts.remove('er2-request-report', draftScope());
      privateDrafts.remove('er2-report-intent', draftScope());
      renderActiveView();
      showToast('本周工作记录已提交');
      // Refresh the same source for dual-role users. Never turn a confirmed
      // save into a submission failure if this secondary refresh is unavailable.
      if (!DEMO_MODE) {
        try {
          const fresh = await request('/api/weekly');
          if (state.dashboard && fresh.week?.id === state.dashboard.week.id && fresh.student && fresh.teacher) {
            state.dashboard.student = Object.assign({}, state.dashboard.student, fresh.student);
            state.dashboard.teacher = Object.assign({}, state.dashboard.teacher, fresh.teacher);
            renderActiveView();
          }
        } catch (_) { /* Confirmed report/history already remain visible above. */ }
      }
    } catch (error) {
      elements.reportError.textContent = error.message || '提交失败，请稍后重试';
      elements.reportError.hidden = false;
      elements.reportReload.hidden = error.status !== 409;
    } finally {
      elements.reportSubmit.disabled = false;
      elements.reportSubmit.textContent = '提交本周记录';
    }
  }

  async function reloadSavedReport() {
    const session = state.session, weekId = state.dashboard?.week?.id;
    elements.reportReload.disabled = true;
    try {
      const fresh = await request('/api/weekly');
      if (state.session !== session || !elements.reportDialog.open) return;
      if (fresh.week?.id !== weekId || !fresh.student?.report)
        throw new Error('当前周已变化或读取不完整，请先保留草稿，再重新打开工作台');
      if (!window.confirm('载入已保存记录将替换当前表单中的草稿。请先复制需要保留的文字。确定载入吗？')) return;
      clearDraft(draftKeys.report);
      privateDrafts.remove('er2-request-report', draftScope());
      privateDrafts.remove('er2-report-intent', draftScope());
      state.dashboard.student.report = fresh.student.report;
      openReportDialog();
    } catch (error) {
      if (state.session !== session || !elements.reportDialog.open) return;
      elements.reportError.textContent = error.message || '读取失败，草稿已保留';
      elements.reportError.hidden = false;
    } finally { elements.reportReload.disabled = false; }
  }

  async function submitLiterature(event) {
    event.preventDefault();
    if (!elements.literatureForm.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(elements.literatureForm).entries());
    fields.requestId = pendingRequestId('er2-request-literature', 'literature');
    elements.literatureSubmit.disabled = true;
    elements.literatureSubmit.textContent = '正在提交…';
    elements.literatureError.hidden = true;
    try {
      if (DEMO_MODE) {
        await new Promise(function (resolve) { setTimeout(resolve, 420); });
        const saved = readDemoLiterature();
        const item = Object.assign({}, fields, {
          id: 'demo-' + Date.now(),
          submitter: state.dashboard.profile.name,
          role: roleMeta[state.activeRole].label,
          weekId: state.dashboard.week.id,
          date: new Date().toLocaleDateString('en-CA'),
          submittedAt: new Date().toISOString()
        });
        saved.unshift(item);
        localStorage.setItem('er2-demo-literature', JSON.stringify(saved.slice(0, 50)));
        state.dashboard.literature.items.unshift(item);
        state.dashboard.literature.mineCount += 1;
        state.dashboard.literature.completed = state.dashboard.literature.mineCount >= state.dashboard.literature.minimum;
      } else {
        const result = await request('/api/literature', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Request-ID': fields.requestId,
            'Authorization': 'Bearer ' + state.session
          },
          body: JSON.stringify(Object.assign({ weekId: state.dashboard.week.id }, fields))
        });
        state.dashboard.literature = result.literature;
      }
      closeDialog(elements.literatureDialog);
      elements.literatureForm.reset();
      clearDraft(draftKeys.literature);
      privateDrafts.remove('er2-request-literature', draftScope());
      renderActiveView();
      showToast('文献阅读已提交，课题组成员现在可以查看');
    } catch (error) {
      elements.literatureError.textContent = error.message || '提交失败，请稍后重试';
      elements.literatureError.hidden = false;
    } finally {
      elements.literatureSubmit.disabled = false;
      elements.literatureSubmit.textContent = '提交阅读记录';
    }
  }

  async function submitCourse(event) {
    event.preventDefault();
    if (!courseSubmissionAvailable()) return showToast('课程提交暂未开放，请在本周工作记录中填写学习与方法。');
    if (!elements.courseForm.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(elements.courseForm).entries());
    const requestKey = draftKeys.courseRequest + '-' + fields.lessonId;
    fields.requestId = pendingRequestId(requestKey, 'course-' + fields.lessonId);
    elements.courseSubmit.disabled = true;
    elements.courseSubmit.textContent = '正在提交…';
    elements.courseError.hidden = true;
    try {
      if (DEMO_MODE) {
        await new Promise(function (resolve) { setTimeout(resolve, 350); });
        const lesson = (state.dashboard.student.course.lessons || []).find(function (item) { return item.lessonId === fields.lessonId; });
        if (lesson) Object.assign(lesson, fields, { recordId: lesson.recordId || 'demo-course-' + fields.lessonId, status: 'submitted', statusLabel: '等待朱俊杰确认', canEdit: true, submittedAt: new Date().toLocaleDateString('en-CA') });
      } else {
        await request('/api/courses/submit', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Request-ID': fields.requestId,
            'Authorization': 'Bearer ' + state.session
          },
          body: JSON.stringify(fields)
        });
      }
      clearDraft(courseDraftKey(fields.lessonId));
      privateDrafts.remove(requestKey, draftScope());
      closeDialog(elements.courseDialog);
      if (DEMO_MODE) renderActiveView();
      else await loadDashboard(state.activeRole);
      showToast('Lesson ' + fields.lessonId + '已提交，等待朱俊杰确认');
    } catch (error) {
      elements.courseError.textContent = error.message || '课程记录提交失败，请稍后重试';
      elements.courseError.hidden = false;
    } finally {
      elements.courseSubmit.disabled = false;
      elements.courseSubmit.textContent = '正式提交';
    }
  }

  async function submitCourseReview(action) {
    const comment = elements.courseReviewComment.value.trim();
    if (action === 'supplement' && !comment) {
      elements.courseReviewError.textContent = '选择“需要补充”时，请填写具体补充说明';
      elements.courseReviewError.hidden = false;
      elements.courseReviewComment.focus();
      return;
    }
    const requestKey = draftKeys.courseReviewRequest + '-' + state.activeCourseRecordId + '-' + action;
    const fields = {
      recordId: state.activeCourseRecordId,
      action,
      comment,
      requestId: pendingRequestId(requestKey, 'course-review')
    };
    elements.courseConfirmButton.disabled = true;
    elements.courseSupplementButton.disabled = true;
    elements.courseReviewError.hidden = true;
    try {
      let result = { completion: { completed: false, notified: false } };
      if (!DEMO_MODE) {
        result = await request('/api/courses/confirm', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Request-ID': fields.requestId,
            'Authorization': 'Bearer ' + state.session
          },
          body: JSON.stringify(fields)
        });
      }
      privateDrafts.remove(requestKey, draftScope());
      closeDialog(elements.courseReviewDialog);
      if (!DEMO_MODE) await loadDashboard(state.activeRole);
      else renderActiveView();
      if (result.completion && result.completion.notified) showToast('课程已确认，并已向陈铮一教授发送结业通知');
      else showToast(action === 'confirm' ? '已确认该课程记录' : '已通知学生补充课程记录');
    } catch (error) {
      elements.courseReviewError.textContent = error.message || '课程确认失败，请稍后重试';
      elements.courseReviewError.hidden = false;
    } finally {
      elements.courseConfirmButton.disabled = false;
      elements.courseSupplementButton.disabled = false;
    }
  }

  async function submitTeacherFeedback(event) {
    event.preventDefault();
    if (!elements.feedbackForm.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(elements.feedbackForm).entries());
    fields.requestId = pendingRequestId(draftKeys.feedbackRequest, 'review');
    elements.feedbackSubmit.disabled = true;
    elements.feedbackSubmit.textContent = '正在提交…';
    elements.feedbackError.hidden = true;
    try {
      if (!DEMO_MODE) {
        await request('/api/teacher/review', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Request-ID': fields.requestId,
            'Authorization': 'Bearer ' + state.session
          },
          body: JSON.stringify(fields)
        });
      }
      const student = (state.dashboard.teacher.students || []).find(function (item) { return String(item.id) === String(state.activeStudentId); });
      if (student && student.currentReport) {
        student.currentReport.feedback = fields.comment;
        student.currentReport.status = '已反馈';
      }
      privateDrafts.remove(draftKeys.feedbackRequest, draftScope());
      closeDialog(elements.studentDetailDialog);
      renderActiveView();
      showToast('教师反馈已保存');
    } catch (error) {
      elements.feedbackError.textContent = error.message || '反馈提交失败，请稍后重试';
      elements.feedbackError.hidden = false;
    } finally {
      elements.feedbackSubmit.disabled = false;
      elements.feedbackSubmit.textContent = '保存教师反馈';
    }
  }

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
  }

  function hydrateDemoLinks() {
    if (!DEMO_MODE) return;
    const findUrl = function (predicate) {
      return (state.catalog.find(predicate) || {}).url || '#';
    };
    demoData.student.project.url = findUrl(function (item) { return item.category === '项目'; });
    demoData.student.links[0].url = findUrl(function (item) { return item.title.indexOf('历史周报') > -1; });
    demoData.student.links[1].url = findUrl(function (item) { return item.title.indexOf('设备') > -1; });
    demoData.student.links[2].url = findUrl(function (item) { return item.title.indexOf('设备') > -1; });
    demoData.student.links[3].url = findUrl(function (item) { return item.category === '知识库'; });
  }

  function runSearch(event) {
    event.preventDefault();
    const query = elements.searchInput.value.trim();
    if (!query) return showToast('请输入课程、项目、设备或SOP关键词');
    const term = normalize(query);
    const matches = state.catalog.filter(function (item) {
      return normalize([item.title, item.subtitle, item.category].concat(item.keywords || []).join(' ')).includes(term);
    }).slice(0, 12);
    elements.searchSummary.textContent = matches.length ? '找到 ' + matches.length + ' 个入口；正文与大文件仍在飞书。' : '未找到“' + query + '”';
    elements.searchResults.innerHTML = matches.length ? matches.map(function (item) {
      const safe = safeUrl(item.url);
      const tagName = safe === '#' ? 'div' : 'a';
      const href = safe === '#' ? '' : ' href="' + safe + '"';
      return '<' + tagName + ' class="search-result' + (safe === '#' ? ' unavailable' : '') + '"' + href + '><span>' + escapeHtml(item.category.slice(0,2)) +
        '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.subtitle) + (safe === '#' ? ' · 登录后由飞书工作台提供入口' : '') + '</small></div><b>' + (safe === '#' ? '—' : '→') + '</b></' + tagName + '>';
    }).join('') : '<div class="empty">可以尝试“周报”“ROS”“D435”“项目”或“SOP”</div>';
    showDialog(elements.searchDialog);
  }

  document.querySelectorAll('[data-close-dialog]').forEach(function (button) {
    button.addEventListener('click', function () {
      const dialog = document.getElementById(button.dataset.closeDialog);
      if (dialog) closeDialog(dialog);
    });
  });
  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-missing-link]');
    if (!button) return;
    showToast('“' + button.dataset.missingLink + '”尚未配置飞书链接，请管理员在门户链接表中补充');
  });
  [elements.reportDialog, elements.reportHistoryDialog, elements.literatureDialog, elements.searchDialog, elements.literatureDetailDialog, elements.studentDetailDialog, elements.courseDialog, elements.courseReviewDialog, elements.onboardingDialog].filter(Boolean).forEach(function (dialog) {
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) closeDialog(dialog);
    });
  });
  document.getElementById('guide-skip-button').addEventListener('click', skipMemberGuide);
  window.addEventListener('storage', function (event) {
    if (!state.dashboard || !memberGuide.ownsStorageKey(event.key)) return;
    renderActiveView();
    if (elements.onboardingDialog.open) renderOnboardingDialog();
  });
  async function showWeeklySource() {
    if (state.activeRole !== 'manager' || !state.dashboard?.profile?.roles?.includes('manager')) return;
    const output = document.getElementById('weekly-source-result');
    const button = document.getElementById('weekly-source-button');
    if (!output || !button || button.disabled) return;
    const owner = state.dashboard.profile.sub;
    const stillVisible = () => state.activeRole === 'manager' && state.dashboard?.profile?.sub === owner &&
      state.dashboard?.profile?.roles?.includes('manager') && document.getElementById('weekly-source-result') === output;
    button.disabled = true;
    output.textContent = '正在读取服务器实际配置…';
    try {
      const source = await request('/api/admin/weekly-source' + (config.feishuDocsOrigin ? '?docsOrigin=' + encodeURIComponent(config.feishuDocsOrigin) : ''));
      if (!stillVisible()) return;
      output.innerHTML = '<p>' + escapeHtml(source.baseName + ' / ' + source.tableName) + '</p><p>表 ID：' + escapeHtml(source.tableId) + '</p>' +
        (source.tableUrl ? availableLink(source.tableUrl, '打开实际连接的周报表', 'button button-secondary') : '<p>未返回直达地址，请核对飞书文档域名配置。</p>') +
        (source.schema ? '<p>' + (source.schema.ok ? '当前写入字段检查通过；仍需实际提交验收。' : escapeHtml('待修复字段：' + source.schema.missing.concat(source.schema.incompatible).join('、'))) + '</p>' : '');
    } catch (error) { if (stillVisible()) output.textContent = error.message; }
    finally { button.disabled = false; }
  }
  document.getElementById('retry-button').addEventListener('click', function () { loadDashboard(state.activeRole); });
  elements.reportForm.addEventListener('submit', submitReport);
  elements.reportReload.addEventListener('click', reloadSavedReport);
  elements.literatureForm.addEventListener('submit', submitLiterature);
  elements.courseForm.addEventListener('submit', submitCourse);
  elements.courseConfirmForm.addEventListener('submit', function (event) { event.preventDefault(); submitCourseReview('confirm'); });
  elements.courseSupplementButton.addEventListener('click', function () { submitCourseReview('supplement'); });
  elements.feedbackForm.addEventListener('submit', submitTeacherFeedback);
  document.getElementById('report-history-filter').addEventListener('submit', function (event) { event.preventDefault(); loadReportHistory(1); });
  elements.reportHistoryPrev.addEventListener('click', function () { if (!state.reportHistory?.loading) loadReportHistory(state.reportHistory.page - 1); });
  elements.reportHistoryNext.addEventListener('click', function () { if (!state.reportHistory?.loading) loadReportHistory(state.reportHistory.page + 1); });
  elements.reportForm.addEventListener('input', function () { saveDraft(elements.reportForm, draftKeys.report); });
  elements.literatureForm.addEventListener('input', function () { saveDraft(elements.literatureForm, draftKeys.literature); });
  elements.courseForm.addEventListener('input', function () {
    const lessonId = elements.courseLessonId.value;
    if (lessonId) saveDraft(elements.courseForm, courseDraftKey(lessonId));
  });
  elements.searchForm.addEventListener('submit', runSearch);
  elements.logoutButton.addEventListener('click', function () {
    privateDrafts.clear();
    sessionStorage.removeItem('er2-session');
    privateDrafts.remove('er2-request-report', draftScope());
    privateDrafts.remove('er2-request-literature', draftScope());
    privateDrafts.remove(draftKeys.feedbackRequest, draftScope());
    sessionStorage.removeItem(draftKeys.courseRequest);
    sessionStorage.removeItem(draftKeys.courseReviewRequest);
    memberGuide.bind('');
    state.session = '';
    location.href = API_BASE + '/auth/launch?returnTo=' + encodeURIComponent(location.origin + location.pathname);
  });

  fetch('./data/catalog.json')
    .then(function (response) { return response.ok ? response.json() : []; })
    .then(function (data) {
      state.catalog = Array.isArray(data) ? data : [];
      hydrateDemoLinks();
    })
    .catch(function () { state.catalog = []; })
    .finally(function () { loadDashboard(new URLSearchParams(location.search).get('view')); });
}());
