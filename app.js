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
    reportDialog: document.getElementById('report-dialog'),
    reportForm: document.getElementById('report-form'),
    reportSubmit: document.getElementById('report-submit'),
    reportError: document.getElementById('report-error'),
    reportWeekLabel: document.getElementById('report-week-label'),
    searchForm: document.getElementById('global-search'),
    searchInput: document.getElementById('search-input'),
    searchDialog: document.getElementById('search-dialog'),
    searchSummary: document.getElementById('search-summary'),
    searchResults: document.getElementById('search-results'),
    toast: document.getElementById('toast')
  };

  const state = {
    session: readSession(),
    activeRole: 'student',
    dashboard: null,
    catalog: [],
    toastTimer: null
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
      '<a href="' + safeUrl(wikiUrl()) + '">打开ER²知识库</a></footer>';
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
      '<section class="welcome"><div><p class="kicker">STUDENT WORKSPACE</p><h1>晚上好，' + escapeHtml(profile.name) + '</h1>',
      '<p>这里只展示与你有关的任务、课程、项目和记录。</p></div>',
      '<div class="deadline">◷ ' + escapeHtml(week.dueLabel) + '</div></section>',
      '<section class="hero-card"><div><p class="kicker">本周唯一提交</p><h2>' + (submitted ? '本周工作记录已提交' : '完成本周工作记录') + '</h2>',
      '<p>项目进度、培训学习、产出证据、问题和下一步统一记录，预计5–8分钟。</p><div class="action-row">',
      '<button class="button button-primary" type="button" data-open-report>' + (submitted ? '修改本周记录' : '立即填写') + '</button>',
      '<a class="button button-secondary" href="' + safeUrl((data.links[0] || {}).url) + '">查看历史记录</a></div></div>',
      '<div class="status-panel"><div><span>本周周报</span><strong>' + escapeHtml(data.report.label) + '</strong></div>',
      '<div><span>当前项目</span><strong>' + escapeHtml(data.project.code + ' ' + data.project.title) + '</strong></div>',
      '<div><span>课程进度</span><strong>' + escapeHtml(data.course.completed + ' / ' + data.course.total) + '</strong></div></div></section>',
      '<div class="dashboard-grid"><div class="stack">',
      '<section class="panel"><div class="panel-title"><h2>本周待办</h2>' + tag(data.tasks.length + '项') + '</div><ol class="task-list">',
      data.tasks.map(function (item, index) {
        return '<li><span class="task-number">' + (index + 1) + '</span><div><strong>' + escapeHtml(item.title) +
          '</strong><small>' + escapeHtml(item.detail) + '</small></div>' + tag(item.type) + '</li>';
      }).join(''), '</ol></section>',
      '<section class="panel"><div class="panel-title"><h2>我的项目</h2><a href="' + safeUrl(data.project.url) + '">打开项目页</a></div>',
      '<h3>' + escapeHtml(data.project.code + ' ' + data.project.title) + '</h3><p>' + escapeHtml(data.project.milestone) + '</p>',
      '<div class="progress-track" role="progressbar" aria-label="项目进度" aria-valuenow="' + Number(data.project.progress || 0) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + Math.max(0, Math.min(100, Number(data.project.progress || 0))) + '%"></span></div>',
      '<p class="project-note"><strong>最近阻塞：</strong>' + escapeHtml(data.project.blocker) + '</p></section>',
      '<section class="panel"><div class="panel-title"><h2>最近提交证据</h2><span>仅本人记录</span></div><ul class="submission-list">',
      data.submissions.map(function (item) {
        return '<li><div><strong>' + escapeHtml(item.title) + '</strong><time>' + escapeHtml(item.date) + '</time></div>' +
          tag(item.status, item.status === '已验收' ? 'green' : 'orange') + '</li>';
      }).join(''), '</ul></section></div>',
      '<aside class="stack"><section class="panel"><div class="panel-title"><h2>继续学习</h2></div><p class="kicker">' + escapeHtml(data.course.title) + '</p>',
      '<h3>' + escapeHtml(data.course.next) + '</h3><div class="progress-track" role="progressbar" aria-label="课程进度" aria-valuenow="' + Number(data.course.progress || 0) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + Number(data.course.progress || 0) + '%"></span></div>',
      '<a class="button button-secondary" href="' + safeUrl((state.catalog.find(function (item) { return item.category === '课程'; }) || {}).url || wikiUrl()) + '">进入课程</a></section>',
      '<section class="panel"><div class="panel-title"><h2>我的快捷入口</h2></div><ul class="link-list">',
      data.links.map(function (item) { return '<li><a href="' + safeUrl(item.url) + '"><span>' + escapeHtml(item.title) + '</span><span>›</span></a></li>'; }).join(''),
      '</ul></section><section class="panel"><div class="panel-title"><h2>权限说明</h2></div><p class="project-note">你只能读取自己的门户数据；教师和管理者按职责查看汇总。</p></section></aside></div>',
      footer()
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
      '</ul></section></aside></div>', footer()
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
      footer()
    ].join('');
  }

  function bindViewActions() {
    const reportButton = elements.app.querySelector('[data-open-report]');
    if (reportButton) reportButton.addEventListener('click', openReportDialog);
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
    if (typeof elements.reportDialog.showModal === 'function') elements.reportDialog.showModal();
    else elements.reportDialog.setAttribute('open', '');
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!elements.reportForm.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(elements.reportForm).entries());
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
            'Authorization': 'Bearer ' + state.session
          },
          body: JSON.stringify(Object.assign({ weekId: state.dashboard.week.id }, fields))
        });
      }
      state.dashboard.student.report = { status: 'submitted', label: '已提交' };
      elements.reportDialog.close();
      elements.reportForm.reset();
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
      return '<a class="search-result" href="' + safeUrl(item.url) + '"><span>' + escapeHtml(item.category.slice(0,2)) +
        '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.subtitle) + '</small></div><b>→</b></a>';
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
  [elements.reportDialog, elements.searchDialog].forEach(function (dialog) {
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close();
    });
  });
  document.getElementById('retry-button').addEventListener('click', function () { loadDashboard(state.activeRole); });
  elements.reportForm.addEventListener('submit', submitReport);
  elements.searchForm.addEventListener('submit', runSearch);

  fetch('./data/catalog.json')
    .then(function (response) { return response.ok ? response.json() : []; })
    .then(function (data) {
      state.catalog = Array.isArray(data) ? data : [];
      hydrateDemoLinks();
    })
    .catch(function () { state.catalog = []; })
    .finally(function () { loadDashboard(new URLSearchParams(location.search).get('view')); });
}());
