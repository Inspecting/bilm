const cacheName = 'bilm-cache-v1';  // Cache version name — change this to update cache
const APP_BASE = '/bilm';
const filesToCache = [
  `${APP_BASE}/`,
  `${APP_BASE}/index.html`,
  `${APP_BASE}/manifest.json`,
  `${APP_BASE}/icon.png`
];

self.addEventListener('install', (event) => {
  // During install, open the cache and add all files to it
  event.waitUntil(
    caches.open(cacheName)
      .then(cache => cache.addAll(filesToCache))
  );
});

self.addEventListener('fetch', (event) => {
  // On fetch, respond with cached version if available, else fetch from network
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});