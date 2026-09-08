window.ER2_CONFIG = Object.freeze({
  apiBase: 'https://er2-lab-api.zhujunjie418.workers.dev',
  demo: false,
  feishuDocsOrigin: 'https://lcnywl4yrecr.feishu.cn',
  feishuWikiUrl: ''
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
      .home-v2-project h3{margin:0 0 5px}.home-v2-project p{margin:5px 0;color:var(--muted,#68758a)}
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
    function safeUrl(value) {
      const text = String(value || '').trim();
      return /^https:\/\//i.test(text) ? text : '';
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
      const hero = root.querySelector('.hero-card');
      if (!hero) return;
      const kicker = hero.querySelector('.kicker');
      const title = hero.querySelector('h2');
      const description = hero.querySelector('p:not(.kicker)');
      if (kicker) kicker.textContent = '本周工作记录';
      if (title) title.textContent = home.report?.status === 'submitted' ? '本周工作记录已提交' : '本周工作记录待提交';
      if (description) description.textContent = [home.report?.weekLabel, home.report?.dueLabel].filter(Boolean).join(' · ');
    }
    function renderProjects(home) {
      const panel = panelByTitle('我的项目');
      if (!panel) return;
      const projects = Array.isArray(home.projects) ? home.projects : [];
      if (!home.modules?.projects?.visible || !projects.length) { panel.hidden = true; return; }
      panel.hidden = false;
      panel.innerHTML = '<div class="panel-title"><h2>我的项目</h2><span>' + projects.length + ' 个活跃项目</span></div><div class="home-v2-projects">' + projects.slice(0, 3).map(function (project) {
        const link = safeUrl(project.url) ? '<a class="text-link" href="' + escapeHtml(project.url) + '">进入项目 ›</a>' : '<span class="home-v2-module-note">项目页待管理员配置</span>';
        return '<article class="home-v2-project"><div class="home-v2-project-head"><div><h3>' + escapeHtml([project.code, project.title].filter(Boolean).join(' · ')) + '</h3><p>' + escapeHtml([project.role, project.status].filter(Boolean).join(' · ')) + '</p></div>' + link + '</div>' + (project.nextTask ? '<p><strong>下一项：</strong>' + escapeHtml(project.nextTask) + '</p>' : '') + (project.blocker ? '<p><strong>最近阻塞：</strong>' + escapeHtml(project.blocker) + '</p>' : '') + '<div class="progress-track" role="progressbar" aria-valuenow="' + Number(project.progress || 0) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + Number(project.progress || 0) + '%"></span></div></article>';
      }).join('') + '</div>';
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
        renderProjects(home);
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
