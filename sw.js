const CACHE = 'ipl-arena-v4';

// Derive base path so this works both at / and at /ipl-arena/
const BASE = self.registration.scope;

const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'app.js',
  BASE + 'data.js',
  BASE + 'style.css',
  BASE + 'config.js',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always go live for cricket API calls
  if (url.includes('cricapi.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Cache-first for everything else (app shell + assets)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (e.request.method === 'GET') {
          caches.open(CACHE).then(cache => cache.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => caches.match(BASE + 'index.html'));
    })
  );
});
