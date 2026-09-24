// Medsprout service worker: offline app shell + notification actions.
const CACHE = 'medsprout-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './icon.svg', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin requests (so updates show up right away),
// falling back to the cache when offline. Fonts and other origins pass through.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(cache =>
      fetch(e.request, { cache: 'no-cache' })
        .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cache.match(e.request, { ignoreSearch: true }))
    )
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const slot = e.notification.data && e.notification.data.slot;
  const action = e.action || 'open';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) {
      const client = all[0];
      client.postMessage({ type: 'notification-action', action, slot });
      if ('focus' in client) return client.focus();
      return;
    }
    const q = slot && action !== 'open' ? `?action=${action}&slot=${encodeURIComponent(slot)}` : '';
    return self.clients.openWindow(`./${q}#today`);
  })());
});
