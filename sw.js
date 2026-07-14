// VOODO ERP — Service Worker v3
const CACHE_NAME = 'voodo-erp-v3';
const OFFLINE_URL = '/';

// Lazy-loaded admin pages (see LAZY_CHUNKS in build.py) — precached so they
// still work offline after the first successful load, same as everything
// else, even though they're no longer inlined into index.html.
const LAZY_CHUNKS = [
  '/chunk-accounting.js',
  '/chunk-warehouse.js',
  '/chunk-manufacturing.js',
  '/chunk-purchases.js',
  '/chunk-helpdesk.js'
];

// Files to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/index.html',
  ...LAZY_CHUNKS,
  'https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// Install — cache essential files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(['/index.html', ...LAZY_CHUNKS]).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

// Activate — remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', event => {
  // Skip non-GET and cross-origin Firebase/Google requests
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('google') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses for the app shell
        if (response.ok && (url.pathname === '/' || url.pathname === '/index.html' || LAZY_CHUNKS.includes(url.pathname))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline — return cached version
        return caches.match(event.request)
          .then(cached => cached || caches.match('/index.html'));
      })
  );
});
