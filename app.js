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
    { id: 'feishu-access', icon: '⌁', title: '确认飞书权限', detail: '确认可以打开工作台、学习中心和周报入口' },
    { id: 'lab-rules', icon: '◇', title: '阅读实验室基本规则', detail: '了解安全、保密、设备和文件命名规范' },
    { id: 'environment', icon: '▣', title: '完成基础环境准备', detail: '确认 Ubuntu、ROS 与课程代码包能够正常运行' },
    { id: 'track-a', icon: '⌘', title: '确认当前学习方向', detail: '当前开放：Track A｜感知与语义导航' },
    { id: 'test-submit', icon: '➤', title: '完成一次测试提交', detail: '确认本周记录能够正常保存' }
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
    reportWeekLabel: document.getElementById('report-week-label'),
    reportHistoryDialog: document.getElementById('report-history-dialog'),
    reportHistoryBody: document.getElementById('report-history-body'),
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

  const state = {
    session: readSession(),
    activeRole: 'student',
    activeStudentId: '',
    activeLessonId: '',
    activeCourseRecordId: '',
    onboardingSaving: false,
    dashboard: null,
    catalog: [],
    toastTimer: null
  };

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
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = createRequestId(prefix);
    sessionStorage.setItem(key, created);
    return created;
  }

  function availableLink(url, label, className) {
    const safe = safeUrl(url);
    if (safe === '#') return '<button class="' + escapeHtml(className || 'text-link') + ' link-unconfigured" type="button" data-missing-link="' + escapeHtml(label) + '" title="该入口尚未由管理员配置">' + escapeHtml(label) + '</button>';
    return '<a class="' + escapeHtml(className || 'text-link') + '" href="' + safe + '">' + escapeHtml(label) + '</a>';
  }

  function saveDraft(form, key) {
    const values = Object.fromEntries(new FormData(form).entries());
    sessionStorage.setItem(key, JSON.stringify(values));
  }

  function restoreDraft(form, key) {
    let values = {};
    try { values = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch (_) { values = {}; }
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
    sessionStorage.removeItem(key);
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

  async function request(path, options) {
    const response = await fetch(API_BASE + path, Object.assign({
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
    if (!response.ok) throw new Error(payload.message || '请求失败（' + response.status + '）');
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
        data = await request('/api/dashboard' + (role ? '?role=' + encodeURIComponent(role) : ''));
      }
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
    } catch (error) {
      showError('工作台暂时无法载入', error.message || '请稍后重试');
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
    return dashboardLink(['课程', '学习中心', '培训']) ||
      (state.catalog.find(function (item) { return item.category === '课程' && safeUrl(item.url) !== '#'; }) || {}).url || wikiUrl();
  }

  function footer() {
    return '<footer><span>ER² Lab统一工作台 · 数据与大文件由飞书承载</span>' +
      availableLink(wikiUrl(), '打开ER²知识库') + '</footer>';
  }

  function onboardingData() {
    const stored = state.dashboard && state.dashboard.student && state.dashboard.student.onboarding;
    const completedSteps = Array.isArray(stored && stored.completedSteps) ? stored.completedSteps : [];
    return {
      version: 1,
      completedSteps,
      completedCount: completedSteps.length,
      total: onboardingSteps.length,
      completed: completedSteps.length === onboardingSteps.length
    };
  }

  function renderOnboardingEntry() {
    const onboarding = onboardingData();
    if (onboarding.completed) {
      return '<section class="onboarding-shortcut" aria-label="入组资料与规则"><div class="onboarding-shortcut-copy"><span aria-hidden="true">✓</span><div><strong>入组资料与规则</strong><small>入组准备已完成，需要时可随时查看</small></div></div><button class="button button-ghost" type="button" data-open-onboarding>查看</button></section>';
    }
    const remaining = onboarding.total - onboarding.completedCount;
    const progress = Math.round((onboarding.completedCount / onboarding.total) * 100);
    return '<section class="onboarding-banner"><div class="onboarding-icon" aria-hidden="true">✦</div><div><h2>新生入组 · 还剩 ' + remaining + ' 项</h2><p>先完成必要的权限、规则、环境与测试确认；全部完成后自动缩小为“入组资料与规则”入口。</p><div class="onboarding-banner-progress"><div class="progress-track" role="progressbar" aria-label="入组进度" aria-valuemin="0" aria-valuemax="5" aria-valuenow="' + onboarding.completedCount + '"><span style="width:' + progress + '%"></span></div><strong>' + onboarding.completedCount + ' / ' + onboarding.total + '</strong></div></div><button class="button button-primary" type="button" data-open-onboarding>继续入组</button></section>';
  }

  function renderOnboardingDialog() {
    const onboarding = onboardingData();
    const completed = new Set(onboarding.completedSteps);
    const remaining = onboarding.total - onboarding.completedCount;
    const progress = Math.round((onboarding.completedCount / onboarding.total) * 100);
    elements.onboardingProgressLabel.textContent = onboarding.completedCount + ' / ' + onboarding.total + ' 已完成';
    elements.onboardingProgressHint.textContent = onboarding.completed ? '入组准备已全部完成' : '还需完成 ' + remaining + ' 项';
    elements.onboardingProgressTrack.setAttribute('aria-valuenow', String(onboarding.completedCount));
    elements.onboardingProgressTrack.querySelector('span').style.width = progress + '%';
    elements.onboardingChecklist.innerHTML = onboardingSteps.map(function (step) {
      const done = completed.has(step.id);
      return '<article class="onboarding-check-item ' + (done ? 'completed' : '') + '"><span class="onboarding-step-icon" aria-hidden="true">' + escapeHtml(done ? '✓' : step.icon) + '</span><div><strong>' + escapeHtml(step.title) + '</strong><small>' + escapeHtml(step.detail) + '</small></div><button class="button button-secondary onboarding-step-action" type="button" data-complete-onboarding="' + escapeHtml(step.id) + '"' + (done || state.onboardingSaving ? ' disabled' : '') + '>' + (done ? '已完成' : '标记完成') + '</button></article>';
    }).join('');
    elements.onboardingCourseEntry.innerHTML = onboarding.completed
      ? availableLink(courseUrl(), '进入学习中心', 'button button-primary')
      : '<button class="button button-secondary" type="button" disabled>完成 5 项后进入学习中心</button>';
    elements.onboardingChecklist.querySelectorAll('[data-complete-onboarding]').forEach(function (button) {
      button.addEventListener('click', function () { saveOnboardingStep(button.dataset.completeOnboarding); });
    });
  }

  function openOnboardingDialog() {
    elements.onboardingSaveStatus.textContent = '每项完成后自动保存';
    elements.onboardingSaveStatus.className = '';
    renderOnboardingDialog();
    showDialog(elements.onboardingDialog);
  }

  async function saveOnboardingStep(stepId) {
    if (state.onboardingSaving || !onboardingSteps.some(function (step) { return step.id === stepId; })) return;
    const current = onboardingData();
    if (current.completedSteps.includes(stepId)) return;
    const completedSteps = current.completedSteps.concat(stepId);
    state.onboardingSaving = true;
    elements.onboardingSaveStatus.textContent = '正在保存…';
    elements.onboardingSaveStatus.className = 'saving';
    renderOnboardingDialog();
    try {
      let next = {
        version: 1,
        completedSteps,
        completedCount: completedSteps.length,
        total: onboardingSteps.length,
        completed: completedSteps.length === onboardingSteps.length
      };
      if (!DEMO_MODE) {
        const result = await request('/api/onboarding', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Request-ID': createRequestId('onboarding'),
            'Authorization': 'Bearer ' + state.session
          },
          body: JSON.stringify({ completedSteps })
        });
        next = result.onboarding;
      }
      state.dashboard.student.onboarding = next;
      elements.onboardingSaveStatus.textContent = '已自动保存';
      elements.onboardingSaveStatus.className = 'saved';
      if (next.completed) {
        closeDialog(elements.onboardingDialog);
        renderActiveView();
        showToast('入组准备已完成，入口已自动收起');
      } else {
        renderOnboardingDialog();
      }
    } catch (error) {
      elements.onboardingSaveStatus.textContent = error.message || '保存失败，请重试';
      elements.onboardingSaveStatus.className = '';
      renderOnboardingDialog();
    } finally {
      state.onboardingSaving = false;
      if (elements.onboardingDialog.open && !onboardingData().completed) renderOnboardingDialog();
    }
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

  function renderCoursePanel() {
    const course = state.dashboard.student.course || { lessons: [], otherTracks: [], completed: 0, total: 10, progress: 0 };
    const lessons = Array.isArray(course.lessons) ? course.lessons : [];
    const otherTracks = Array.isArray(course.otherTracks) ? course.otherTracks : [];
    return [
      '<section class="panel course-panel"><div class="course-panel-head"><div><p class="kicker">TRACK A TRAINING</p><h2>' + escapeHtml(course.title || 'Track A｜感知与语义导航') + '</h2>',
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

  function renderActiveView() {
    if (state.activeRole === 'teacher') elements.app.innerHTML = renderTeacher();
    else if (state.activeRole === 'manager') elements.app.innerHTML = renderManager();
    else elements.app.innerHTML = renderStudent();
    bindViewActions();
  }

  function renderStudent() {
    const profile = state.dashboard.profile;
    const week = state.dashboard.week;
    const data = state.dashboard.student;
    const submitted = data.report.status === 'submitted';
    return [
      '<section class="welcome"><div><p class="kicker">STUDENT WORKSPACE</p><h1>' + greeting() + '，' + escapeHtml(profile.name) + '</h1>',
      '<p>这里只展示与你有关的任务、课程、项目和记录。</p></div>',
      '<div class="deadline">◷ ' + escapeHtml(week.dueLabel) + '</div></section>',
      renderOnboardingEntry(),
      '<section class="hero-card"><div><p class="kicker">本周唯一提交</p><h2>' + (submitted ? '本周工作记录已提交' : '完成本周工作记录') + '</h2>',
      '<p>项目进度、培训学习、产出证据、问题和下一步统一记录，预计5–8分钟。</p><div class="action-row">',
      '<button class="button button-primary" type="button" data-open-report>' + (submitted ? '修改本周记录' : '立即填写') + '</button>',
      '<button class="button button-secondary" type="button" data-open-report-history>查看历史记录</button></div></div>',
      '<div class="status-panel"><div><span>本周周报</span><strong>' + escapeHtml(data.report.label) + '</strong></div>',
      '<div><span>当前项目</span><strong>' + escapeHtml(data.project.code + ' ' + data.project.title) + '</strong></div>',
      '<div><span>课程进度</span><strong>' + escapeHtml(data.course.completed + ' / ' + data.course.total) + '</strong></div></div></section>',
      '<div class="dashboard-grid"><div class="stack">',
      '<section class="panel"><div class="panel-title"><h2>本周待办</h2>' + tag(data.tasks.length + '项') + '</div><ol class="task-list">',
      data.tasks.map(function (item, index) {
        return '<li><span class="task-number">' + (index + 1) + '</span><div><strong>' + escapeHtml(item.title) +
          '</strong><small>' + escapeHtml(item.detail) + '</small></div>' + tag(item.type) + '</li>';
      }).join(''), '</ol></section>',
      '<section class="panel"><div class="panel-title"><h2>我的项目</h2>' + availableLink(data.project.url, '打开项目页') + '</div>',
      '<h3>' + escapeHtml(data.project.code + ' ' + data.project.title) + '</h3><p>' + escapeHtml(data.project.milestone) + '</p>',
      '<div class="progress-track" role="progressbar" aria-label="项目进度" aria-valuenow="' + Number(data.project.progress || 0) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + Math.max(0, Math.min(100, Number(data.project.progress || 0))) + '%"></span></div>',
      '<p class="project-note"><strong>最近阻塞：</strong>' + escapeHtml(data.project.blocker) + '</p></section>',
      '</div>',
      '<aside class="stack"><section class="panel"><div class="panel-title"><h2>继续学习</h2></div><p class="kicker">' + escapeHtml(data.course.title) + '</p>',
      '<h3>' + escapeHtml(data.course.next) + '</h3><div class="progress-track" role="progressbar" aria-label="课程进度" aria-valuenow="' + Number(data.course.progress || 0) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + Number(data.course.progress || 0) + '%"></span></div>',
      availableLink(courseUrl(), '进入课程', 'button button-secondary') + '</section>',
      '</aside></div>',
      renderCoursePanel(), renderLiteratureSection(), footer()
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
      renderCourseReviewPanel(), renderLiteratureSection(), footer()
    ].join('');
  }

  function bindViewActions() {
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
    const hasDraft = restoreDraft(elements.reportForm, draftKeys.report);
    if (!hasDraft) setFormValues(elements.reportForm, (state.dashboard.student.report || {}).values || {});
    showDialog(elements.reportDialog);
  }

  function openReportHistory() {
    const history = state.dashboard.student.history || state.dashboard.student.submissions || [];
    elements.reportHistoryBody.innerHTML = history.length ? history.map(function (report) {
      const values = report.values || {};
      const evidence = values.evidence ? '<div class="history-link">' + availableLink(values.evidence, '打开证据链接', 'button button-secondary') + '</div>' : '';
      return '<article class="history-record"><div class="history-record-head"><div><strong>' + escapeHtml(report.title || report.weekId || (report.weekNumber ? ('第' + report.weekNumber + '周') : '历史周报')) + '</strong><small>' + escapeHtml(report.submittedAt || report.date || '') + '</small></div>' + tag(report.status || '已提交', report.feedback ? 'green' : '') + '</div><div class="literature-detail-grid">' +
        detailSection('本周完成与结果', values.progress, true) + detailSection('学习与方法', values.learning, true) +
        detailSection('问题与阻塞', values.blockers, true) + detailSection('下周计划', values.nextPlan, true) +
        detailSection('教师反馈', report.feedback, true) + '</div>' + evidence + '</article>';
    }).join('') : '<div class="empty">还没有历史周报。</div>';
    showDialog(elements.reportHistoryDialog);
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
      const evidence = values.evidence ? '<div class="history-link">' + availableLink(values.evidence, '打开证据链接', 'button button-secondary') + '</div>' : '';
      const previous = (student.history || []).filter(function (item) { return item.recordId !== report.recordId; }).slice(0, 3);
      const previousHtml = previous.length ? '<div class="student-history"><h3>最近历史记录</h3>' + previous.map(function (item) {
        return '<div><span><strong>' + escapeHtml(item.weekId || '历史周报') + '</strong><small>' + escapeHtml(item.submittedAt || '') + '</small></span>' + tag(item.feedback ? '已反馈' : '已提交', item.feedback ? 'green' : '') + '</div>';
      }).join('') + '</div>' : '';
      elements.studentDetailBody.innerHTML = '<div class="student-report-summary"><span>本周周报</span><strong>' + escapeHtml(report.weekId || '') + ' · ' + escapeHtml(report.submittedAt || '') + '</strong></div><div class="literature-detail-grid">' +
        detailSection('本周完成与结果', values.progress, true) + detailSection('学习与方法', values.learning, true) +
        detailSection('问题与阻塞', values.blockers, true) + detailSection('下周计划', values.nextPlan, true) +
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
    if (!elements.reportForm.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(elements.reportForm).entries());
    fields.requestId = pendingRequestId('er2-request-report', 'weekly');
    elements.reportSubmit.disabled = true;
    elements.reportSubmit.textContent = '正在提交…';
    elements.reportError.hidden = true;
    try {
      if (DEMO_MODE) {
        await new Promise(function (resolve) { setTimeout(resolve, 500); });
      } else {
        await request('/api/reports', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Request-ID': fields.requestId,
            'Authorization': 'Bearer ' + state.session
          },
          body: JSON.stringify(Object.assign({ weekId: state.dashboard.week.id }, fields))
        });
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
      const historyEntry = {
        recordId: '',
        weekId: state.dashboard.week.id,
        submittedAt: new Date().toLocaleDateString('en-CA'),
        status: '已提交',
        feedback: '',
        values: state.dashboard.student.report.values
      };
      const previousHistory = state.dashboard.student.history || [];
      state.dashboard.student.history = [historyEntry].concat(previousHistory.filter(function (item) {
        return item.weekId !== state.dashboard.week.id;
      })).slice(0, 12);
      closeDialog(elements.reportDialog);
      elements.reportForm.reset();
      clearDraft(draftKeys.report);
      sessionStorage.removeItem('er2-request-report');
      renderActiveView();
      showToast('本周工作记录已提交');
    } catch (error) {
      elements.reportError.textContent = error.message || '提交失败，请稍后重试';
      elements.reportError.hidden = false;
    } finally {
      elements.reportSubmit.disabled = false;
      elements.reportSubmit.textContent = '提交本周记录';
    }
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
      sessionStorage.removeItem('er2-request-literature');
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
      sessionStorage.removeItem(requestKey);
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
      sessionStorage.removeItem(requestKey);
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
      sessionStorage.removeItem(draftKeys.feedbackRequest);
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
  document.getElementById('retry-button').addEventListener('click', function () { loadDashboard(state.activeRole); });
  elements.reportForm.addEventListener('submit', submitReport);
  elements.literatureForm.addEventListener('submit', submitLiterature);
  elements.courseForm.addEventListener('submit', submitCourse);
  elements.courseConfirmForm.addEventListener('submit', function (event) { event.preventDefault(); submitCourseReview('confirm'); });
  elements.courseSupplementButton.addEventListener('click', function () { submitCourseReview('supplement'); });
  elements.feedbackForm.addEventListener('submit', submitTeacherFeedback);
  elements.reportForm.addEventListener('input', function () { saveDraft(elements.reportForm, draftKeys.report); });
  elements.literatureForm.addEventListener('input', function () { saveDraft(elements.literatureForm, draftKeys.literature); });
  elements.courseForm.addEventListener('input', function () {
    const lessonId = elements.courseLessonId.value;
    if (lessonId) saveDraft(elements.courseForm, courseDraftKey(lessonId));
  });
  elements.searchForm.addEventListener('submit', runSearch);
  elements.logoutButton.addEventListener('click', function () {
    sessionStorage.removeItem('er2-session');
    sessionStorage.removeItem('er2-request-report');
    sessionStorage.removeItem('er2-request-literature');
    sessionStorage.removeItem(draftKeys.feedbackRequest);
    sessionStorage.removeItem(draftKeys.courseRequest);
    sessionStorage.removeItem(draftKeys.courseReviewRequest);
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
