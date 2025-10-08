const APP_CACHE = 'dcout-app-v5';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/topbar.css',
  '/css/profile-menu.css',
  '/css/notifications.css',
  '/css/chat.css',
  '/css/responsive.css',
  '/css/mobile.css',
  '/js/auth-helper.js',
  '/js/profile-menu.js',
  '/js/notifications.js',
  '/js/pwa.js',
  '/js/topbar-dock.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'opaque') return response;
          const responseClone = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
