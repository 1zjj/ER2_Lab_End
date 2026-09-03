(function () {
  const validRoles = ['student', 'teacher', 'manager'];
  const roleLinks = Array.from(document.querySelectorAll('[data-role-link]'));
  const rolePanels = Array.from(document.querySelectorAll('[data-role-panel]'));
  const form = document.getElementById('global-search');
  const input = document.getElementById('search-input');
  const dialog = document.getElementById('search-dialog');
  const results = document.getElementById('search-results');
  const summary = document.getElementById('search-summary');
  const toast = document.getElementById('toast');
  let catalog = [];
  let toastTimer;

  function roleFromHash() {
    const value = location.hash.replace('#', '').split('/')[0];
    return validRoles.includes(value) ? value : 'student';
  }

  function setRole(role, updateHash) {
    const targetRole = validRoles.includes(role) ? role : 'student';
    rolePanels.forEach(function (panel) {
      const active = panel.dataset.rolePanel === targetRole;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    roleLinks.forEach(function (link) {
      link.classList.toggle('active', link.dataset.roleLink === targetRole);
      if (link.dataset.roleLink === targetRole) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    localStorage.setItem('er2-last-role', targetRole);
    if (updateHash && location.hash !== '#' + targetRole) history.pushState(null, '', '#' + targetRole);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3000);
  }

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
  }

  function renderSearch(query) {
    const term = normalize(query);
    const matched = catalog.filter(function (item) {
      return normalize([item.title, item.subtitle, item.category].concat(item.keywords || []).join(' ')).includes(term);
    }).slice(0, 12);
    summary.textContent = matched.length ? '找到 ' + matched.length + ' 个入口。完整内容和大文件仍由飞书提供。' : '没有找到“' + query + '”，可以尝试课程、周报、项目、设备、D435或ROS。';
    results.innerHTML = '';
    if (!matched.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-result';
      empty.textContent = '未找到匹配内容';
      results.appendChild(empty);
      return;
    }
    matched.forEach(function (item) {
      const link = document.createElement('a');
      link.className = 'search-result';
      link.href = item.url;
      link.innerHTML = '<span>' + item.category.slice(0, 2) + '</span><div><strong>' + item.title + '</strong><small>' + item.subtitle + '</small></div><b>→</b>';
      results.appendChild(link);
    });
  }

  roleLinks.forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      setRole(link.dataset.roleLink, true);
    });
  });

  window.addEventListener('hashchange', function () { setRole(roleFromHash(), false); });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) {
      showToast('请输入课程、项目、设备或SOP关键词');
      input.focus();
      return;
    }
    renderSearch(query);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });

  document.getElementById('close-search').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close();
  });

  fetch('./data/catalog.json')
    .then(function (response) {
      if (!response.ok) throw new Error('catalog unavailable');
      return response.json();
    })
    .then(function (data) { catalog = Array.isArray(data) ? data : []; })
    .catch(function () {
      catalog = [];
      showToast('静态目录暂未载入，主要入口仍可正常使用');
    });

  const firstRole = location.hash ? roleFromHash() : (localStorage.getItem('er2-last-role') || 'student');
  setRole(firstRole, !location.hash);
}());
