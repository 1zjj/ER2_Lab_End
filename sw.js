const CACHE = 'er2-static-20260911-1';
const ASSETS = [
  './styles.css?v=teacher-attention-20260910-1',
  './learning-center.css?v=learning-text-1',
  './finance.css?v=finance-contact-20260910-1',
  './config.js?v=permissions-20260910-4',
  './draft-store.js?v=permissions-20260910-4',
  './guide-store.js?v=permissions-20260910-4',
  './learning-center.js?v=permissions-20260910-4',
  './finance.js?v=finance-background-sync-20260911-1',
  './app.js?v=read-performance-20260911-1',
  './data/catalog.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.mode === 'navigate') return;
  if (!ASSETS.some(asset => new URL(asset, self.location.href).href === url.href)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
