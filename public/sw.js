const SHELL_CACHE = "im-shell-v1";
const STATIC_CACHE = "im-static-v2";
const SHELL_FILES = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("im-") && key !== SHELL_CACHE && key !== STATIC_CACHE).map(key => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.open(SHELL_CACHE)).match("/")));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || SHELL_FILES.includes(url.pathname)) {
    event.respondWith(caches.open(STATIC_CACHE).then(async cache => {
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    }));
  }
});

self.addEventListener("message", event => {
  if (event.data?.type !== "CACHE_APP_ASSETS" || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter(path => typeof path === "string" && path.startsWith("/_next/static/"));
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(urls)));
});
