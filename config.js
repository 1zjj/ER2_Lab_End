window.ER2_CONFIG = Object.freeze({
  apiBase: 'https://er2-lab-api.zhujunjie418.workers.dev',
  demo: false,
  feishuDocsOrigin: 'https://lcnywl4yrecr.feishu.cn',
  learningCenterUrl: 'https://lcnywl4yrecr.feishu.cn/wiki/AMikwNK58iWRCbkvoBJcQ7Q3nmc',
  feishuWikiUrl: 'https://lcnywl4yrecr.feishu.cn/wiki/EqjMwpl6mi6l1SkeP0CckVkcnbD?from=from_copylink'
});

window.addEventListener('DOMContentLoaded', function () {
  (function () {
    'use strict';

    const config = window.ER2_CONFIG || {};
    const API_BASE = String(config.apiBase || '').replace(/\/$/, '');
    const root = document.getElementById('app-root');
    if (!root || !API_BASE) return;

    let applying = false;
    const style = document.createElement('style');
    style.textContent = `
      .home-v2-projects{display:grid;gap:12px;margin-top:12px}
      .home-v2-project{border:1px solid var(--border,#dfe6f1);border-radius:14px;padding:14px;background:#fff}
      .home-v2-project-head{display:flex;justify-content:space-between;gap:12px;align-items:center}
      .home-v2-project h3{margin:0;min-width:0;flex:1;overflow-wrap:anywhere}.home-v2-project p{margin:5px 0;color:var(--muted,#68758a)}
      .home-v2-todo-action{margin-left:auto;white-space:nowrap}
      .home-v2-training-summary p{margin:8px 0;color:var(--muted,#68758a)}
      .home-v2-training-meta{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:10px 0 14px}
      .course-panel.home-v2-learning-center[hidden]{display:none!important}
      .home-v2-module-note{font-size:13px;color:var(--muted,#68758a)}
    `;
    document.head.appendChild(style);

    function isStudentView() {
      const kicker = root.querySelector('.welcome .kicker');
      return Boolean(kicker && /STUDENT WORKSPACE/.test(kicker.textContent || ''));
    }
    function panelByTitle(title) {
      return Array.from(root.querySelectorAll('.panel')).find(function (panel) {
        const h2 = panel.querySelector('h2');
        return h2 && h2.textContent.trim() === title;
      }) || null;
    }
    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>'"]/g, function (char) {
        return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char];
      });
    }
    function actionLabel(todo) {
      return ({ report:'去提交', training:'去学习', literature:'去记录', project:'去项目', manual:'查看' })[todo.action] || '查看';
    }
    function renderTodos(home) {
      const panel = panelByTitle('本周待办');
      if (!panel) return;
      const list = panel.querySelector('.task-list');
      if (!list) return;
      const source = Array.isArray(home.todos) ? home.todos : [];
      const learning = root.querySelector('.learning-card');
      const todos = learning?.dataset.coursesEnabled === 'false' ? source.filter(item => item.action !== 'training') : source;
      const count = panel.querySelector('.panel-title span');
      if (count) count.textContent = todos.length + '项';
      list.innerHTML = todos.length ? todos.map(function (item, index) {
        return '<li><span class="task-number">' + (index + 1) + '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.type + (item.detail ? ' · ' + item.detail : '')) + '</small></div><button type="button" class="button button-secondary home-v2-todo-action" data-home-action="' + escapeHtml(item.action) + '" data-home-target="' + escapeHtml(item.target || '') + '">' + actionLabel(item) + '</button></li>';
      }).join('') : '<li class="empty">本周暂无待办。</li>';
    }
    function renderWeeklyStatus(home) {
      if (home.moduleLoading?.weekly || home.moduleErrors?.weekly) return;
      const hero = root.querySelector('.hero-card');
      if (!hero) return;
      const kicker = hero.querySelector('.kicker');
      const title = hero.querySelector('h2');
      const description = hero.querySelector('p:not(.kicker)');
      if (kicker) kicker.textContent = '本周工作记录';
      if (title) title.textContent = home.report?.status === 'submitted' ? '本周工作记录已提交' : '本周工作记录待提交';
      if (description) description.textContent = [home.report?.weekLabel, home.report?.dueLabel].filter(Boolean).join(' · ');
    }
    function renderTraining(home) {
      // The current layout owns the single learning entry; do not recreate the legacy card.
      if (root.querySelector('.learning-card')) return;
      const oldSummary = panelByTitle('继续学习');
      const coursePanel = root.querySelector('.course-panel');
      const training = home.training || {};
      if (coursePanel) coursePanel.classList.add('home-v2-learning-center');
      if (!oldSummary) return;
      // The guide is a local reading preference, never a learning access gate.
      oldSummary.hidden = false;
      oldSummary.innerHTML = '<div class="panel-title"><h2>学习与培训</h2><span>' + Number(training.completed || 0) + ' / ' + Number(training.total || 0) + '</span></div><div class="home-v2-training-summary"><p class="kicker">' + escapeHtml(training.title || '') + '</p><h3>' + escapeHtml(training.next || '查看学习安排') + '</h3><div class="home-v2-training-meta"><div class="progress-track" style="flex:1" role="progressbar" aria-valuenow="' + Number(training.progress || 0) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + Number(training.progress || 0) + '%"></span></div><strong>' + Number(training.progress || 0) + '%</strong></div><button class="button button-primary" type="button" data-home-open-training>进入学习中心</button></div>';
    }
    function reorderLiterature() {
      const literature = root.querySelector('.literature-panel');
      const coursePanel = root.querySelector('.course-panel');
      if (literature && coursePanel && coursePanel.parentNode === literature.parentNode) {
        coursePanel.parentNode.insertBefore(literature, coursePanel);
      }
    }
    function triggerExisting(selector) {
      const element = root.querySelector(selector);
      if (element) element.click();
    }
    function bindHomeActions() {
      root.querySelectorAll('[data-home-action]').forEach(function (button) {
        button.onclick = function () {
          const action = button.dataset.homeAction;
          const target = button.dataset.homeTarget || '';
          if (action === 'report') return triggerExisting('[data-open-report]');
          if (action === 'literature') return triggerExisting('[data-open-literature]');
          if (action === 'training') {
            triggerExisting('.learning-card .button, [data-open-learning-center]');
            const center = root.querySelector('#learning-center');
            if (center) {
              if (target) setTimeout(function () {
                const lesson = center.querySelector('[data-course-lesson="' + CSS.escape(target) + '"]');
                if (lesson) lesson.focus();
              }, 450);
            }
            return;
          }
          if (action === 'project') {
            const projects = panelByTitle('我的项目');
            if (projects) projects.scrollIntoView({ behavior:'smooth', block:'start' });
          }
        };
      });
      const trainingButton = root.querySelector('[data-home-open-training]');
      if (trainingButton) trainingButton.onclick = function () {
        triggerExisting('.learning-card .button, [data-open-learning-center]');
      };
    }
    function normalizeUrlInput(input) {
      let value = String(input.value || '').trim();
      if (!value) return;
      if (!/^https?:\/\//i.test(value) && /^[\w.-]+\.[A-Za-z]{2,}(?:[\/?#].*)?$/.test(value)) value = 'https://' + value;
      input.value = value;
    }
    function bindUrlNormalization() {
      const form = document.getElementById('literature-form');
      if (!form || form.dataset.urlNormalizerBound) return;
      form.dataset.urlNormalizerBound = '1';
      ['paperUrl','noteUrl','attachmentUrl'].forEach(function (name) {
        const input = form.elements.namedItem(name);
        if (input) input.addEventListener('blur', function () { normalizeUrlInput(input); });
      });
      form.addEventListener('submit', function () {
        ['paperUrl','noteUrl','attachmentUrl'].forEach(function (name) {
          const input = form.elements.namedItem(name);
          if (input) normalizeUrlInput(input);
        });
      }, true);
    }
    function apply(home) {
      if (applying || !isStudentView() || !home || home.aiRequired !== false) return;
      applying = true;
      try {
        renderWeeklyStatus(home);
        renderTodos(home);
        renderTraining(home);
        reorderLiterature();
        bindHomeActions();
        bindUrlNormalization();
        root.dataset.studentHomeV2 = 'active';
      } finally {
        applying = false;
      }
    }

    // Render once from the same authenticated dashboard as app.js. Observing our
    // own DOM mutations previously caused repeated rendering and stale resets.
    window.addEventListener('er2-dashboard-rendered', function (event) {
      if (event.detail?.role === 'student') apply(event.detail.home);
    });
    bindUrlNormalization();
  })();
});

