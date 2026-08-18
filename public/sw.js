/* Service worker for Checkmate Coach.
 *
 * This app is server-rendered with server-side data (SQLite, Stripe, the
 * Python analysis service), so we intentionally DO NOT precache pages or
 * API responses. We only cache immutable-ish static assets (icons) and let
 * everything else hit the network.
 */

const CACHE = "checkmate-coach-v2";
const STATIC_ASSETS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

// Only these request destinations are ever cached. Pages, navigations and
// Next.js route prefetches (destination "") must always go to the network.
const CACHEABLE_DESTINATIONS = new Set(["image", "font", "manifest"]);

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

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Never touch API routes or cross-origin requests.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Never intercept navigations or non-asset requests (e.g. Next.js route
  // prefetches, which arrive with an empty destination and would otherwise be
  // mistaken for a static asset).
  if (!CACHEABLE_DESTINATIONS.has(request.destination || "")) return;

  // Static assets: cache-first, then populate the cache on success. Any
  // network failure resolves to an error response instead of rejecting, so
  // the FetchEvent never surfaces an unhandled promise rejection.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => Response.error());
    })
  );
});
