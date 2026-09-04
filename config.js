window.ER2_CONFIG = Object.freeze({
  // 部署 Cloudflare Worker 后，把 apiBase 改为实际 workers.dev 地址并将 demo 设为 false。
  apiBase: '',
  demo: true,
  // 真实飞书知识库地址在部署时填写，避免在公开源代码中新增内部入口。
  feishuWikiUrl: ''
});
