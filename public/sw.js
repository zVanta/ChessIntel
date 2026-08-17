/* Service worker for Checkmate Coach.
 *
 * This app is server-rendered with server-side data (SQLite, Stripe, the
 * Python analysis service), so we intentionally DO NOT precache pages or
 * API responses. We only cache immutable-ish static assets (icons) and let
 * everything else hit the network.
 */

const CACHE = "checkmate-coach-v1";
const STATIC_ASSETS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch API routes or cross-origin requests.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network only (server-rendered pages must stay fresh).
  if (request.mode === "navigate") return;

  // Static assets: cache-first, then populate the cache on success.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
