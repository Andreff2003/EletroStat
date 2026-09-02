// ElectroStat service worker — offline support for the installed app.
//
// Strategy: network-first, cache-as-fallback, for same-origin GET requests.
// Every time there IS a connection, the browser always gets the live,
// current version (this app is updated often, so we deliberately do NOT do
// cache-first/precaching — that's the classic PWA bug where an installed
// app gets stuck showing an old version forever). The cache only kicks in
// when a request fails outright, which in practice means "no network".
//
// This does NOT make Live/Multi-Channel measurement modes work offline —
// those need a real WebSocket connection to bridge.py/ESP32. It only lets
// the app itself (shell + Simulated mode) open and run with no connection,
// once it has been opened at least once while online.
//
// Bump CACHE_NAME (v1 -> v2 -> ...) if you change this file's caching
// logic, so old browsers drop their previous cache instead of keeping it
// around forever.
const CACHE_NAME = "electrostat-cache-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only intercept simple same-origin page/asset loads. WebSocket
  // connections to bridge.py/ESP32 are a completely different browser
  // mechanism and are never routed through this handler.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Offline + never cached this exact URL (e.g. a deep link typed
        // while offline) — fall back to the cached app shell so the app
        // still opens instead of showing the browser's own offline page.
        const shell = await caches.match("/");
        if (shell) return shell;
        throw new Error("offline and nothing cached");
      }),
  );
});
