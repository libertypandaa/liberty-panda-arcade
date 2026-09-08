const CACHE_VERSION = "liberty-panda-arcade-shell-2026-09-08-4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./version.json",
  "./icon-192.png",
  "./icon-512.png",
  "./assets/games/crystal-front-feature.png",
  "./assets/games/crystal-front-app-icon-192-v2.png",
  "./assets/games/crystal-front-app-icon-512-v2.png",
  "./assets/games/crystal-front-icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("liberty-panda-arcade-shell-") && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  const shouldPreferNetwork =
    request.mode === "navigate" ||
    acceptsHtml ||
    url.pathname.endsWith("/manifest.webmanifest") ||
    url.pathname.endsWith("/version.json") ||
    url.pathname.endsWith("/service-worker.js");

  if (shouldPreferNetwork) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
