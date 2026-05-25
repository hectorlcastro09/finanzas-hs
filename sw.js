/* =============================================================
   sw.js — Service worker (offline-first para el shell)
   Firebase Firestore maneja su propia persistencia, así que aquí
   sólo cacheamos los recursos estáticos.
   ============================================================= */

const CACHE_VERSION = "finanzas-hs-v3";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/css/style.css",
  "./assets/js/firebase.js",
  "./assets/js/exchange.js",
  "./assets/js/store.js",
  "./assets/js/charts.js",
  "./assets/js/ui.js",
  "./assets/js/app.js",
  "./assets/data/categorias.json",
  "./assets/img/icon-192.png",
  "./assets/img/icon-512.png",
  "./assets/img/logo.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Nunca cachear Firebase ni APIs externas
  if (url.host.includes("firebaseio.com") ||
      url.host.includes("firestore.googleapis.com") ||
      url.host.includes("googleapis.com") ||
      url.host.includes("open.er-api.com") ||
      url.host.includes("identitytoolkit.googleapis.com")) {
    return;
  }

  // Estrategia: cache-first con fallback a red, y refresca en background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.status === 200 && e.request.method === "GET") {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
