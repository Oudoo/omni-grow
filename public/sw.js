// Service worker for the installable app.
// Conversations, contacts and session data are never cached: API calls and
// pages always go to the network. Only hashed build assets, icons and a
// static offline page are stored so the app shell opens without a connection.
const VERSION = 'v1';
const SHELL_CACHE = `og-shell-${VERSION}`;
const ASSET_CACHE = `og-assets-${VERSION}`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
    for (const key of await caches.keys()) if (key.startsWith('og-') && !keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Network only for pages; fall back to the offline screen when unreachable.
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
    return;
  }

  // Build output under /_next/static is content-hashed, so cache-first is safe.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brands/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) (await caches.open(ASSET_CACHE)).put(request, response.clone());
      return response;
    })());
  }
});
