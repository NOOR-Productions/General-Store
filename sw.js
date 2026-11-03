/* Bapi Store service worker.
   - Keeps the shop usable when the connection drops.
   - Product and shop data are always fetched fresh first, so price and stock edits show up straight away.
   Bump VERSION whenever you change css/js files, so visitors pick up the new files. */
const VERSION = 'bapi-v1';
const SHELL = [
  './', 'index.html', 'offline.html', 'manifest.webmanifest',
  'css/style.css', 'js/app.js',
  'data/store.json', 'data/products.json',
  'Assets/hero.webp', 'Assets/icon.svg',
  'Assets/fonts/rozha-one-latin-400-normal.woff2', 'Assets/fonts/rozha-one-latin-ext-400-normal.woff2',
  'Assets/fonts/hanken-grotesk-latin-wght-normal.woff2', 'Assets/fonts/hanken-grotesk-latin-ext-wght-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts and maps go straight to the network

  // Opening a page: try the network, fall back to the saved shop, then the offline page.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('index.html').then(r => r || caches.match('offline.html')))
    );
    return;
  }

  // Data: network first so stock and prices are current.
  if (url.pathname.endsWith('.json')) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Everything else: show the saved copy now, refresh it in the background.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
