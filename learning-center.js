(function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const date = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '';
  function create({ apiBase, getSession, getProfile, drafts, onUnauthorized }) {
    const dialog = document.createElement('dialog');
    dialog.className = 'learning-dialog';
    dialog.setAttribute('aria-labelledby', 'learning-dialog-title');
    document.body.appendChild(dialog);
    let generation = 0, view = 0, owner = '', model, selection, mode, pending = false;
    async function api(path, options) {
      const response = await fetch(apiBase + path, { ...options, headers: { Authorization: 'Bearer ' + getSession(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) onUnauthorized();
      if (!response.ok) throw Object.assign(new Error(data.message || '学习记录暂时无法载入，请重试'), { status: response.status });
      return data;
    }
    const alive = g => generation === g && dialog.open && getProfile()?.sub === owner;
    const status = text => { const el = dialog.querySelector('[data-learning-status]'); if (el) el.textContent = text; };
    function reset() { generation++; view++; owner = ''; model = null; selection = null; pending = false; dialog.close(); dialog.innerHTML = ''; }
    dialog.addEventListener('close', () => { if (dialog.open) return; generation++; view++; pending = false; dialog.innerHTML = ''; });
    function shell() {
      dialog.innerHTML = '<header class="learning-modal-header"><div><p class="kicker">LEARNING</p><h2 id="learning-dialog-title">学习中心</h2></div><button type="button" class="button button-ghost" data-learning-close aria-label="关闭学习中心">×</button></header>' +
        '<p class="learning-intro">每课提交文字学习记录即可继续。朱俊杰可回复；无需等待回复或审核。</p>' +
        '<div class="learning-tabs" data-learning-tabs></div><p role="status" class="learning-status" data-learning-status>正在读取学习记录…</p>' +
        '<div class="learning-workspace"><nav aria-label="课程目录" data-learning-nav></nav><section class="learning-detail" data-learning-detail><p>请选择一节课程。</p></section></div>';
      dialog.querySelector('[data-learning-close]').onclick = () => dialog.close();
    }
    function renderTabs() {
      const el = dialog.querySelector('[data-learning-tabs]');
      el.innerHTML = (model.access.canSubmit ? '<button class="button button-secondary" data-learning-mine>我的学习</button>' : '') +
        (model.access.canReview ? '<button class="button button-secondary" data-learning-inbox>学生学习记录</button>' : '');
      el.querySelector('[data-learning-mine]')?.addEventListener('click', () => { view++; mode = 'mine'; renderCourses(); });
      el.querySelector('[data-learning-inbox]')?.addEventListener('click', () => { mode = 'inbox'; renderInbox(); });
    }
    function progress() {
      const track = model.catalog.tracks.find(t => t.id === 'A');
      const completed = track.lessons.filter(l => model.records.some(r => r.trackId === 'A' && r.lessonId === l.id)).length;
      status('Track A：已提交 ' + completed + ' / ' + track.lessons.length + (completed === track.lessons.length ? ' · 已完成学习，完成提醒单独发送。' : ' · 回复不影响继续学习。'));
    }
    function renderCourses() {
      selection = null; pending = false; progress();
      dialog.querySelector('[data-learning-detail]').innerHTML = '<p>选择课程后，可阅读知识库教材、提交学习记录和查看回复。</p><p class="muted">提交内容仅本人和朱俊杰可查看。教授只接收 Track 全部完成提醒。</p>';
      dialog.querySelector('[data-learning-nav]').innerHTML = model.catalog.tracks.map(t => '<details class="learning-track"' + (t.id === 'A' ? ' open' : '') + '><summary>' + escape(t.title) + '</summary>' +
        (t.available ? t.lessons.map(l => { const record = model.records.find(r => r.trackId === t.id && r.lessonId === l.id);
          return '<button type="button" class="learning-lesson-button" data-learning-lesson="' + escape(t.id + ':' + l.id) + '"><span>Lesson ' + escape(l.id) + ' · ' + escape(l.title) + '</span><small>' + (record ? record.lastKind === 'reply' ? '已提交 · 有回复' : '已提交' : '待提交') + '</small></button>'; }).join('') : '<p class="muted">待开放，暂不计入学习进度。</p>') + '</details>').join('');
      dialog.querySelectorAll('[data-learning-lesson]').forEach(b => b.onclick = () => {
        const [trackId, lessonId] = b.dataset.learningLesson.split(':');
        showLesson({ trackId, lessonId, subject: owner, name: getProfile().name });
      });
    }
    async function renderInbox(cursor = '', accumulated = []) {
      const g = generation, v = ++view; selection = null; pending = false;
      status('正在读取学生学习记录…');
      try {
        const data = await api('/api/learning/inbox' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
        if (!alive(g) || v !== view) return;
        const rows = accumulated.concat(data.records);
        status(data.notificationIssues.length ? '有 ' + data.notificationIssues.length + ' 条通知未确认送达；学习记录已保存。' : '仅朱俊杰可查看和回复；学生不需要等待回复。');
        dialog.querySelector('[data-learning-detail]').innerHTML = '<p>选择一条记录查看学生原文和历史回复。</p>';
        const nav = dialog.querySelector('[data-learning-nav]');
        nav.innerHTML = rows.length ? rows.map((r, i) => '<button type="button" class="learning-lesson-button" data-inbox-index="' + i + '"><span>' + escape(r.name) + ' · ' + escape(r.trackId) + ' / ' + escape(r.lessonId) + '</span><small>' + (r.lastKind === 'reply' ? '已回复' : '待查看 / 回复') + ' · ' + escape(date(r.updatedAt)) + '</small></button>').join('') : '<p>暂时没有学习记录。</p>';
        nav.querySelectorAll('[data-inbox-index]').forEach(b => b.onclick = () => showLesson(rows[Number(b.dataset.inboxIndex)]));
        if (data.next) { const more = document.createElement('button'); more.className = 'button button-secondary'; more.textContent = '加载更多'; more.onclick = () => renderInbox(data.next, rows); nav.appendChild(more); }
      } catch (e) { if (alive(g) && v === view) retry(e.message, () => renderInbox(cursor, accumulated)); }
    }
    function retry(message, action) {
      status(message);
      const b = document.createElement('button'); b.className = 'button button-secondary'; b.textContent = '重试'; b.onclick = action;
      dialog.querySelector('[data-learning-status]').append(' ', b);
    }
    function draftScope(item, kind) { return ['learning-v1', item.subject, item.trackId, item.lessonId, kind].join(':'); }
    function readDraft(scope) { try { return JSON.parse(drafts.get('learning', scope) || '{}'); } catch (_) { return {}; } }
    async function showLesson(item, before = 0, retained = []) {
      const g = generation, v = ++view; selection = item; pending = false;
      const target = dialog.querySelector('[data-learning-detail]');
      target.innerHTML = '<p>正在读取本课记录…</p>';
      try {
        const q = new URLSearchParams({ subject: item.subject, track: item.trackId, lesson: item.lessonId });
        if (before) q.set('before', before);
        const data = await api('/api/learning/record?' + q);
        if (!alive(g) || view !== v) return;
        const lesson = model.catalog.tracks.find(t => t.id === item.trackId)?.lessons.find(l => l.id === item.lessonId);
        if (!lesson) throw new Error('课程目录已更新，请重新打开学习中心');
        const history = data.events.concat(retained);
        target.innerHTML = '<h3>Lesson ' + escape(item.lessonId) + ' · ' + escape(lesson.title) + '</h3>' +
          (mode === 'inbox' ? '<p>' + escape(item.name) + '</p>' : '') +
          '<a class="button button-secondary" href="' + escape(lesson.url) + '" target="_blank" rel="noopener noreferrer">阅读本课教材 ↗</a>' +
          (data.next ? '<p><button type="button" class="button button-ghost" data-learning-older>查看更早记录</button></p>' : '') +
          '<div class="learning-history">' + history.map(e => '<article><strong>' + escape(e.author) + ' · ' + ({ submit: '学习记录', append: '补充说明', reply: '回复' })[e.kind] + '</strong><small>' + escape(date(e.createdAt)) + '</small>' +
            (e.kind === 'submit' ? ['gains', 'questions', 'suggestions'].filter(k => e[k]).map(k => '<h4>' + ({ gains: '学习与收获', questions: '疑惑与问题', suggestions: '建议与反馈' })[k] + '</h4><p>' + escape(e[k]) + '</p>').join('') : '<p>' + escape(e.text) + '</p>') + '</article>').join('') + '</div><div data-learning-form></div>';
        target.querySelector('[data-learning-older]')?.addEventListener('click', () => showLesson(item, data.next, history));
        if (mode === 'inbox' && !model.access.canReview) return;
        if (mode === 'mine' && !model.access.canSubmit) return;
        const kind = mode === 'inbox' ? 'reply' : data.record ? 'append' : 'submit';
        renderForm(target.querySelector('[data-learning-form]'), item, kind, g, v);
      } catch (e) { if (alive(g) && view === v) { target.textContent = e.message; retry('本课记录没有加载成功，未改变学习进度。', () => showLesson(item)); } }
    }
    function renderForm(container, item, kind, g, v) {
      const scope = draftScope(item, kind), draft = readDraft(scope);
      const labels = kind === 'submit' ? [['gains', '学习与收获', true], ['questions', '疑惑与问题（选填）', false], ['suggestions', '建议与反馈（选填）', false]] : [['text', kind === 'reply' ? '回复学生' : '补充说明', true]];
      container.innerHTML = '<form class="learning-form">' + labels.map(([key, label, required]) => '<label>' + escape(label) + '<textarea name="' + key + '" maxlength="10000" rows="' + (key === 'gains' ? '5' : '3') + '"' + (required ? ' required' : '') + '>' + escape((draft.pending?.body || draft)[key] || '') + '</textarea></label>').join('') +
        '<p class="muted">' + (kind === 'submit' ? '填写文字即可，无需上传图片或文件。提交后可追加说明，原文保留。' : '这段文字会追加到历史记录中。') + '</p><p class="learning-form-status" role="status"></p><button class="button button-primary" type="submit">' + (draft.pending ? '重试上次保存' : kind === 'reply' ? '发送回复' : kind === 'append' ? '提交补充' : '提交本课记录') + '</button></form>';
      const form = container.querySelector('form'), output = form.querySelector('[role="status"]'), submit = form.querySelector('[type="submit"]');
      if (draft.pending) form.querySelectorAll('textarea').forEach(e => e.readOnly = true);
      form.oninput = () => {
        if (pending || !alive(g) || view !== v) return;
        try { drafts.set('learning', scope, JSON.stringify(Object.fromEntries(new FormData(form)))); } catch (_) { output.textContent = '浏览器无法保存草稿，关闭前请复制文字。'; }
      };
      form.onsubmit = async event => {
        event.preventDefault(); if (pending || !alive(g) || view !== v) return;
        const current = readDraft(scope);
        const body = current.pending?.body || { requestId: crypto.randomUUID(), trackId: item.trackId, lessonId: item.lessonId,
          ...(kind === 'reply' ? { subject: item.subject } : {}), ...Object.fromEntries(new FormData(form)) };
        const path = '/api/learning/' + kind;
        try { drafts.set('learning', scope, JSON.stringify({ pending: { path, body } })); }
        catch (_) { output.textContent = '无法保存重试凭据，请复制文字并检查浏览器存储后重试。'; return; }
        pending = true; submit.disabled = true; form.querySelectorAll('textarea').forEach(e => e.readOnly = true); output.textContent = '正在保存…';
        try {
          const result = await api(path, { method: 'POST', body: JSON.stringify(body) });
          if (!alive(g) || view !== v) return;
          if (result.saved !== true) throw new Error('尚未确认保存，请保留文字并重试');
          drafts.remove('learning', scope); pending = false;
          if (mode === 'mine') { model.records = result.records; renderCourses(); }
          status('已保存。' + (kind === 'reply' ? '学生可以在原记录查看回复。' : '可以继续下一课，无需等待回复。'));
          await showLesson(item);
        } catch (e) {
          if (!alive(g) || view !== v) return;
          pending = false; submit.disabled = false; submit.textContent = '重试上次保存'; output.textContent = e.message + '；原文已保留。';
          // Explicit validation failures did not commit. Permit correction with a new request.
          if ([400, 403, 404, 413].includes(e.status)) { drafts.set('learning', scope, JSON.stringify(Object.fromEntries(new FormData(form)))); form.querySelectorAll('textarea').forEach(e => e.readOnly = false); }
          if (e.status === 409) { const b = document.createElement('button'); b.type = 'button'; b.textContent = '查看已保存记录'; b.className = 'button button-secondary'; b.onclick = () => showLesson(item); output.append(' ', b); }
        }
      };
    }
    async function open(inbox = false) {
      const profile = getProfile(); if (!profile?.sub) return;
      if (dialog.open) dialog.close();
      owner = profile.sub; const g = ++generation; mode = inbox ? 'inbox' : 'mine'; shell(); dialog.showModal();
      try {
        const result = await api('/api/learning'); if (!alive(g)) return; model = result;
        if (inbox && !model.access.canReview) throw new Error('当前账号没有查看其他学生学习记录的权限');
        renderTabs(); if (mode === 'inbox') await renderInbox(); else renderCourses();
      } catch (e) { if (alive(g)) {
        retry(e.message, () => open(inbox));
        if (!inbox) dialog.querySelector('[data-learning-detail]').innerHTML = '<p>可以先阅读已发布的课程教材，记录恢复后再提交。</p><a class="button button-secondary" href="https://lcnywl4yrecr.feishu.cn/wiki/AMikwNK58iWRCbkvoBJcQ7Q3nmc" target="_blank" rel="noopener noreferrer">打开知识库学习资料</a>';
      } }
    }
    return { open, reset };
  }
  root.ER2LearningCenter = { create };
})(window);
