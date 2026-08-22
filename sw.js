// PRISM TV service worker - versioned cache; bump CACHE_VERSION on every deploy
// so returning clients always get the new shell.
const CACHE_VERSION = 'prism-v2';
const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/logo.svg',
  '/js/main.js',
  '/js/state.js',
  '/js/api.js',
  '/js/tree.js',
  '/js/tracking.js',
  '/js/player.js',
  '/js/multiview.js',
  '/js/grid.js',
  '/js/themes.js',
  '/js/pwa.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // API/proxy/stream traffic: network only

  // navigations: network-first, fall back to cached shell when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // static assets: stale-while-revalidate
  e.respondWith(
    caches.match(req).then(cached => {
      const refresh = fetch(req).then(res => {
        if (res.ok) caches.open(CACHE_VERSION).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || refresh;
    })
  );
});
