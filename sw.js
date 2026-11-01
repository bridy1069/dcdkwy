/* 离线缓存：把词库和应用本体缓存下来，断网也能背 */
const CACHE = 'xy-vocab-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data/words.min.js',
  './manifest.json',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => { try { c.put(e.request, copy); } catch (err) {} });
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
