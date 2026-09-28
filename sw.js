// LightAndSky 乐谱库 Service Worker
// stale-while-revalidate 策略，离线可访问最近一次乐谱列表

const CACHE = 'las-scores-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=20260928a',
  './app.js?v=20260928a',
  './manifest.webmanifest',
  './icon-512.jpg',
  './scores.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 网络优先 + 缓存回退（scores.json 总是拿最新，失败时用缓存）
  if (req.url.includes('scores.json')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((c) => c || Response.error()))
    );
    return;
  }

  // stale-while-revalidate（静态资源）
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
