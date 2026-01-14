const CACHE_VERSION = 'v3.1.0-mobile-fix';  // ✅ Updated version to force refresh
const CACHE_NAME = `time-clock-${CACHE_VERSION}`;

const BASE_PATH = '/somd-time-clock-pwa';

const CACHE_FILES = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/my-times.html`,
  `${BASE_PATH}/app.js`,
  `${BASE_PATH}/manifest.json`,
  `${BASE_PATH}/icon-192.png`,
  `${BASE_PATH}/icon-512.png`
];

self.addEventListener('install', (event) => {
  console.log('📦 Service Worker installing v3.1.0-mobile-fix');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker activating - clearing old caches');
  event.waitUntil(
    caches.keys()
      .then(names => {
        console.log('🗑️ Deleting old caches:', names.filter(n => n !== CACHE_NAME));
        return Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
      })
      .then(() => self.clients.claim())
  );
});

// IMPORTANT: Never cache API calls (script.google.com)
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  const isApiCall =
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleusercontent.com') ||
    url.pathname.includes('/macros/s/');

  if (isApiCall) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((resp) => {
        if (!resp || resp.status !== 200) return resp;
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return resp;
      }).catch(() => caches.match(`${BASE_PATH}/index.html`));
    })
  );
});
