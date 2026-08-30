// ChEckIn service worker.
//
// CACHE_VERSION is stamped at build time by the Vite plugin in vite.config.js,
// so every deploy gets a new cache name and old caches are deleted on activate.
// Forgetting to bust this is why fixes never reached the phones in the original
// (spec §10, §14 trap #2).
const CACHE_VERSION = '__SW_VERSION__';
const CACHE_NAME = `checkin-${CACHE_VERSION}`;
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => { /* a missing shell entry must not block installation */ })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n.startsWith('checkin-') && n !== CACHE_NAME).map((n) => caches.delete(n)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never cache Supabase traffic: sync correctness beats offline convenience,
  // and a cached POST/GET response here would show stale data as if it were live.
  if (url.origin !== self.location.origin) return;

  const isDocument = request.mode === 'navigate';
  const isAppCode = /\.(js|css)$/.test(url.pathname);

  if (isDocument || isAppCode) {
    // Network-first for the app itself, so a deploy is picked up immediately
    // and the cache is only a fallback when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html'))),
    );
    return;
  }

  // Cache-first for static assets (icons, images): they are content-addressed
  // or rarely change, and speed matters more.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});

// --- Push notifications (optional, spec §12) --------------------------------
// These listeners are inert unless a push subscription exists.

self.addEventListener('push', (event) => {
  let payload = { title: 'ChEckIn', body: 'Daily reminder' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'checkin-reminder',
    data: { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
