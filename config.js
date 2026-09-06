window.ER2_CONFIG = Object.freeze({
  apiBase: 'https://er2-lab-api.zhujunjie418.workers.dev',
  demo: false,
  // 真实飞书知识库地址在部署时填写，避免在公开源代码中新增内部入口。
  feishuWikiUrl: ''
});

window.addEventListener('DOMContentLoaded', function () {
  const script = document.createElement('script');
  script.src = './student-home-v2.js?v=20260906-student-home-v2';
  script.defer = true;
  document.body.appendChild(script);
});