// The same pure home model supports independently loaded dashboard modules.
(function () {
function enrichStudentDashboard(dashboard = {}) {
  if (!dashboard?.student) return dashboard;
  return {
    ...dashboard,
    student: {
      ...dashboard.student,
      home: buildStudentHome(dashboard)
    }
  };
}

function buildStudentHome(dashboard = {}) {
  const student = dashboard.student || {};
  const literature = dashboard.literature || {};
  const onboarding = normalizeOnboarding(student.onboarding);
  const report = normalizeReport(student.report, dashboard.week);
  const projects = normalizeProjects(student);
  const training = normalizeTraining(student.course, onboarding.completed);
  const reading = normalizeLiterature(literature);
  if (dashboard.moduleErrors?.literature || dashboard.moduleLoading?.literature) reading.unavailable = true;
  const todos = buildTodos({ student, report, training, reading, projects }).filter(item => !(item.action === 'report' && (dashboard.moduleLoading?.weekly || dashboard.moduleErrors?.weekly)));

  return {
    version: 2,
    moduleErrors: dashboard.moduleErrors || {},
    moduleLoading: dashboard.moduleLoading || {},
    aiRequired: false,
    modules: {
      weeklyStatus: { visible: true, persistent: true },
      weeklyTodos: { visible: true, persistent: true },
      projects: { visible: projects.length > 0, persistent: false },
      training: { visible: training.visible, persistent: false },
      literature: { visible: true, persistent: true },
      onboarding: { visible: !onboarding.completed, persistent: false }
    },
    report,
    onboarding,
    projects,
    training,
    literature: reading,
    todos
  };
}

function normalizeOnboarding(value = {}) {
  const total = positiveInt(value.total, 5);
  const completedCount = Math.min(total, positiveInt(value.completedCount, Array.isArray(value.completedSteps) ? value.completedSteps.length : 0));
  return {
    completed: value.completed === true || completedCount >= total,
    completedCount,
    total,
    completedSteps: Array.isArray(value.completedSteps) ? value.completedSteps : []
  };
}

function normalizeReport(value = {}, week = {}) {
  return {
    status: value.status === 'submitted' ? 'submitted' : 'pending',
    label: value.status === 'submitted' ? '已提交' : '未提交',
    weekId: week.id || '',
    weekLabel: week.label || '',
    dueLabel: week.dueLabel || '周五 18:00 截止'
  };
}

function normalizeProjects(student = {}) {
  const source = Array.isArray(student.projects) ? student.projects : [student.project].filter(Boolean);
  return source.map((item, index) => ({
    projectId: text(item.projectId || item.id || item.code || `project-${index + 1}`),
    code: text(item.code),
    title: text(item.title),
    role: text(item.role || item.projectRole || '成员'),
    status: text(item.status || '进行中'),
    progress: percent(item.progress),
    nextTask: text(item.nextTask || item.milestone),
    blocker: text(item.blocker),
    url: text(item.url)
  })).filter((item) => item.title && !/暂未分配项目/.test(item.title));
}

function normalizeTraining(course = {}, onboardingCompleted = false) {
  const total = positiveInt(course.total, Array.isArray(course.lessons) ? course.lessons.length : 0);
  const completed = Math.min(total, positiveInt(course.completed, 0));
  const lessons = Array.isArray(course.lessons) ? course.lessons : [];
  const nextLesson = lessons.find((lesson) => lesson.status !== 'confirmed') || null;
  const finished = total > 0 && completed >= total;
  return {
    visible: onboardingCompleted && total > 0 && !finished,
    finished,
    id: text(course.id),
    title: text(course.title || '学习与培训'),
    completed,
    total,
    progress: total ? Math.round((completed / total) * 100) : 0,
    next: text(course.next || (nextLesson ? `Lesson ${nextLesson.lessonId} · ${nextLesson.lessonTitle}` : '')),
    nextLessonId: text(nextLesson?.lessonId),
    lessons
  };
}

function normalizeLiterature(value = {}) {
  const minimum = positiveInt(value.minimum, 3);
  const count = positiveInt(value.mineCount, 0);
  return {
    mineCount: count,
    minimum,
    completed: value.completed === true || count >= minimum,
    remaining: Math.max(0, minimum - count),
    items: Array.isArray(value.items) ? value.items : []
  };
}

function buildTodos({ student, report, training, reading }) {
  const todos = [];
  if (report.status !== 'submitted') {
    todos.push(todo('weekly-report', '周报', '提交本周工作记录', report.dueLabel, 100, 'report'));
  }
  if (training.visible && training.next) {
    todos.push(todo('training-next', '培训', `完成 ${training.next}`, '按培训计划完成', 80, 'training', training.nextLessonId));
  }
  if (!reading.completed && !reading.unavailable) {
    todos.push(todo('literature-target', '文献', `本周还需完成 ${reading.remaining} 篇文献阅读`, `目标 ${reading.minimum} 篇`, 70, 'literature'));
  }

  const sourceTasks = Array.isArray(student.tasks) ? student.tasks : [];
  sourceTasks.forEach((item, index) => {
    const type = text(item.type || '任务');
    if (/周报/.test(type) || /课程|培训/.test(type)) return;
    todos.push(todo(
      text(item.taskId || item.id || `source-${index}`),
      type,
      text(item.title || '未命名任务'),
      text(item.dueLabel || item.deadline || item.detail),
      /项目/.test(type) ? 60 : 50,
      /项目/.test(type) ? 'project' : 'manual',
      text(item.projectId || item.projectCode)
    ));
  });

  return todos.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, 'zh-CN')).slice(0, 5);
}

function todo(id, type, title, detail, priority, action, target = '') {
  return { id, type, title, detail, priority, action, target };
}

function positiveInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const percentValue = number > 0 && number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, Math.round(percentValue)));
}

function text(value) {
  return String(value || '').trim();
}

  window.ER2BuildStudentHome = buildStudentHome;
})();
