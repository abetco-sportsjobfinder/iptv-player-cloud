// PRISM TV service worker - NETWORK-ONLY mode (2026-08-23).
// The previous stale-while-revalidate strategy served users frozen snapshots
// of the app across deploys ("zombie shell"). Until the product stabilizes,
// this SW intercepts NOTHING and purges all caches it can see.
const CACHE_VERSION = 'prism-v3-network-only';

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// No fetch handler: every request goes straight to the network.
