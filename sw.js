// VOODO ERP — Service Worker v6
// All URLs are RELATIVE to the SW's own location so the same file works
// both at a domain root (Vercel: /) and under a subpath (GitHub Pages:
// /voodo-erp/). v5 used absolute '/...' paths, which silently broke
// caching — and therefore offline mode — on GitHub Pages.
const CACHE_NAME = 'voodo-erp-v7';

// Lazy-loaded admin pages (see LAZY_CHUNKS in build.py) — precached so they
// still work offline after the first successful load, same as everything
// else, even though they're no longer inlined into index.html.
const LAZY_CHUNKS = [
  'chunk-accounting.js',
  'chunk-warehouse.js',
  'chunk-purchases.js',
  'chunk-helpdesk.js',
  'chunk-pivot.js',
  'chunk-migration.js',
  'chunk-analytics.js'
];

// Install — cache essential files (resolved relative to the SW scope)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(['index.html', ...LAZY_CHUNKS]).catch(() => {});
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

  // Identify app-shell requests by their FILE NAME, not an absolute path,
  // so '/index.html' and '/voodo-erp/index.html' are both recognized.
  const file = url.pathname.split('/').pop();
  const isShell = file === '' || file === 'index.html' || LAZY_CHUNKS.includes(file);

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && isShell) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline — return cached version
        return caches.match(event.request)
          .then(cached => cached || caches.match('index.html'));
      })
  );
});
