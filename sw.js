const cacheName = 'bilm-cache-v3';
const scopeUrl = new URL(self.registration.scope);
const filesToCache = ['.', 'index.html', 'manifest.json', 'icon.png'].map((path) => new URL(path, scopeUrl).toString());

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(cacheName)
      .then(cache => cache.addAll(filesToCache))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))
    ))
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request).catch(() => response))
  );
});
