const cacheName = 'bilm-cache-v1';  // Cache version name — change this to update cache
const filesToCache = [
  '/',                // Cache root page
  '/index.html',      // Cache main HTML page (adjust path if needed)
  '/manifest.json',   // Cache manifest file
  '/icon.png',        // Cache your app icon
  // Add here any other static assets you want cached (CSS, JS, images, etc.)
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