const CACHE_VERSION = 'v4.0.0-NUCLEAR-RESET';
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
  console.log('📦 SW v4.0.0 installing - NUCLEAR CACHE RESET');
  event.waitUntil(
    caches.keys()
      .then(names => {
        // Delete ALL old caches
        console.log('🗑️ Deleting ALL old caches:', names);
        return Promise.all(names.map(n => caches.delete(n)));
      })
      .then(() => caches.open(CACHE_NAME))
      .then(cache => cache.addAll(CACHE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('✅ SW v4.0.0 activating');
  event.waitUntil(
    caches.keys()
      .then(names => {
        // Keep only current version
        return Promise.all(
          names
            .filter(n => n !== CACHE_NAME)
            .map(n => {
              console.log('🗑️ Deleting old cache:', n);
              return caches.delete(n);
            })
        );
      })
      .then(() => self.clients.claim())
      .then(() => {
        // Force refresh all clients
        return self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            console.log('🔄 Refreshing client:', client.url);
            client.postMessage({ type: 'CACHE_CLEARED', version: CACHE_VERSION });
          });
        });
      })
  );
});

// Never cache API calls
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

  // Network-first for HTML/JS (during cache crisis)
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (!resp || resp.status !== 200) return resp;
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return resp;
      });
    })
  );
});

// Listen for messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
