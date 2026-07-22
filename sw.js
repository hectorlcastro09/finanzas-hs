/* =============================================================
   sw.js — Service worker (offline-first para el shell)
   Firebase Firestore maneja su propia persistencia, así que aquí
   sólo cacheamos los recursos estáticos (incluidos los CDN, que
   ahora cargan con crossorigin y sí son cacheables).
   ============================================================= */

const CACHE_VERSION = "finanzas-hs-v5";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/css/style.css?v=3",
  "./assets/js/firebase.js?v=3",
  "./assets/js/exchange.js?v=3",
  "./assets/js/store.js?v=3",
  "./assets/js/charts.js?v=3",
  "./assets/js/ui.js?v=3",
  "./assets/js/fondos.js?v=3",
  "./assets/js/notify.js?v=3",
  "./assets/js/app.js?v=3",
  "./assets/data/categorias.json",
  "./assets/img/icon-any-192.png",
  "./assets/img/icon-any-512.png",
  "./assets/img/icon-maskable-512.png",
  "./assets/img/apple-touch-icon.png",
  "./assets/img/login-logo.png",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      // cache:"reload" salta el caché HTTP (GitHub Pages sirve max-age=600
      // y podría pre-cachear un index.html viejo justo tras el deploy)
      .then(c => c.addAll(CORE_ASSETS.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
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

  // Nunca cachear Firebase (datos) ni APIs externas
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
