const CACHE_PREFIX = "crystal-front-shell-";
const CACHE_VERSION = CACHE_PREFIX + '2026-10-02-3';
const APP_SHELL = [
  "../../economy-host.js?v=20261002-3",
  "../../auth-config.js?v=20261002-3",
  "../../auth.js?v=20261002-3",
  "../../account-gate.js?v=20261002-3",
  "./",
  "./index.html",
  "./install/",
  "./manifest.webmanifest",
  "../../game-registry.js?v=20261002-3",
  "../../game-player.js?v=20261002-3",
  "../../account-context-host.js?v=20261002-3",
  "../../game-player.css?v=20261002-3",
  "../../update-guard.js?v=20261002-3",
  "../../stats.js?v=20261002-3",
  "../../game-analytics-host.js?v=20261002-3"
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION).map(key => caches.delete(key))))));
// No skipWaiting/clients.claim: old open shells must not be reloaded mid-race.
// Each shell only caches its own routes and shared hub assets, never game builds.
self.addEventListener('fetch', event => {
 const request = event.request, url = new URL(request.url), scope = new URL("./", self.location).pathname;
 const shared = APP_SHELL.some(asset => new URL(asset, self.location).href === url.href);
 if (request.method !== 'GET' || url.origin !== self.location.origin || (!url.pathname.startsWith(scope) && !shared)) return;
 event.respondWith(fetch(request, {cache: 'no-store'}).then(response => {
   if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.put(request,copy))); }
   return response;
 }).catch(async () => (await (await caches.open(CACHE_VERSION)).match(request)) || Response.error()));
});
