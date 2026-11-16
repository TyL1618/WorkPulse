const CACHE = 'wp-v9';
const CDN_CACHE = 'wp-cdn-v1';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'logic.js', 'sync.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== CDN_CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Supabase 套件（CDN，版本固定在網址裡）：快取優先，離線時 App 仍能啟動
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(CDN_CACHE).then(cache => cache.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    })));
    return;
  }
  if (url.origin !== location.origin) return;            // Supabase API 等其他跨網域請求一律不攔截

  // App 外殼：網路優先（有更新立刻生效），離線時退回快取
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })   // GitHub Pages 預設讓瀏覽器快取 10 分鐘，這裡強制向伺服器確認有沒有新版
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then(c => c || caches.match('./')))
  );
});
