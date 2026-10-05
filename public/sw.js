// Minimal service worker: makes the game installable. Always loads the page from the network
// first, so updates arrive at once; falls back to the saved copy only when offline.
const CACHE = 'domino-goat-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/icon-192.png']))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then((res) => { if (res.ok && r.mode === 'navigate') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); } return res; }).catch(() => caches.match(r.mode === 'navigate' ? '/' : r)));
});
