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
    toast: document.getElementById('toast')
  };

  const state = {
    session: readSession(),
    activeRole: 'student',
    dashboard: null,
    catalog: [],
    toastTimer: null
  };

  const draftKeys = {
    report: 'er2-draft-report',
    literature: 'er2-draft-literature'
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
      report: { status: 'pending', label: '未提交' },
      course: { title: '语义导航 Demo', progress: 40, completed: 2, total: 5, next: 'Lesson 03 · 运动学与闭环' },
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
      submissions: [
        { title: 'Lesson 02｜rqt_graph 与 TF 截图', date: '2026-08-28', status: '已验收' },
        { title: 'P03｜costmap 跳变复现记录', date: '2026-09-02', status: '待审核' }
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
      ]
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
    if (!value) return '#';
    try {
      const url = new URL(String(value || ''), location.href);
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
    if (safe === '#') return '<span class="' + escapeHtml(className || 'text-link') + ' link-disabled" title="该入口尚未由管理员配置">' + escapeHtml(label) + '</span>';
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

  function wikiUrl() {
    return config.feishuWikiUrl || (state.catalog.find(function (item) { return item.category === '知识库'; }) || {}).url || '#';
  }

  function footer() {
    return '<footer><span>ER² Lab统一工作台 · 数据与大文件由飞书承载</span>' +
      availableLink(wikiUrl(), '打开ER²知识库') + '</footer>';
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
      '<section class="hero-card"><div><p class="kicker">本周唯一提交</p><h2>' + (submitted ? '本周工作记录已提交' : '完成本周工作记录') + '</h2>',
      '<p>项目进度、培训学习、产出证据、问题和下一步统一记录，预计5–8分钟。</p><div class="action-row">',
      '<button class="button button-primary" type="button" data-open-report>' + (submitted ? '修改本周记录' : '立即填写') + '</button>',
      availableLink((data.links[0] || {}).url, '查看历史记录', 'button button-secondary') + '</div></div>',
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
      availableLink((state.catalog.find(function (item) { return item.category === '课程'; }) || {}).url || wikiUrl(), '进入课程', 'button button-secondary') + '</section>',
      '</aside></div>',
      renderLiteratureSection(), footer()
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
      }).join(''), '</ul></section></div><aside class="stack"><section class="panel"><div class="panel-title"><h2>本周共性问题</h2></div><ol class="task-list">',
      data.commonIssues.map(function (issue, index) { return '<li><span class="task-number">' + (index + 1) + '</span><div><strong>' + escapeHtml(issue) + '</strong></div></li>'; }).join(''),
      '</ol></section><section class="panel"><div class="panel-title"><h2>教师快捷入口</h2></div><ul class="link-list">',
      '<li><a href="' + safeUrl(wikiUrl()) + '"><span>课程与培训维护</span><span>›</span></a></li>',
      '<li><a href="' + safeUrl(wikiUrl()) + '"><span>项目里程碑</span><span>›</span></a></li>',
      '<li><a href="' + safeUrl(wikiUrl()) + '"><span>周报原始记录</span><span>›</span></a></li>',
      '</ul></section></aside></div>', renderLiteratureSection(), footer()
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
      renderLiteratureSection(), footer()
    ].join('');
  }

  function bindViewActions() {
    const reportButton = elements.app.querySelector('[data-open-report]');
    if (reportButton) reportButton.addEventListener('click', openReportDialog);
    const literatureButton = elements.app.querySelector('[data-open-literature]');
    if (literatureButton) literatureButton.addEventListener('click', openLiteratureDialog);
    elements.app.querySelectorAll('[data-literature-detail]').forEach(function (button) {
      button.addEventListener('click', function () { openLiteratureDetail(button.dataset.literatureDetail); });
    });
    elements.app.querySelectorAll('[data-student]').forEach(function (button) {
      button.addEventListener('click', function () {
        const student = state.dashboard.teacher.students.find(function (item) { return item.id === button.dataset.student; });
        if (student) showToast(student.name + '：' + student.status + '；' + student.blocker);
      });
    });
  }

  function openReportDialog() {
    elements.reportWeekLabel.textContent = state.dashboard.week.label;
    elements.reportError.hidden = true;
    const hasDraft = restoreDraft(elements.reportForm, draftKeys.report);
    if (!hasDraft) setFormValues(elements.reportForm, (state.dashboard.student.report || {}).values || {});
    if (typeof elements.reportDialog.showModal === 'function') elements.reportDialog.showModal();
    else elements.reportDialog.setAttribute('open', '');
  }

  function openLiteratureDialog() {
    elements.literatureWeekLabel.textContent = state.dashboard.week.label + ' · 已提交 ' + Number((state.dashboard.literature || {}).mineCount || 0) + ' 篇';
    elements.literatureError.hidden = true;
    restoreDraft(elements.literatureForm, draftKeys.literature);
    if (typeof elements.literatureDialog.showModal === 'function') elements.literatureDialog.showModal();
    else elements.literatureDialog.setAttribute('open', '');
  }

  function openLiteratureDetail(id) {
    const items = (state.dashboard.literature || {}).items || [];
    const item = items.find(function (entry) { return String(entry.id) === String(id); });
    if (!item) return showToast('这条阅读记录暂时不可用');
    elements.literatureDetailTitle.textContent = item.title || '文献阅读详情';
    elements.literatureDetailMeta.textContent = [item.submitter, item.role, item.weekId, item.date].filter(Boolean).join(' · ');
    const section = function (title, value) {
      return value ? '<section><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(value).replace(/\n/g, '<br>') + '</p></section>' : '';
    };
    const links = [
      item.noteUrl ? availableLink(item.noteUrl, '打开飞书阅读笔记', 'button button-primary') : '',
      item.paperUrl ? availableLink(item.paperUrl, '打开论文网页', 'button button-secondary') : '',
      item.attachmentUrl ? availableLink(item.attachmentUrl, '打开论文附件', 'button button-secondary') : ''
    ].filter(Boolean).join('');
    elements.literatureDetailBody.innerHTML = '<div class="literature-detail-grid">' +
      section('作者', item.authors) + section('会议或期刊', [item.venue, item.year].filter(Boolean).join(' · ')) +
      section('DOI / arXiv', item.doi) + section('研究方向与类型', [item.direction, item.type].filter(Boolean).join(' · ')) +
      section('一句话贡献', item.contribution) + section('核心问题', item.coreProblem) +
      section('方法摘要', item.method) + section('个人评价', item.review) + section('与项目关系', item.projectRelation) +
      '</div><div class="action-row literature-detail-links">' + links + '</div>';
    if (typeof elements.literatureDetailDialog.showModal === 'function') elements.literatureDetailDialog.showModal();
    else elements.literatureDetailDialog.setAttribute('open', '');
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
        values: {
          progress: fields.progress || '',
          learning: fields.learning || '',
          evidence: fields.evidence || '',
          blockers: fields.blockers || '',
          nextPlan: fields.nextPlan || ''
        }
      };
      elements.reportDialog.close();
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
      elements.literatureDialog.close();
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
    if (typeof elements.searchDialog.showModal === 'function') elements.searchDialog.showModal();
    else elements.searchDialog.setAttribute('open', '');
  }

  document.querySelectorAll('[data-close-dialog]').forEach(function (button) {
    button.addEventListener('click', function () {
      const dialog = document.getElementById(button.dataset.closeDialog);
      if (dialog) dialog.close();
    });
  });
  [elements.reportDialog, elements.literatureDialog, elements.searchDialog, elements.literatureDetailDialog].forEach(function (dialog) {
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close();
    });
  });
  document.getElementById('retry-button').addEventListener('click', function () { loadDashboard(state.activeRole); });
  elements.reportForm.addEventListener('submit', submitReport);
  elements.literatureForm.addEventListener('submit', submitLiterature);
  elements.reportForm.addEventListener('input', function () { saveDraft(elements.reportForm, draftKeys.report); });
  elements.literatureForm.addEventListener('input', function () { saveDraft(elements.literatureForm, draftKeys.literature); });
  elements.searchForm.addEventListener('submit', runSearch);
  elements.logoutButton.addEventListener('click', function () {
    sessionStorage.removeItem('er2-session');
    sessionStorage.removeItem('er2-request-report');
    sessionStorage.removeItem('er2-request-literature');
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
