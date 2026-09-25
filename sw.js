/* 오프라인 캐시. 앱 셸은 stale-while-revalidate, rates.json 은 network-first.
   외부 API(er-api, frankfurter)는 건드리지 않음 — 앱이 직접 실패를 처리함.
   __BUILD__ 는 배포 스크립트가 빌드 시각으로 치환함. 치환 안 된 로컬에선 'dev'. */
const BUILD = '__BUILD__';
const CACHE = `travlog-${BUILD.startsWith('__') ? 'dev' : BUILD}`;
const SHELL = ['./', './index.html', './app.js', './calc.js', './rates.js', './store.js', './currencies.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;

  if (url.pathname.endsWith('/data/rates.json')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(url.pathname, copy));
        return res;
      }).catch(() => caches.match(url.pathname).then((m) => m || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }))),
    );
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
