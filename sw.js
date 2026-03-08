const cacheName = 'bilm-cache-v4';
const scopeUrl = new URL(self.registration.scope);
const offlineDocument = new URL('index.html', scopeUrl).toString();
const filesToCache = ['.', 'index.html', 'home/index.html', 'manifest.json', 'icon.png']
  .map((assetPath) => new URL(assetPath, scopeUrl).toString());

function isCacheableResponse(response) {
  return Boolean(response && response.ok && response.type !== 'opaque');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(filesToCache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const isDocumentRequest = event.request.mode === 'navigate' || event.request.destination === 'document';

    if (isDocumentRequest) {
      try {
        const networkResponse = await fetch(event.request);
        if (isCacheableResponse(networkResponse)) {
          await cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        return (await cache.match(event.request))
          || (await cache.match(offlineDocument))
          || (await cache.match(new URL('.', scopeUrl).toString()))
          || Response.error();
      }
    }

    const cachedResponse = await cache.match(event.request);
    if (cachedResponse) {
      event.waitUntil((async () => {
        try {
          const refreshed = await fetch(event.request);
          if (isCacheableResponse(refreshed)) {
            await cache.put(event.request, refreshed.clone());
          }
        } catch {
          // Keep existing cached response when refresh fails.
        }
      })());
      return cachedResponse;
    }

    try {
      const networkResponse = await fetch(event.request);
      if (isCacheableResponse(networkResponse)) {
        await cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      return cachedResponse || Response.error();
    }
  })());
});
